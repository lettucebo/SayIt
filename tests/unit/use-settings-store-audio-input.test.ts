import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { AudioInputDeviceInfo } from "../../src/types/audio";

const { mockInvoke, mockCaptureError } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockCaptureError: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("../../src/lib/sentry", () => ({ captureError: mockCaptureError }));

function createDevice(name = "Test microphone"): AudioInputDeviceInfo {
  return { name };
}

describe("useSettingsStore audio input device list", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
    mockCaptureError.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("[P1] exports the device-list action and returns both native query results", async () => {
    const { useSettingsStore } = await import("../../src/stores/useSettingsStore");
    const store = useSettingsStore();
    const devices = [createDevice()];
    mockInvoke.mockImplementation(async (command: string) =>
      command === "list_audio_input_devices" ? devices : devices[0].name,
    );

    expect(store.getAudioInputDeviceList).toBeTypeOf("function");
    await expect(store.getAudioInputDeviceList()).resolves.toEqual({
      devices,
      defaultDeviceName: devices[0].name,
    });
    expect(mockInvoke.mock.calls).toEqual([
      ["list_audio_input_devices"],
      ["get_default_input_device_name"],
    ]);
  });

  it("[P1] preserves an empty list and null default as a successful native result", async () => {
    const { useSettingsStore } = await import("../../src/stores/useSettingsStore");
    mockInvoke.mockImplementation(async (command: string) =>
      command === "list_audio_input_devices" ? [] : null,
    );

    await expect(useSettingsStore().getAudioInputDeviceList()).resolves.toEqual({
      devices: [],
      defaultDeviceName: null,
    });
  });

  it.each(["list_audio_input_devices", "get_default_input_device_name"])(
    "[P1] logs, captures and rethrows %s failures instead of returning empty success",
    async (failedCommand) => {
      const { useSettingsStore } = await import("../../src/stores/useSettingsStore");
      const error = "Microphone enumeration unavailable";
      mockInvoke.mockImplementation(async (command: string) => {
        if (command === failedCommand) throw error;
        return [createDevice()];
      });

      await expect(useSettingsStore().getAudioInputDeviceList()).rejects.toBe(error);
      expect(console.error).toHaveBeenCalledWith(
        "[useSettingsStore] getAudioInputDeviceList failed:",
        error,
      );
      expect(mockCaptureError).toHaveBeenCalledWith(error, {
        source: "settings",
        step: "list-audio-input-devices",
      });
    },
  );
});
