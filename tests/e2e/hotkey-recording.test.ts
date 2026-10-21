import packageJson from "../../package.json" with { type: "json" };
import { test, expect } from "../support/fixtures";
import { emitMockTauriEvent, getHotkeyCommands, getStoreSetCount, installTauriMock } from "../support/helpers/tauriMock";

const storeValues = { groqApiKey: "e2e-placeholder", lastSeenVersion: packageJson.version, selectedLocale: "zh-TW" };

test("[P0] native start 立即 captured 仍保存一次並清理", async ({ page }) => {
  await installTauriMock(page, { storeValues, hotkeyCaptureOnStart: { keycode: 120, modifiers: [] } });
  await page.goto("/main-window.html#/settings");
  await page.getByTestId("hotkey-custom-mode").click();
  await page.getByTestId("hotkey-record-button").click();
  await expect.poll(() => getStoreSetCount(page, "customTriggerKey")).toBe(1);
  await expect(page.getByTestId("hotkey-record-button")).toBeEnabled();
  await expect.poll(() => getHotkeyCommands(page)).toEqual(["start_hotkey_recording", "cancel_hotkey_recording"]);
  await emitMockTauriEvent(page, "hotkey:recording-captured", { keycode: 121, modifiers: [] });
  expect(await getStoreSetCount(page, "customTriggerKey")).toBe(1);
});

test("[P0] 取消後舊 captured 不保存，下一輪可成功錄製", async ({ page }) => {
  await installTauriMock(page, { storeValues });
  await page.goto("/main-window.html#/settings");
  await page.getByTestId("hotkey-custom-mode").click();
  const button = page.getByTestId("hotkey-record-button");
  await button.click();
  await expect.poll(() => getHotkeyCommands(page)).toEqual(["start_hotkey_recording"]);
  await button.click();
  await expect(button).toBeEnabled();
  await emitMockTauriEvent(page, "hotkey:recording-captured", { keycode: 120, modifiers: [] });
  expect(await getStoreSetCount(page, "customTriggerKey")).toBe(0);
  await button.click();
  await expect.poll(() => getHotkeyCommands(page)).toEqual([
    "start_hotkey_recording", "cancel_hotkey_recording", "start_hotkey_recording",
  ]);
  await emitMockTauriEvent(page, "hotkey:recording-captured", { keycode: 120, modifiers: [] });
  await expect.poll(() => getStoreSetCount(page, "customTriggerKey")).toBe(1);
  await expect(button).toBeEnabled();
});

test("[P1] native start 失敗後可見錯誤並恢復控制項", async ({ page }) => {
  await installTauriMock(page, { storeValues, hotkeyStartError: "mock-start-failure" });
  await page.goto("/main-window.html#/settings");
  await page.getByTestId("hotkey-custom-mode").click();
  await page.getByTestId("hotkey-record-button").click();
  await expect(page.getByText("mock-start-failure", { exact: true })).toBeVisible();
  await expect(page.getByTestId("hotkey-record-button")).toBeEnabled();
  expect(await getStoreSetCount(page, "customTriggerKey")).toBe(0);
});
