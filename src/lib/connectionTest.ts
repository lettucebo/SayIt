import { invoke } from "@tauri-apps/api/core";
import { enhanceText } from "./enhancer";
import {
  getEnhancementErrorMessage,
  getTranscriptionErrorMessage,
} from "./errorUtils";
import type { LlmProviderId, WhisperModelId } from "./modelRegistry";
import type { AzureRequestOptions } from "./llmProvider";

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
      errorMessage: getEnhancementErrorMessage(err),
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
      errorMessage: getTranscriptionErrorMessage(err),
    };
  }
}

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}
