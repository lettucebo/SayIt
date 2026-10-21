import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import { createI18n } from "vue-i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsAudioInput from "../../src/components/settings/SettingsAudioInput.vue";
import { Select } from "../../src/components/ui/select";
import type { AudioInputDeviceInfo } from "../../src/types/audio";
import en from "../../src/i18n/locales/en.json";

const {
  mockGetDevices,
  mockSaveDevice,
  mockInvoke,
  mockListen,
  mockUnlisten,
  mockPause,
  mockResume,
} = vi.hoisted(() => ({
  mockGetDevices: vi.fn(),
  mockSaveDevice: vi.fn(),
  mockInvoke: vi.fn(),
  mockListen: vi.fn(),
  mockUnlisten: vi.fn(),
  mockPause: vi.fn(),
  mockResume: vi.fn(),
}));

const settingsStore = reactive({
  selectedAudioInputDeviceName: "",
  getAudioInputDeviceList: mockGetDevices,
  saveAudioInputDevice: mockSaveDevice,
});

vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => settingsStore,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("../../src/composables/useTauriEvents", () => ({
  AUDIO_PREVIEW_LEVEL: "audio:preview-level",
  listenToEvent: mockListen,
}));
vi.mock("@vueuse/core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@vueuse/core")>(),
  useRafFn: () => ({ pause: mockPause, resume: mockResume }),
}));

type DeviceList = {
  devices: AudioInputDeviceInfo[];
  defaultDeviceName: string | null;
};

