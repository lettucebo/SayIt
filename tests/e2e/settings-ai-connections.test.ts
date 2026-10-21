import { test, expect } from "../support/fixtures";
import { failNextStoreSave, getStoreSetCount, installTauriMock } from "../support/helpers/tauriMock";

const SETTINGS = "/main-window.html#/settings";

test("[P0] Gemini 雙用途只保留一個憑證入口", async ({ page }) => {
  await installTauriMock(page, {
    storeValues: {
      selectedLocale: "zh-TW",
      whisperProviderId: "gemini",
      llmProviderId: "gemini",
      geminiApiKey: "example-key-not-a-real-credential",
    },
  });

  await page.goto(`${SETTINGS}?section=connections&connection=gemini`);
  await expect(page.getByTestId("gemini-credential-input")).toHaveCount(1);
});

test("[P0] 儲存失敗保留憑證草稿，成功後可供另一用途使用", async ({ page }) => {
  await installTauriMock(page, { storeValues: { selectedLocale: "zh-TW" } });
  await page.goto(`${SETTINGS}?section=connections&connection=gemini`);
  const input = page.getByTestId("gemini-credential-input");
  await input.fill("synthetic-gemini-key");
  await failNextStoreSave(page);
  await page.getByTestId("connection-gemini-save").click();
  await expect(page.getByTestId("connection-gemini-feedback")).toContainText("E2E_SETTINGS_SAVE_FAILED");
  await expect(input).toHaveValue("synthetic-gemini-key");
  await page.getByTestId("connection-gemini-save").click();
  await expect(page.getByTestId("connection-gemini-feedback")).toContainText("已儲存");
  await page.getByTestId("settings-section-select").click();
  await page.getByTestId("settings-section-option-ai").click();
  await page.getByTestId("whisper-provider-option-gemini").click();
  await page.getByTestId("llm-provider-option-openai").click();
  await expect(page.getByTestId("whisper-provider-radio-gemini")).toHaveAttribute("data-state", "checked");
  await expect(page.getByTestId("llm-provider-radio-openai")).toHaveAttribute("data-state", "checked");
  await expect(page.getByTestId("ai-transcription-test")).toBeEnabled();
  await expect(page.getByTestId("ai-enhancement-test")).toBeDisabled();
});

test("[P0] 未選用的服務也能管理，分類切換保留金鑰草稿但不儲存", async ({ page }) => {
  await installTauriMock(page, { storeValues: { selectedLocale: "zh-TW" } });
  await page.goto(`${SETTINGS}?section=connections&connection=gemini`);
  const input = page.getByTestId("gemini-credential-input");
  await expect(input).toBeVisible();
  const before = await getStoreSetCount(page, "geminiApiKey");
  await input.fill("draft-not-a-real-key");
  await page.getByTestId("settings-section-select").click();
  await page.getByTestId("settings-section-option-ai").click();
  await expect(page.getByTestId("settings-section-ai")).toBeVisible();
  await page.getByTestId("settings-section-select").click();
  await page.getByTestId("settings-section-option-connections").click();
  await expect(input).toHaveValue("draft-not-a-real-key");
  expect(await getStoreSetCount(page, "geminiApiKey")).toBe(before);
});

test("[P0] Azure 未儲存連線不允許部署載入，開關不夾帶草稿", async ({ page }) => {
  await installTauriMock(page, {
    storeValues: {
      selectedLocale: "zh-TW",
      azureEnabled: true,
      azureResourceName: "saved-resource",
      azureApiKey: "example-azure-key",
      azureChatDeployment: "chat-deployment",
      llmProviderId: "azure",
    },
  });
  await page.goto(`${SETTINGS}?section=connections&connection=azure&workflow=enhancement`);
  await expect(page.getByTestId("azure-connection-save")).toBeVisible();
  const before = await getStoreSetCount(page, "azureResourceName");
  const enabledBefore = await getStoreSetCount(page, "azureEnabled");
  await page.getByTestId("azure-resource-name").fill("unsaved-resource");
  await page.getByTestId("azure-enabled").click();
  await expect(page.getByTestId("azure-enabled")).toHaveAttribute("data-state", "checked");
  await expect(page.getByTestId("connection-unsaved-warning")).toBeVisible();
  expect(await getStoreSetCount(page, "azureResourceName")).toBe(before);
  expect(await getStoreSetCount(page, "azureEnabled")).toBe(enabledBefore);
  await page.getByTestId("connection-return-to-workflow").click();
  await expect(page.getByTestId("azure-chat-load-deployments")).toBeDisabled();
  await expect(page.getByTestId("ai-enhancement-test")).toBeDisabled();
  expect(await getStoreSetCount(page, "azureResourceName")).toBe(before);
});

