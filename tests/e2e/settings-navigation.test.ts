import { test, expect } from "../support/fixtures";
import { getInvokeCount, getStoreSetCount, installTauriMock } from "../support/helpers/tauriMock";

const SETTINGS = "/main-window.html#/settings";

test("[P0] 預設 AI 分類沒有金鑰編輯器，也不啟動麥克風", async ({ page }) => {
  await installTauriMock(page, {
    storeValues: {
      selectedLocale: "zh-TW",
      whisperProviderId: "gemini",
      geminiApiKey: "example-key-not-a-real-credential",
    },
  });
  await page.goto(SETTINGS);
  await expect(page.getByTestId("settings-section-ai")).toBeVisible();
  await expect(page.getByTestId("gemini-credential-input")).toHaveCount(0);
  await expect(page.getByTestId("ai-setup-hint")).toHaveCount(0);
  await expect(page.getByRole("meter")).toHaveCount(0);
  expect(await getInvokeCount(page, "start_audio_preview")).toBe(0);
});

test("[P1] 管理連線返回同一工作階段並恢復焦點，側欄重回 AI", async ({ page }) => {
  await installTauriMock(page, { storeValues: { selectedLocale: "zh-TW" } });
  await page.goto(SETTINGS);
  const manage = page.getByTestId("ai-transcription-manage-connection");
  await manage.click();
  await expect(page.getByTestId("settings-section-connections")).toBeVisible();
  await page.getByTestId("connection-return-to-workflow").click();
  await expect(manage).toBeFocused();
  await page.getByTestId("settings-section-select").click();
  await page.getByTestId("settings-section-option-general").click();
  await expect(page.getByTestId("settings-section-general")).toBeVisible();
  await expect.poll(() => getInvokeCount(page, "start_audio_preview")).toBe(1);
  await page.getByRole("link", { name: "設定", exact: true }).click();
  await expect(page.getByTestId("settings-section-ai")).toBeVisible();
  await expect.poll(() => getInvokeCount(page, "stop_audio_preview")).toBeGreaterThan(0);
});

test("[P0] 設定載入失敗不可編輯或寫入", async ({ page }) => {
  await installTauriMock(page, {
    storeValues: { selectedLocale: "zh-TW" },
    storeGetError: "E2E_SETTINGS_LOAD_FAILED",
  });
  await page.goto(`${SETTINGS}?section=connections`);
  await expect(page.getByTestId("settings-section-select")).toBeDisabled();
  await expect(page.getByTestId("settings-load-feedback")).toContainText("設定載入失敗");
  await expect(page.getByTestId("groq-credential-input")).toHaveCount(0);
});

