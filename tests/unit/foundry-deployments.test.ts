import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mockFetch }));

import {
  AzureDeploymentListError,
  listAzureChatDeployments,
  listAzureV1Models,
  listFoundryDeployments,
} from "../../src/lib/foundryDeployments";

function successResponse(json: unknown) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(json),
  };
}

describe("Foundry deployments data plane", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const options = {
    foundryEndpoint: "https://resource.services.ai.azure.com",
    v1Endpoint: "https://resource.openai.azure.com",
    projectName: "voice-project",
    authMode: "key" as const,
    authValue: "api-key",
  };

  it("[P0] 分頁列出部署並只保留 capabilities.chat=true 的項目", async () => {
    mockFetch
      .mockResolvedValueOnce(
        successResponse({
          value: [
            {
              name: "deepseek-chat",
              type: "ModelDeployment",
              modelName: "DeepSeek-V4-Flash",
              modelPublisher: "DeepSeek",
              modelVersion: "1",
              capabilities: { chat: "true" },
            },
            {
              name: "embedding",
              type: "ModelDeployment",
              modelName: "text-embedding-3-large",
              modelPublisher: "OpenAI",
              modelVersion: "1",
              capabilities: { embeddings: "true" },
            },
          ],
          nextLink:
            "https://resource.services.ai.azure.com/api/projects/voice-project/deployments?api-version=v1&page=2",
        }),
      )
      .mockResolvedValueOnce(
        successResponse({
          value: [
            {
              name: "kimi-chat",
              type: "ModelDeployment",
              modelName: "Kimi-K2.6",
              modelPublisher: "Moonshot AI",
              modelVersion: "1",
              capabilities: { chat_completion: true },
            },
          ],
        }),
      );

    await expect(listFoundryDeployments(options)).resolves.toEqual([
      {
        name: "deepseek-chat",
        source: "foundry",
        modelName: "DeepSeek-V4-Flash",
        modelPublisher: "DeepSeek",
        modelVersion: "1",
        capabilities: { chat: "true" },
      },
      {
        name: "kimi-chat",
        source: "foundry",
        modelName: "Kimi-K2.6",
        modelPublisher: "Moonshot AI",
        modelVersion: "1",
        capabilities: { chat_completion: "true" },
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://resource.services.ai.azure.com/api/projects/voice-project/deployments?api-version=v1",
    );
    expect(mockFetch.mock.calls[0][1].headers["api-key"]).toBe("api-key");
  });

  it("[P0] Foundry project 無法讀取時降級至 v1 名稱清單", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: vi.fn().mockResolvedValue("Forbidden"),
      })
      .mockResolvedValueOnce(
        successResponse({
          data: [{ id: "fallback-deployment" }],
        }),
      );

    await expect(listAzureChatDeployments(options)).resolves.toEqual({
      deploymentList: [{ name: "fallback-deployment", source: "v1" }],
      source: "v1",
      fallbackReason: "foundry-request-failed",
    });
    expect(mockFetch.mock.calls[1][0]).toBe(
      "https://resource.openai.azure.com/openai/v1/models",
    );
  });

  it("[P1] 未提供 project 名稱時直接使用 v1 名稱清單", async () => {
    mockFetch.mockResolvedValueOnce(
      successResponse({ data: [{ id: "manual-deployment" }] }),
    );

    await expect(
      listAzureChatDeployments({ ...options, projectName: "" }),
    ).resolves.toEqual({
      deploymentList: [{ name: "manual-deployment", source: "v1" }],
      source: "v1",
      fallbackReason: "project-not-configured",
    });
  });

  it("[P0] 無法辨識 capability 時顯示未驗證候選項而不是隱藏全部", async () => {
    mockFetch.mockResolvedValueOnce(
      successResponse({
        value: [
          {
            name: "custom-chat",
            type: "ModelDeployment",
            modelName: "CustomModel",
            modelPublisher: "Contoso",
            modelVersion: "1",
            capabilities: { conversational: "true" },
          },
        ],
      }),
    );

    await expect(listAzureChatDeployments(options)).resolves.toEqual({
      deploymentList: [
        {
          name: "custom-chat",
          source: "foundry",
          modelName: "CustomModel",
          modelPublisher: "Contoso",
          modelVersion: "1",
          capabilities: { conversational: "true" },
        },
      ],
      source: "foundry",
      capabilityFiltered: false,
      fallbackReason: "capability-unverified",
    });
  });

  it("[P1] v1 清單只取 id，沒有假裝提供模型 metadata", async () => {
    mockFetch.mockResolvedValueOnce(
      successResponse({
        data: [
          {
            id: "chat-deployment",
            owned_by: "OpenAI",
            unknownField: "ignored",
          },
        ],
      }),
    );

    await expect(
      listAzureV1Models({
        v1Endpoint: options.v1Endpoint,
        foundryEndpoint: options.foundryEndpoint,
        authMode: "bearer",
        authValue: "token",
      }),
    ).resolves.toEqual([{ name: "chat-deployment", source: "v1" }]);
  });

  it("[P1] 回應失敗時保留 HTTP status 與 diagnostic body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue("Unauthorized"),
    });

    const error = await listFoundryDeployments(options).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AzureDeploymentListError);
    expect((error as AzureDeploymentListError).statusCode).toBe(401);
  });
});
