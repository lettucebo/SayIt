import { test, expect } from "../support/fixtures";
import packageJson from "../../package.json" with { type: "json" };
import { createTranscriptionRecord } from "../support/factories/transcription-factory";
import { getHttpRequestList, installTauriMock, resolveHttpResponse } from "../support/helpers/tauriMock";

const { version } = packageJson;

function createRow(isEditMode: boolean): Record<string, unknown> {
  const record = createTranscriptionRecord({
    rawText: "這是一段需要重新整理的完整內容",
    processedText: "這是一段既有的編輯結果",
    wasEnhanced: true,
  });
  return {
    id: record.id, timestamp: record.timestamp, raw_text: record.rawText,
    processed_text: record.processedText, recording_duration_ms: record.recordingDurationMs,
    transcription_duration_ms: record.transcriptionDurationMs,
    enhancement_duration_ms: record.enhancementDurationMs,
    char_count: record.charCount, trigger_mode: record.triggerMode, was_enhanced: 1,
    was_modified: null, created_at: record.createdAt, audio_file_path: "mock-recording.wav",
    status: "success", is_edit_mode: isEditMode ? 1 : 0,
    edit_source_text: isEditMode ? "原本選取的內容" : null,
  };
}

test("[P0] 編輯紀錄的兩種重試皆停用且不發請求", async ({ page }) => {
  await installTauriMock(page, {
    storeValues: { groqApiKey: "e2e-placeholder", selectedLocale: "zh-TW", lastSeenVersion: version },
    historyRows: [createRow(true)],
  });
  await page.goto("/main-window.html#/history");
  await expect(page.getByTestId("retranscribe-button")).toBeDisabled();
  await expect(page.getByTestId("reenhance-button")).toBeDisabled();
  expect(await getHttpRequestList(page)).toHaveLength(0);
});

test("[P0] 歷史重試鎖跨路由重建保留，完成後恢復", async ({ page }) => {
  await installTauriMock(page, {
    storeValues: { groqApiKey: "e2e-placeholder", selectedLocale: "zh-TW", lastSeenVersion: version },
    historyRows: [createRow(false)],
    httpResponses: [{
      delayUntil: "history-enhance",
      body: { choices: [{ message: { content: "這是一段需要重新整理的完整內容" }, finish_reason: "stop" }] },
    }],
  });
  await page.goto("/main-window.html#/history");
  await page.getByTestId("reenhance-button").click();
  await expect.poll(async () => (await getHttpRequestList(page)).length).toBe(1);
  await page.evaluate(() => { location.hash = "/settings"; });
  await expect(page.getByTestId("whisper-provider-group")).toBeVisible();
  await page.evaluate(() => { location.hash = "/history"; });
  await expect(page.getByTestId("reenhance-button")).toBeDisabled();
  await expect(page.getByTestId("retranscribe-button")).toBeDisabled();
  expect(await getHttpRequestList(page)).toHaveLength(1);
  await resolveHttpResponse(page, "history-enhance");
  await expect(page.getByTestId("reenhance-button")).toBeEnabled();
});
