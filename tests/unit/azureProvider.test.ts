import { describe, it, expect } from "vitest";
import {
  buildFetchParams,
  normalizeAzureEndpoint,
  parseProviderResponse,
  type LlmChatRequest,
  type AzureRequestOptions,
} from "../../src/lib/llmProvider";
import {
  getAzureScopeForApiKind,
  AZURE_SCOPE_FOUNDRY,
  AZURE_SCOPE_COGNITIVE,
} from "../../src/lib/azureAuth";

const REQUEST: LlmChatRequest = {
  model: "my-gpt4o-deployment",
  messages: [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
  ],
  temperature: 0.1,
  maxTokens: 1024,
};

describe("Azure provider", () => {
  describe("normalizeAzureEndpoint", () => {
    it("[P1] 去尾斜線", () => {
      expect(normalizeAzureEndpoint("https://r.openai.azure.com/")).toBe(
        "https://r.openai.azure.com",
      );
    });

    it("[P1] 去掉多餘的 /openai/v1/chat/completions", () => {
      expect(
        normalizeAzureEndpoint(
          "https://r.openai.azure.com/openai/v1/chat/completions",
        ),
      ).toBe("https://r.openai.azure.com");
    });

    it("[P1] 去掉 /openai 與 /openai/v1", () => {
      expect(normalizeAzureEndpoint("https://r.openai.azure.com/openai")).toBe(
        "https://r.openai.azure.com",
      );
      expect(
        normalizeAzureEndpoint("https://r.services.ai.azure.com/openai/v1"),
      ).toBe("https://r.services.ai.azure.com");
    });

    it("[P1] 去掉含 query string 的完整 URL", () => {
      expect(
        normalizeAzureEndpoint(
          "https://r.openai.azure.com/openai/deployments/x/chat/completions?api-version=2024-10-21",
        ),
      ).toBe("https://r.openai.azure.com");
    });
  });

  describe("getAzureScopeForApiKind", () => {
    it("[P0] chat（v1 路徑 /openai/v1/）→ ai.azure.com", () => {
      expect(getAzureScopeForApiKind("chat")).toBe(AZURE_SCOPE_FOUNDRY);
    });

    it("[P0] whisper（傳統 deployments 路徑）→ cognitiveservices.azure.com", () => {
      expect(getAzureScopeForApiKind("whisper")).toBe(AZURE_SCOPE_COGNITIVE);
    });
  });

  describe("buildFetchParams azure", () => {
    it("[P0] key 模式：v1 URL、api-key header、model=部署名、max_completion_tokens", () => {
      const azure: AzureRequestOptions = {
        endpoint: "https://r.openai.azure.com",
        authMode: "key",
        authValue: "azkey",
      };
      const { url, init } = buildFetchParams("azure", REQUEST, "", azure);

      expect(url).toBe(
        "https://r.openai.azure.com/openai/v1/chat/completions",
      );
      const headers = init.headers as Record<string, string>;
      expect(headers["api-key"]).toBe("azkey");
      expect(headers.Authorization).toBeUndefined();

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("my-gpt4o-deployment");
      expect(body.max_completion_tokens).toBe(1024);
      expect(body.max_tokens).toBeUndefined();
    });

    it("[P0] entra 模式：Authorization Bearer", () => {
      const azure: AzureRequestOptions = {
        endpoint: "https://r.services.ai.azure.com/",
        authMode: "entra",
        authValue: "bearer-token-xyz",
      };
      const { url, init } = buildFetchParams("azure", REQUEST, "", azure);

      expect(url).toBe(
        "https://r.services.ai.azure.com/openai/v1/chat/completions",
      );
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer bearer-token-xyz");
      expect(headers["api-key"]).toBeUndefined();
    });

    it("[P1] apiVersion 帶入 query string", () => {
      const azure: AzureRequestOptions = {
        endpoint: "https://r.openai.azure.com",
        apiVersion: "preview",
        authMode: "key",
        authValue: "k",
      };
      const { url } = buildFetchParams("azure", REQUEST, "", azure);
      expect(url).toBe(
        "https://r.openai.azure.com/openai/v1/chat/completions?api-version=preview",
      );
    });

    it("[P1] 缺 azureOptions 時拋錯", () => {
      expect(() => buildFetchParams("azure", REQUEST, "")).toThrow();
    });

    it("[P1] 回應走 OpenAI-compatible 解析（無 groq 計時欄位）", () => {
      const result = parseProviderResponse("azure", {
        choices: [{ message: { content: "  hello  " } }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      });
      expect(result.text).toBe("hello");
      expect(result.usage?.totalTokens).toBe(5);
      expect(result.usage?.promptTimeMs).toBeUndefined();
    });

    it("[P0] 預設（omitTemperature 未設）：照送 temperature", () => {
      const azure: AzureRequestOptions = {
        endpoint: "https://r.openai.azure.com",
        authMode: "key",
        authValue: "k",
      };
      const { init } = buildFetchParams("azure", REQUEST, "", azure);
      const body = JSON.parse(init.body as string);
      expect(body.temperature).toBe(0.1);
    });

    it("[P0] omitTemperature=true：省略 temperature 且不自動補 reasoning_effort（GPT-5 部署相容）", () => {
      const azure: AzureRequestOptions = {
        endpoint: "https://r.openai.azure.com",
        authMode: "key",
        authValue: "k",
        omitTemperature: true,
      };
      const { init } = buildFetchParams("azure", REQUEST, "", azure);
      const body = JSON.parse(init.body as string);
      expect(body.temperature).toBeUndefined();
      // 刻意不補 reasoning_effort（原始 GPT-5 部署未必支援 "none"）
      expect(body.reasoning_effort).toBeUndefined();
      // 其餘照送
      expect(body.max_completion_tokens).toBe(1024);
    });
  });
});
