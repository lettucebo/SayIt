import { onScopeDispose, readonly, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  HOTKEY_RECORDING_CAPTURED,
  HOTKEY_RECORDING_REJECTED,
  listenToEvent,
} from "./useTauriEvents";
import type {
  RecordingCapturedPayload,
  RecordingRejectedPayload,
} from "../types/events";

const RECORDING_TIMEOUT_MS = 10_000;

interface HotkeyRecordingCallbacks {
  onCaptured: (payload: RecordingCapturedPayload) => void | Promise<void>;
  onRejected: (payload: RecordingRejectedPayload) => void | Promise<void>;
  onTimeout: () => void;
  onStartFailed: (error: unknown) => void;
  onCleanupFailed: (error: unknown) => void;
}

interface RecordingSession {
  terminal: boolean;
  nativeStartIssued: boolean;
  nativeStart: Promise<void> | null;
  cleanup: Promise<void> | null;
  timer: ReturnType<typeof setTimeout>;
  unlisteners: Set<UnlistenFn>;
  stopped: Promise<void>;
  resolveStopped: () => void;
}

export function useHotkeyRecordingSession(callbacks: HotkeyRecordingCallbacks) {
  const isRecording = ref(false);
  const isCleaningUp = ref(false);
  let current: RecordingSession | null = null;
  let cleanupInProgress: Promise<void> | null = null;
  let pendingStart = false;
  let requestId = 0;
  let disposed = false;

  function notifyFailure(kind: "start" | "cleanup", error: unknown): void {
    console.error(`[useHotkeyRecordingSession] ${kind} failed:`, error);
    try {
      (kind === "start" ? callbacks.onStartFailed : callbacks.onCleanupFailed)(error);
    } catch (callbackError) {
      console.error("[useHotkeyRecordingSession] error callback failed:", callbackError);
    }
  }

  function deliver(callback: () => void | Promise<void>): Promise<void> {
    try {
      return Promise.resolve(callback()).catch((error: unknown) => notifyFailure("cleanup", error));
    } catch (error) {
      notifyFailure("cleanup", error);
      return Promise.resolve();
    }
  }

  function finish(session: RecordingSession, terminalCallback?: () => void | Promise<void>): void {
    if (session.terminal) return;
    session.terminal = true;
    session.resolveStopped();
    clearTimeout(session.timer);
    for (const unlisten of session.unlisteners) {
      try {
        unlisten();
      } catch (error) {
        notifyFailure("cleanup", error);
      }
    }
    session.unlisteners.clear();
    if (current === session) {
      current = null;
      isRecording.value = false;
    }

    // The native command has no session ID: wait for this start to settle before cancelling.
    let resolveTerminal!: () => void;
    const terminalDone = new Promise<void>((resolve) => { resolveTerminal = resolve; });
    isCleaningUp.value = true;
    const cleanup = (async () => {
      if (session.nativeStart) {
        try {
          await session.nativeStart;
        } catch {
          // start() reports an active failure; a cancelled start is logged there.
        }
      }
      if (session.nativeStartIssued) {
        try {
          await invoke("cancel_hotkey_recording");
        } catch (error) {
          notifyFailure("cleanup", error);
        }
      }
      await terminalDone;
    })();
    session.cleanup = cleanup;
    cleanupInProgress = cleanup;
    void cleanup.finally(() => {
      if (cleanupInProgress === cleanup) {
        cleanupInProgress = null;
        isCleaningUp.value = false;
      }
    });
    if (terminalCallback && !disposed) {
      void deliver(terminalCallback).then(resolveTerminal);
    } else {
      resolveTerminal();
    }
  }

  function stop(): void {
    requestId++;
    pendingStart = false;
    if (current) finish(current);
  }

  async function start(): Promise<void> {
    if (disposed || current || pendingStart) return;
    const thisRequest = ++requestId;
    if (cleanupInProgress) {
      pendingStart = true;
      await cleanupInProgress;
      pendingStart = false;
      if (disposed || thisRequest !== requestId || current) return;
    }

    let resolveStopped!: () => void;
    const stopped = new Promise<void>((resolve) => { resolveStopped = resolve; });
    const session: RecordingSession = {
      terminal: false,
      nativeStartIssued: false,
      nativeStart: null,
      cleanup: null,
      timer: setTimeout(() => finish(session, callbacks.onTimeout), RECORDING_TIMEOUT_MS),
      unlisteners: new Set(),
      stopped,
      resolveStopped,
    };
    current = session;
    isRecording.value = true;

    const register = async <T>(name: string, onEvent: (payload: T) => void) => {
      let unlisten: UnlistenFn;
      try {
        unlisten = await listenToEvent<T>(name, (event) => {
          if (current === session && !session.terminal && session.nativeStartIssued) {
            onEvent(event.payload);
          }
        });
      } catch (error) {
        if (session.terminal) {
          console.error("[useHotkeyRecordingSession] cancelled listener registration failed:", error);
        }
        throw error;
      }
      if (session.terminal) {
        try {
          unlisten();
        } catch (error) {
          notifyFailure("cleanup", error);
        }
      } else {
        session.unlisteners.add(unlisten);
      }
    };

    try {
      await Promise.race([
        Promise.all([
          register<RecordingCapturedPayload>(HOTKEY_RECORDING_CAPTURED,
            (payload) => finish(session, () => callbacks.onCaptured(payload))),
          register<RecordingRejectedPayload>(HOTKEY_RECORDING_REJECTED,
            (payload) => finish(session, () => callbacks.onRejected(payload))),
        ]),
        session.stopped,
      ]);
      if (session.terminal) {
        await session.cleanup;
        return;
      }
      session.nativeStart = Promise.resolve().then(async () => {
        if (session.terminal) return;
        session.nativeStartIssued = true;
        await invoke("start_hotkey_recording");
      });
      try {
        await session.nativeStart;
      } catch (error) {
        if (!session.terminal) {
          finish(session, () => notifyFailure("start", error));
        } else {
          console.error("[useHotkeyRecordingSession] cancelled native start failed:", error);
        }
      }
      if (session.terminal) await session.cleanup;
    } catch (error) {
      if (!session.terminal) finish(session, () => notifyFailure("start", error));
      else console.error("[useHotkeyRecordingSession] cancelled listener registration failed:", error);
      await session.cleanup;
    }
  }

  onScopeDispose(() => {
    disposed = true;
    stop();
  });

  return {
    isRecording: readonly(isRecording),
    isCleaningUp: readonly(isCleaningUp),
    start,
    stop,
  };
}