for (const { width, height } of [{ width: 960, height: 680 }, { width: 720, height: 480 }]) {
  test(`[P1] ${width}×${height} 開啟設定先見唯一品牌卡片`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await installTauriMock(page, { storeValues: { selectedLocale: "zh-TW" } });
    await page.goto(SETTINGS);
    const settingsPage = page.getByTestId("settings-page");
    const brand = page.getByTestId("settings-brand");
    await expect(settingsPage.locator(":scope > :first-child")).toHaveAttribute(
      "data-testid", "settings-brand",
    );
    await expect(brand).toBeInViewport();
    await expect(brand.getByRole("link")).toHaveCount(9);
    await expect(brand.getByRole("link", { name: "Money Yu", exact: true })).toHaveAttribute(
      "href", "https://github.com/lettucebo",
    );
    await expect(brand.getByRole("link", { name: "Jackle Chen", exact: true })).toHaveAttribute(
      "href", "https://jackle.pro",
    );
    await expect(page.getByTestId("settings-section-ai").locator(":scope > :first-child"))
      .toHaveAttribute("data-testid", "ai-output-preferences");
    for (const section of ["connections", "general", "data", "about"]) {
      await page.getByTestId("settings-section-select").click();
      await page.getByTestId(`settings-section-option-${section}`).click();
      await expect(page.getByTestId(`settings-section-${section}`)).toBeVisible();
      await expect(brand).toHaveCount(1);
    }
    await page.getByTestId("settings-section-select").click();
    await page.getByTestId("settings-section-option-data").click();
    await page.getByTestId("settings-section-data").locator(":scope > :last-child").scrollIntoViewIfNeeded();
    await expect(brand).not.toBeInViewport();
    if (width === 960) {
      await page.getByRole("link", { name: "設定", exact: true }).click();
    } else {
      await page.evaluate(() => { window.location.hash = "/settings"; });
    }
    await expect(page.getByTestId("settings-section-ai")).toBeVisible();
    await expect(brand).toBeInViewport();
    await expect(settingsPage.locator(":scope > :first-child")).toHaveAttribute(
      "data-testid", "settings-brand",
    );
    if (width === 960) {
      await page.getByTestId("ai-prompt-input").scrollIntoViewIfNeeded();
      await expect(brand).not.toBeInViewport();
      await page.getByRole("link", { name: "設定", exact: true }).click();
      await expect(brand).toBeInViewport();
    }
  });

  test(`[P1] ${width}×${height} 五分類與進階設定無水平溢位，鍵盤可切換`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await installTauriMock(page, {
      storeValues: {
        selectedLocale: "en",
        azureEnabled: true,
        azureResourceName: "example-resource",
        azureEndpointOverride: "https://example-resource.openai.azure.com",
      },
    });
    await page.goto(SETTINGS);
    for (const section of ["connections", "general", "data", "about", "ai"]) {
      const select = page.getByTestId("settings-section-select");
      await select.focus();
      await page.keyboard.press("Enter");
      const option = page.getByTestId(`settings-section-option-${section}`);
      await option.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId(`settings-section-${section}`)).toBeVisible();
      if (section === "connections") {
        await page.getByTestId("azure-advanced-overrides-toggle").click();
        await expect(page.getByTestId("azure-advanced-overrides")).toBeVisible();
      }
      await expect.poll(() => page.getByTestId(`settings-section-${section}`).evaluate((element) =>
        element.scrollWidth <= element.clientWidth &&
        document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )).toBe(true);
    }
  });
}

test("[P1] 非白名單分類回 AI，Prompt 草稿切分類不遺失", async ({ page }) => {
  await installTauriMock(page, { storeValues: { selectedLocale: "zh-TW" } });
  await page.goto(`${SETTINGS}?section=unknown&connection=invalid`);
  await expect(page.getByTestId("settings-section-ai")).toBeVisible();
  await page.getByTestId("ai-prompt-input").fill("unsaved-prompt");
  await page.getByTestId("settings-section-select").click();
  await page.getByTestId("settings-section-option-about").click();
  await expect(page.getByTestId("settings-section-about")).toBeVisible();
  await page.getByTestId("settings-section-select").click();
  await page.getByTestId("settings-section-option-ai").click();
  await expect(page.getByTestId("ai-prompt-input")).toHaveValue("unsaved-prompt");
});

test("[P1] 文字輸出偏好置頂且保留語言與複製的即時儲存", async ({ page }) => {
  await installTauriMock(page, {
    storeValues: {
      selectedLocale: "zh-TW",
      selectedTranscriptionLocale: "zh-TW",
      copyTranscriptionToClipboard: false,
    },
  });
  await page.goto(SETTINGS);
  const section = page.getByTestId("settings-section-ai");
  const output = page.getByTestId("ai-output-preferences");
  await expect(output).toHaveCount(1);
  await expect(section.locator(":scope > :first-child")).toHaveAttribute(
    "data-testid", "ai-output-preferences",
  );
  await expect(output.getByTestId("output-locale-select")).toContainText("繁體中文");
  const localeSaves = await getStoreSetCount(page, "selectedTranscriptionLocale");
  const clipboardSaves = await getStoreSetCount(page, "copyTranscriptionToClipboard");
  await output.getByTestId("output-locale-select").click();
  await page.getByTestId("output-locale-option-en").click();
  await expect(output.getByTestId("output-locale-select")).toContainText("English");
  expect(await getStoreSetCount(page, "selectedTranscriptionLocale")).toBe(localeSaves + 1);
  await output.getByTestId("output-copy-to-clipboard").click();
  await expect(output.getByTestId("output-copy-to-clipboard")).toHaveAttribute("data-state", "checked");
  expect(await getStoreSetCount(page, "copyTranscriptionToClipboard")).toBe(clipboardSaves + 1);
});
