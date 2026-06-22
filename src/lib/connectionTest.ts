import { invoke } from "@tauri-apps/api/core";
import { enhanceText, EnhancerApiError } from "./enhancer";
import type { LlmProviderId, WhisperModelId } from "./modelRegistry";
import type { AzureRequestOptions } from "./llmProvider";

/**
 * 連線測試專用的錯誤格式化：盡量保留底層真實原因（HTTP 狀態碼 + 服務回應內容），
 * 而非對使用者友善但會吃掉細節的訊息——因為這是診斷用按鈕，需要看到 Azure/服務
 * 實際回了什麼（例如 RBAC 401 的 PermissionDenied 內容）。
 */
function formatConnectionError(err: unknown): string {
  if (err instanceof EnhancerApiError) {
    const body = err.body?.trim();
    return body
      ? `API error ${err.statusCode}: ${body.slice(0, 400)}`
      : `API error ${err.statusCode}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export interface TestSuccess {
  ok: true;
  durationMs: number;
}

export interface TestFailure {
  ok: false;
  durationMs: number;
  errorMessage: string;
}

export type TestResult = TestSuccess | TestFailure;

export async function testLlmConnection(
  modelId: string,
  apiKey: string,
  extras?: { provider?: LlmProviderId; azure?: AzureRequestOptions },
): Promise<TestResult> {
  const start = performance.now();
  try {
    await enhanceText("ping", apiKey, {
      modelId,
      provider: extras?.provider,
      azure: extras?.azure,
      systemPrompt: "Reply with the word OK only.",
      maxTokens: 50,
    });
    return { ok: true, durationMs: elapsed(start) };
  } catch (err) {
    return {
      ok: false,
      durationMs: elapsed(start),
      errorMessage: formatConnectionError(err),
    };
  }
}

export async function testWhisperConnection(
  modelId: WhisperModelId,
  apiKey: string,
  extras?: {
    provider?: "groq" | "azure";
    endpoint?: string;
    deployment?: string;
    apiVersion?: string;
    authMode?: "key" | "entra";
  },
): Promise<TestResult> {
  const start = performance.now();
  try {
    await invoke("test_whisper_connection", {
      apiKey,
      modelId,
      provider: extras?.provider,
      endpoint: extras?.endpoint ?? null,
      deployment: extras?.deployment ?? null,
      apiVersion: extras?.apiVersion ?? null,
      authMode: extras?.authMode ?? null,
    });
    return { ok: true, durationMs: elapsed(start) };
  } catch (err) {
    return {
      ok: false,
      durationMs: elapsed(start),
      errorMessage: formatConnectionError(err),
    };
  }
}

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}
