import { test, expect } from "../support/fixtures";
import {
  getStoreSetCount,
  installTauriMock,
} from "../support/helpers/tauriMock";

/**
 * MAI-Transcribe 模型選擇的 UI 驗證。
 *
 * 不驗證 wire 形狀（1.5 的扁平 transcribeStyle vs v2 的 modelOptions）——
 * 那在 Rust 端有專屬回歸測試，且前端根本看不到。這裡只驗證使用者實際操作的部分：
 * 兩個模型都能選、說明文字跟著切換、選擇會被持久化。
 */
const SETTINGS_URL = "/main-window.html#/settings";

const MAI_STORE_BASE = {
  azureEnabled: true,
  whisperProviderId: "mai",
  azureSpeechResourceName: "my-speech",
  azureApiKey: "test-key",
  azureAuthMode: "key",
  selectedLocale: "zh-TW",
};

async function openMaiSettings(
  page: import("@playwright/test").Page,
  extraStoreValues: Record<string, unknown> = {},
) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installTauriMock(page, {
    storeValues: { ...MAI_STORE_BASE, ...extraStoreValues },
  });
  await page.goto(SETTINGS_URL, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("whisper-provider-group")).toBeVisible();
}

test.describe("MAI-Transcribe 模型選擇", () => {
  test("[P0] 既有 MAI 使用者（無模型鍵）UI 顯示 1.5", async ({ page }) => {
    await openMaiSettings(page);

    const trigger = page.getByTestId("mai-transcription-model");
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText("MAI-Transcribe 1.5");
  });

  test("[P0] 已存 v2 時 UI 顯示 2 並帶出對應說明", async ({ page }) => {
    await openMaiSettings(page, {
      maiTranscriptionModelId: "mai-transcribe-2",
    });

    const trigger = page.getByTestId("mai-transcription-model");
    await expect(trigger).toContainText("MAI-Transcribe 2");
    // v2 專屬說明（60 種語言）應取代 1.5 的說明
    await expect(page.getByText("支援 60 種語言")).toBeVisible();
  });

  test("[P0] 切換模型會持久化，且說明文字同步更新", async ({ page }) => {
    await openMaiSettings(page);

    const trigger = page.getByTestId("mai-transcription-model");
    await expect(trigger).toContainText("MAI-Transcribe 1.5");
    await expect(page.getByText("上一代模型")).toBeVisible();

    await trigger.click();
    await page.getByRole("option", { name: "MAI-Transcribe 2" }).click();

    await expect(trigger).toContainText("MAI-Transcribe 2");
    await expect(page.getByText("支援 60 種語言")).toBeVisible();
    expect(
      await getStoreSetCount(page, "maiTranscriptionModelId"),
    ).toBeGreaterThan(0);
  });

  test("[P0] 兩個模型共用同一組語言與風格選項", async ({ page }) => {
    // 語言與逐字稿風格對兩代皆適用（wire 差異由 Rust 吸收），
    // 因此切換模型不應讓這兩個控制項消失或改變可選值。
    await openMaiSettings(page, {
      maiTranscriptionModelId: "mai-transcribe-2",
    });

    await expect(page.locator("#mai-input-locale")).toBeVisible();
    await expect(page.locator("#mai-transcribe-style")).toBeVisible();

    await page.locator("#mai-transcribe-style").click();
    await expect(page.getByRole("option", { name: /可讀性最佳化/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /逐字保留/ })).toBeVisible();
  });
});