test("[P0] Azure 儲存正規化連線後解除草稿限制，失敗則保留輸入", async ({ page }) => {
  await installTauriMock(page, {
    storeValues: {
      selectedLocale: "zh-TW",
      azureEnabled: true,
      azureResourceName: "saved-resource",
      azureEndpointOverride: "https://saved-resource.openai.azure.com",
      azureApiKey: "example-azure-key",
      azureChatDeployment: "chat-deployment",
      llmProviderId: "azure",
    },
  });
  await page.goto(`${SETTINGS}?section=connections&connection=azure&workflow=enhancement`);
  const resource = page.getByTestId("azure-resource-name");
  await page.getByTestId("azure-advanced-overrides-toggle").click();
  const endpoint = page.getByTestId("azure-endpoint-override");
  await resource.fill("MiXeD-ReSoUrCe");
  await endpoint.fill("https://MiXeD-ReSoUrCe.openai.azure.com/");
  await failNextStoreSave(page);
  await page.getByTestId("azure-connection-save").click();
  await expect(resource).toHaveValue("MiXeD-ReSoUrCe");
  await expect(endpoint).toHaveValue("https://MiXeD-ReSoUrCe.openai.azure.com/");
  await expect(page.getByTestId("connection-unsaved-warning")).toBeVisible();

  await page.getByTestId("azure-connection-save").click();
  await expect(resource).toHaveValue("mixed-resource");
  await expect(endpoint).toHaveValue("https://mixed-resource.openai.azure.com");
  await expect(page.getByTestId("connection-unsaved-warning")).toHaveText("");
  await page.getByTestId("connection-return-to-workflow").click();
  await expect(page.getByTestId("azure-chat-load-deployments")).toBeEnabled();
  await expect(page.getByTestId("ai-enhancement-test")).toBeEnabled();
  await page.getByTestId("ai-enhancement-manage-connection").click();
  await page.getByTestId("azure-enabled").click();
  await expect(page.getByTestId("azure-enabled")).toHaveAttribute("data-state", "unchecked");
});

test("[P0] Azure 保留 Client Secret 原值，不將已存空白誤判為草稿", async ({ page }) => {
  await installTauriMock(page, {
    storeValues: {
      selectedLocale: "zh-TW",
      azureEnabled: true,
      azureResourceName: "saved-resource",
      azureApiKey: "example-azure-key",
      azureClientSecret: " synthetic-secret-not-a-real-credential ",
      azureChatDeployment: "chat-deployment",
      llmProviderId: "azure",
    },
  });
  await page.goto(`${SETTINGS}?section=connections&connection=azure&workflow=enhancement`);
  await expect(page.getByTestId("azure-connection-save")).toBeVisible();
  await expect(page.getByTestId("connection-unsaved-warning")).toHaveText("");
  await page.getByTestId("azure-connection-save").click();
  await expect(page.getByTestId("connection-unsaved-warning")).toHaveText("");
  await page.getByTestId("connection-return-to-workflow").click();
  await expect(page.getByTestId("azure-chat-load-deployments")).toBeEnabled();
  await expect(page.getByTestId("ai-enhancement-test")).toBeEnabled();
});

for (const endpointOverride of ["", "https://saved-resource.openai.azure.com"]) {
  test(`[P1] Azure 進階預設收合（${endpointOverride ? "有" : "無"}已存覆寫），手動開合不儲存`, async ({ page }) => {
    await installTauriMock(page, {
      storeValues: {
        selectedLocale: "zh-TW",
        azureEnabled: true,
        azureResourceName: "saved-resource",
        azureEndpointOverride: endpointOverride,
        azureApiKey: "example-azure-key",
      },
    });
    await page.goto(`${SETTINGS}?section=connections&connection=azure`);
    const toggle = page.getByTestId("azure-advanced-overrides-toggle");
    const advanced = page.getByTestId("azure-advanced-overrides");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(advanced).toHaveCount(0);
    const before = await getStoreSetCount(page, "azureEndpointOverride");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("azure-endpoint-override")).toHaveValue(endpointOverride);
    await toggle.click();
    await expect(advanced).toHaveCount(0);
    expect(await getStoreSetCount(page, "azureEndpointOverride")).toBe(before);
    await page.getByTestId("azure-connection-save").click();
    await expect(page.getByTestId("connection-unsaved-warning")).toHaveText("");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(page.getByTestId("azure-endpoint-override")).toHaveValue(endpointOverride);
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(advanced).toHaveCount(0);
  });
}
