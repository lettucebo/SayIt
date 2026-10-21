import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, type EffectScope } from "vue";
import type { Event } from "@tauri-apps/api/event";
import type { RecordingCapturedPayload, RecordingRejectedPayload } from "../../src/types/events";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock, emit: vi.fn() }));

import { useHotkeyRecordingSession } from "../../src/composables/useHotkeyRecordingSession";
import {
  HOTKEY_RECORDING_CAPTURED,
  HOTKEY_RECORDING_REJECTED,
} from "../../src/composables/useTauriEvents";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

type Handler = (event: Event<unknown>) => void;

describe("useHotkeyRecordingSession", () => {
  let scope: EffectScope;
  let handlers: Map<string, Handler[]>;
  let unlistens: Map<string, ReturnType<typeof vi.fn>[]>;
  let captured: ReturnType<typeof vi.fn>;
  let rejected: ReturnType<typeof vi.fn>;
  let timedOut: ReturnType<typeof vi.fn>;
  let startFailed: ReturnType<typeof vi.fn>;
  let cleanupFailed: ReturnType<typeof vi.fn>;
  let logError: ReturnType<typeof vi.spyOn>;

  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  function fire<T>(name: string, payload: T) {
    for (const handler of handlers.get(name) ?? []) {
      handler({ event: name, id: 0, payload } as Event<T>);
    }
  }

  function createSession() {
    scope = effectScope();
    return scope.run(() =>
      useHotkeyRecordingSession({
        onCaptured: captured,
        onRejected: rejected,
        onTimeout: timedOut,
        onStartFailed: startFailed,
        onCleanupFailed: cleanupFailed,
      }),
    )!;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    logError = vi.spyOn(console, "error").mockImplementation(() => {});
    handlers = new Map();
    unlistens = new Map();
    captured = vi.fn();
    rejected = vi.fn();
    timedOut = vi.fn();
    startFailed = vi.fn();
    cleanupFailed = vi.fn();
    listenMock.mockReset().mockImplementation((name: string, handler: Handler) => {
      const registered = handlers.get(name) ?? [];
      registered.push(handler);
      handlers.set(name, registered);
      const unlisten = vi.fn(() => {
        handlers.set(name, registered.filter((item) => item !== handler));
      });
      unlistens.set(name, [...(unlistens.get(name) ?? []), unlisten]);
      return Promise.resolve(unlisten);
    });
    invokeMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    scope?.stop();
    await flush();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("[P0] waits for both listeners then captures synchronously within native start only once", async () => {
    const second = deferred<() => void>();
    const originalListen = listenMock.getMockImplementation()!;
    listenMock.mockImplementation((name: string, handler: Handler) =>
      name === HOTKEY_RECORDING_REJECTED ? second.promise : originalListen(name, handler),
    );
    const session = createSession();
    const started = session.start();
    await flush();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(session.isRecording.value).toBe(true);
    second.resolve(vi.fn());
    invokeMock.mockImplementationOnce(async () => {
      fire<RecordingCapturedPayload>(HOTKEY_RECORDING_CAPTURED, { keycode: 65, modifiers: [] });
      fire<RecordingCapturedPayload>(HOTKEY_RECORDING_CAPTURED, { keycode: 66, modifiers: [] });
    });
    await started;
    await flush();
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "start_hotkey_recording", "cancel_hotkey_recording",
    ]);
    expect(captured).toHaveBeenCalledExactlyOnceWith({ keycode: 65, modifiers: [] });
    expect(session.isRecording.value).toBe(false);
    expect(handlers.get(HOTKEY_RECORDING_CAPTURED)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[P0] cancels during registration without starting native, and disposes late listeners", async () => {
    const late = deferred<() => void>();
    const originalListen = listenMock.getMockImplementation()!;
    listenMock.mockImplementation((name: string, handler: Handler) =>
      name === HOTKEY_RECORDING_REJECTED ? late.promise : originalListen(name, handler),
    );
    const session = createSession();
    const started = session.start();
    await flush();
    session.stop();
    await started;
    await flush();
    const disposeLate = vi.fn();
    late.resolve(disposeLate);
    await flush();
    expect(disposeLate).toHaveBeenCalledOnce();
    expect(unlistens.get(HOTKEY_RECORDING_CAPTURED)?.[0]).toHaveBeenCalledOnce();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(session.isCleaningUp.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[P0] cleans partial registration on rejection and permits a fresh session", async () => {
    listenMock.mockRejectedValueOnce("listen denied");
    const session = createSession();
    await session.start();
    await flush();
    expect(startFailed).toHaveBeenCalledExactlyOnceWith("listen denied");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(session.isRecording.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(unlistens.get(HOTKEY_RECORDING_REJECTED)?.[0]).toHaveBeenCalledOnce();
    await session.start();
    expect(invokeMock).toHaveBeenCalledWith("start_hotkey_recording");
  });

  it("[P0] resolves cleanup after partial registration failure before its other listener arrives", async () => {
    const late = deferred<() => void>();
    listenMock.mockImplementationOnce(() => late.promise)
      .mockRejectedValueOnce("rejected listener failed");
    const session = createSession();
    await session.start();
    expect(startFailed).toHaveBeenCalledExactlyOnceWith("rejected listener failed");
    expect(session.isCleaningUp.value).toBe(false);
    await session.start();
    expect(invokeMock).toHaveBeenCalledWith("start_hotkey_recording");
    const oldUnlisten = vi.fn();
    late.resolve(oldUnlisten);
    await flush();
    expect(oldUnlisten).toHaveBeenCalledOnce();
    expect(session.isRecording.value).toBe(true);
  });

  it("[P1] logs a late listener rejection after cancellation without affecting the next session", async () => {
    const late = deferred<() => void>();
    listenMock.mockImplementationOnce(() => late.promise);
    const session = createSession();
    const a = session.start();
    session.stop();
    await a;
    const b = session.start();
    await b;
    late.reject("late listen failed");
    await flush();
    expect(logError).toHaveBeenCalledWith(
      "[useHotkeyRecordingSession] cancelled listener registration failed:", "late listen failed",
    );
    expect(session.isRecording.value).toBe(true);
  });

  it("[P0] start failure cancels native state and reports both start and cancel errors", async () => {
    invokeMock.mockImplementation((command: string) => Promise.reject(command));
    const session = createSession();
    await session.start();
    await flush();
    expect(startFailed).toHaveBeenCalledExactlyOnceWith("start_hotkey_recording");
    expect(cleanupFailed).toHaveBeenCalledExactlyOnceWith("cancel_hotkey_recording");
    expect(session.isCleaningUp.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[P0] serializes pending A-start, its cancel, and a requested B-start", async () => {
    const oldStart = deferred<void>();
    const oldCancel = deferred<void>();
    invokeMock.mockImplementationOnce(() => oldStart.promise)
      .mockImplementationOnce(() => oldCancel.promise);
    const session = createSession();
    const a = session.start();
    await flush();
    session.stop();
    const b = session.start();
    expect(session.isCleaningUp.value).toBe(true);
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(["start_hotkey_recording"]);
    oldStart.resolve();
    await flush();
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "start_hotkey_recording", "cancel_hotkey_recording",
    ]);
    oldCancel.resolve();
    await Promise.all([a, b]);
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "start_hotkey_recording", "cancel_hotkey_recording", "start_hotkey_recording",
    ]);
    expect(session.isRecording.value).toBe(true);
  });

  it("[P0] waits for a captured key to finish saving before starting another native session", async () => {
    const saved = deferred<void>();
    captured.mockReturnValueOnce(saved.promise);
    const session = createSession();
    await session.start();
    fire<RecordingCapturedPayload>(HOTKEY_RECORDING_CAPTURED, { keycode: 65, modifiers: [] });
    const next = session.start();
    await flush();
    expect(session.isCleaningUp.value).toBe(true);
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "start_hotkey_recording", "cancel_hotkey_recording",
    ]);
    saved.resolve();
    await next;
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "start_hotkey_recording", "cancel_hotkey_recording", "start_hotkey_recording",
    ]);
  });

  it("[P0] discards old callbacks and late start rejection after a new session starts", async () => {
    const oldStart = deferred<void>();
    invokeMock.mockImplementationOnce(() => oldStart.promise);
    const session = createSession();
    const a = session.start();
    await flush();
    const oldHandler = handlers.get(HOTKEY_RECORDING_CAPTURED)![0];
    session.stop();
    const b = session.start();
    oldStart.reject("old start error");
    await a;
    await b;
    oldHandler({ event: HOTKEY_RECORDING_CAPTURED, id: 0,
      payload: { keycode: 65, modifiers: [] } } as Event<RecordingCapturedPayload>);
    expect(startFailed).not.toHaveBeenCalled();
    expect(captured).not.toHaveBeenCalled();
    expect(session.isRecording.value).toBe(true);
  });

  it("[P0] enforces a ten-second deadline from start, even while listener registration is pending", async () => {
    const late = deferred<() => void>();
    listenMock.mockImplementationOnce(() => late.promise);
    const session = createSession();
    const started = session.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await started;
    expect(timedOut).toHaveBeenCalledOnce();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(session.isRecording.value).toBe(false);
    const unlisten = vi.fn();
    late.resolve(unlisten);
    await flush();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("[P1] rejects only once and disarms the deadline", async () => {
    const session = createSession();
    await session.start();
    fire<RecordingRejectedPayload>(HOTKEY_RECORDING_REJECTED, { reason: "esc_reserved" });
    fire<RecordingRejectedPayload>(HOTKEY_RECORDING_REJECTED, { reason: "esc_reserved" });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(rejected).toHaveBeenCalledExactlyOnceWith({ reason: "esc_reserved" });
    expect(timedOut).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[P1] reports listener disposal failures without blocking native cancellation", async () => {
    const originalListen = listenMock.getMockImplementation()!;
    listenMock.mockImplementation((name: string, handler: Handler) =>
      name === HOTKEY_RECORDING_CAPTURED
        ? Promise.resolve(() => { throw new Error("unlisten failed"); })
        : originalListen(name, handler),
    );
    const session = createSession();
    await session.start();
    session.stop();
    await flush();
    expect(cleanupFailed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      message: "unlisten failed",
    }));
    expect(invokeMock).toHaveBeenCalledWith("cancel_hotkey_recording");
  });

  it("[P1] surfaces a rejected capture callback instead of leaking an unhandled rejection", async () => {
    captured.mockRejectedValueOnce("save failed");
    const session = createSession();
    await session.start();
    fire<RecordingCapturedPayload>(HOTKEY_RECORDING_CAPTURED, { keycode: 65, modifiers: [] });
    await flush();
    expect(cleanupFailed).toHaveBeenCalledExactlyOnceWith("save failed");
    expect(session.isRecording.value).toBe(false);
  });

  it("[P0] unmount cancels an in-flight session and prevents queued restart", async () => {
    const oldStart = deferred<void>();
    invokeMock.mockImplementationOnce(() => oldStart.promise);
    const session = createSession();
    const a = session.start();
    await flush();
    session.stop();
    const b = session.start();
    scope.stop();
    oldStart.resolve();
    await Promise.all([a, b]);
    await flush();
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "start_hotkey_recording", "cancel_hotkey_recording",
    ]);
    expect(session.isRecording.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