function createDeviceList(name = "Test microphone"): DeviceList {
  return { devices: [{ name }], defaultDeviceName: name };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("SettingsAudioInput", () => {
  let wrapper: VueWrapper | undefined;

  function mountInput() {
    wrapper = mount(SettingsAudioInput, {
      global: {
        plugins: [createI18n({ legacy: false, locale: "en", messages: { en } })],
      },
    });
    return wrapper;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    settingsStore.selectedAudioInputDeviceName = "";
    mockGetDevices.mockReset().mockResolvedValue(createDeviceList());
    mockSaveDevice.mockReset().mockImplementation(async (deviceName: string) => {
      settingsStore.selectedAudioInputDeviceName = deviceName;
    });
    mockInvoke.mockReset().mockResolvedValue(undefined);
    mockListen.mockReset().mockResolvedValue(mockUnlisten);
  });

  afterEach(async () => {
    wrapper?.unmount();
    wrapper = undefined;
    await flushPromises();
    vi.restoreAllMocks();
  });

  it("[P1] waits for the list before starting the selected device preview", async () => {
    const list = deferred<DeviceList>();
    mockGetDevices.mockReturnValueOnce(list.promise);
    settingsStore.selectedAudioInputDeviceName = createDeviceList().devices[0].name;
    const input = mountInput();
    await flushPromises();

    expect(mockInvoke).not.toHaveBeenCalledWith("start_audio_preview", expect.anything());
    expect(input.find("#audio-input-device").exists()).toBe(true);
    expect(input.find("label").attributes("for")).toBe("audio-input-device");

    list.resolve(createDeviceList());
    await flushPromises();

    expect(mockInvoke).toHaveBeenCalledWith("start_audio_preview", {
      deviceName: settingsStore.selectedAudioInputDeviceName,
    });
    expect(input.find('[role="meter"]').attributes("aria-label")).toBe(
      en.settings.audioInput.volumePreview,
    );
  });

  it("[P0] never starts native preview when the initial list resolves after unmount", async () => {
    const list = deferred<DeviceList>();
    mockGetDevices.mockReturnValueOnce(list.promise);
    const input = mountInput();

    input.unmount();
    list.resolve(createDeviceList());
    await flushPromises();

    expect(mockInvoke).toHaveBeenCalledWith("stop_audio_preview");
    expect(mockInvoke).not.toHaveBeenCalledWith("start_audio_preview", expect.anything());
    expect(mockListen).not.toHaveBeenCalled();
  });

  it("[P1] waits for the initial list before previewing an imported device", async () => {
    const list = deferred<DeviceList>();
    mockGetDevices.mockReturnValueOnce(list.promise);
    mountInput();

    settingsStore.selectedAudioInputDeviceName = createDeviceList("Imported microphone").devices[0].name;
    await flushPromises();
    expect(mockInvoke).not.toHaveBeenCalledWith("start_audio_preview", expect.anything());

    list.resolve(createDeviceList());
    await flushPromises();

    expect(mockInvoke.mock.calls.filter(([command]) => command === "start_audio_preview")).toEqual([
      ["start_audio_preview", { deviceName: settingsStore.selectedAudioInputDeviceName }],
    ]);
  });

  it("[P1] restarts preview once for a device saved through the control", async () => {
    const input = mountInput();
    await flushPromises();
    mockInvoke.mockClear();

    input.findComponent(Select).vm.$emit("update:modelValue", createDeviceList().devices[0].name);
    await flushPromises();

    expect(mockSaveDevice).toHaveBeenCalledWith(createDeviceList().devices[0].name);
    expect(mockInvoke.mock.calls.filter(([command]) => command === "start_audio_preview")).toEqual([
      ["start_audio_preview", { deviceName: createDeviceList().devices[0].name }],
    ]);
    expect(input.text()).toContain(en.settings.audioInput.updated);
  });

  it("[P1] restarts preview for an imported device without saving it again", async () => {
    const input = mountInput();
    await flushPromises();
    mockInvoke.mockClear();

    settingsStore.selectedAudioInputDeviceName = createDeviceList("Imported microphone").devices[0].name;
    await flushPromises();

    expect(mockInvoke).toHaveBeenCalledWith("start_audio_preview", {
      deviceName: settingsStore.selectedAudioInputDeviceName,
    });
    expect(input.findComponent(Select).props("modelValue")).toBe(
      settingsStore.selectedAudioInputDeviceName,
    );
    expect(mockSaveDevice).not.toHaveBeenCalled();
  });

  it("[P1] restores the system-default value and preview when selected", async () => {
    settingsStore.selectedAudioInputDeviceName = createDeviceList().devices[0].name;
    const input = mountInput();
    await flushPromises();
    mockInvoke.mockClear();

    input.findComponent(Select).vm.$emit("update:modelValue", "_default");
    await flushPromises();

    expect(mockSaveDevice).toHaveBeenCalledWith("");
    expect(mockInvoke).toHaveBeenCalledWith("start_audio_preview", { deviceName: "" });
    expect(input.findComponent(Select).props("modelValue")).toBe("_default");
  });

  it("[P1] refreshes the list and previews the latest device only after it resolves", async () => {
    const input = mountInput();
    await flushPromises();
    const refreshedList = deferred<DeviceList>();
    mockGetDevices.mockReturnValueOnce(refreshedList.promise);
    mockInvoke.mockClear();

    await input.find('button[aria-label="Refresh"]').trigger("click");
    settingsStore.selectedAudioInputDeviceName = createDeviceList("Imported microphone").devices[0].name;
    await flushPromises();

    expect(input.find('button[aria-label="Refresh"]').attributes("disabled")).toBeDefined();
    expect(mockInvoke).not.toHaveBeenCalledWith("start_audio_preview", expect.anything());

    refreshedList.resolve(createDeviceList("Refreshed microphone"));
    await flushPromises();

    expect(mockGetDevices).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenCalledWith("start_audio_preview", {
      deviceName: settingsStore.selectedAudioInputDeviceName,
    });
    expect(input.text()).toContain("1 device(s) detected");
    expect(input.find('button[aria-label="Refresh"]').attributes("disabled")).toBeUndefined();
  });

  it("[P0] never restarts preview when a refresh resolves after unmount", async () => {
    const input = mountInput();
    await flushPromises();
    const refreshedList = deferred<DeviceList>();
    mockGetDevices.mockReturnValueOnce(refreshedList.promise);
    await input.find('button[aria-label="Refresh"]').trigger("click");
    mockInvoke.mockClear();

    input.unmount();
    refreshedList.resolve(createDeviceList());
    await flushPromises();

    expect(mockInvoke).not.toHaveBeenCalledWith("start_audio_preview", expect.anything());
    expect(mockUnlisten).toHaveBeenCalledOnce();
  });

  it("[P1] displays initial list errors without starting preview and allows retry", async () => {
    mockGetDevices.mockRejectedValueOnce("Device enumeration failed");
    const input = mountInput();
    await flushPromises();

    expect(input.findAll('[role="status"]').some(
      (feedback) => feedback.text().includes("Device enumeration failed"),
    )).toBe(true);
    expect(mockInvoke).not.toHaveBeenCalledWith("start_audio_preview", expect.anything());

    await input.find('button[aria-label="Refresh"]').trigger("click");
    await flushPromises();

    expect(input.text()).toContain("1 device(s) detected");
    expect(mockInvoke).toHaveBeenCalledWith("start_audio_preview", { deviceName: "" });
  });

  it("[P1] displays refresh errors instead of a false success or restarting preview", async () => {
    const input = mountInput();
    await flushPromises();
    mockGetDevices.mockRejectedValueOnce("Refresh failed");
    mockInvoke.mockClear();

    await input.find('button[aria-label="Refresh"]').trigger("click");
    await flushPromises();

    expect(input.text()).toContain("Refresh failed");
    expect(input.text()).not.toContain("device(s) detected");
    expect(mockInvoke).not.toHaveBeenCalledWith("start_audio_preview", expect.anything());
  });

  it("[P1] previews a device saved during a failed refresh", async () => {
    const input = mountInput();
    await flushPromises();
    const refreshedList = deferred<DeviceList>();
    mockGetDevices.mockReturnValueOnce(refreshedList.promise);
    mockInvoke.mockClear();

    await input.find('button[aria-label="Refresh"]').trigger("click");
    const deviceName = createDeviceList().devices[0].name;
    input.findComponent(Select).vm.$emit("update:modelValue", deviceName);
    await flushPromises();

    expect(settingsStore.selectedAudioInputDeviceName).toBe(deviceName);
    expect(mockInvoke).not.toHaveBeenCalledWith("start_audio_preview", expect.anything());

    refreshedList.reject("Refresh failed");
    await flushPromises();

    expect(input.text()).toContain("Refresh failed");
    expect(input.text()).not.toContain("device(s) detected");
    expect(mockInvoke.mock.calls.filter(([command]) => command === "start_audio_preview")).toEqual([
      ["start_audio_preview", { deviceName }],
    ]);
  });

  it("[P0] never reconciles a failed refresh after unmount", async () => {
    const input = mountInput();
    await flushPromises();
    const refreshedList = deferred<DeviceList>();
    mockGetDevices.mockReturnValueOnce(refreshedList.promise);
    await input.find('button[aria-label="Refresh"]').trigger("click");
    settingsStore.selectedAudioInputDeviceName = createDeviceList().devices[0].name;
    await flushPromises();
    input.unmount();
    mockInvoke.mockClear();

    refreshedList.reject("Refresh failed");
    await flushPromises();

    expect(mockInvoke).not.toHaveBeenCalledWith("start_audio_preview", expect.anything());
  });

  it("[P1] displays string save errors and retains the current device preview", async () => {
    const input = mountInput();
    await flushPromises();
    mockSaveDevice.mockRejectedValueOnce("Device settings could not be saved");
    mockInvoke.mockClear();

    input.findComponent(Select).vm.$emit("update:modelValue", createDeviceList().devices[0].name);
    await flushPromises();

    expect(input.text()).toContain("Device settings could not be saved");
    expect(settingsStore.selectedAudioInputDeviceName).toBe("");
    expect(mockInvoke).not.toHaveBeenCalledWith("start_audio_preview", expect.anything());
  });

  it("[P0] never starts preview when a device save completes after unmount", async () => {
    const input = mountInput();
    await flushPromises();
    const save = deferred<void>();
    mockSaveDevice.mockImplementationOnce(async (deviceName: string) => {
      await save.promise;
      settingsStore.selectedAudioInputDeviceName = deviceName;
    });
    input.findComponent(Select).vm.$emit("update:modelValue", createDeviceList().devices[0].name);
    await flushPromises();
    input.unmount();
    mockInvoke.mockClear();

    save.resolve();
    await flushPromises();

    expect(mockInvoke).not.toHaveBeenCalledWith("start_audio_preview", expect.anything());
  });

  it("[P0] preserves cancellation while a native preview start is still pending", async () => {
    const start = deferred<void>();
    mockInvoke.mockImplementation((command: string) =>
      command === "start_audio_preview" ? start.promise : Promise.resolve(),
    );
    const input = mountInput();
    await flushPromises();
    expect(mockInvoke).toHaveBeenCalledWith("start_audio_preview", { deviceName: "" });

    input.unmount();
    start.resolve();
    await flushPromises();

    expect(mockListen).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
  });

  it("[P0] cleans up listeners that resolve after unmount", async () => {
    const listener = deferred<() => void>();
    mockListen.mockReturnValueOnce(listener.promise);
    const input = mountInput();
    await flushPromises();
    expect(mockListen).toHaveBeenCalledOnce();

    input.unmount();
    listener.resolve(mockUnlisten);
    await flushPromises();

    expect(mockUnlisten).toHaveBeenCalledOnce();
    expect(mockResume).not.toHaveBeenCalled();
    expect(mockPause).toHaveBeenCalled();
  });
});
