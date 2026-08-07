import { beforeEach, describe, expect, it, vi } from "vitest";

const valueMap = new Map<string, unknown>();
const mockSet = vi.fn(async (key: string, value: unknown) => {
  valueMap.set(key, value);
});
const mockDelete = vi.fn(async (key: string) => {
  valueMap.delete(key);
});
const mockSave = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (key: string) => valueMap.get(key)),
    set: mockSet,
    delete: mockDelete,
    save: mockSave,
  })),
}));

import {
  clearAzureTemperatureCapability,
  getAzureTemperatureCapability,
  setAzureTemperatureCapability,
} from "../../src/lib/azureTemperatureCapability";

describe("Azure temperature capability cache", () => {
  beforeEach(() => {
    valueMap.clear();
    mockSet.mockClear();
    mockDelete.mockClear();
    mockSave.mockClear();
  });

  it("[P0] 以正規化 endpoint 與部署名稱隔離能力快取", async () => {
    await setAzureTemperatureCapability(
      "https://r.services.ai.azure.com/",
      "chat-a",
      false,
    );

    await expect(
      getAzureTemperatureCapability(
        "https://r.services.ai.azure.com",
        "chat-a",
      ),
    ).resolves.toMatchObject({ supportsTemperature: false });
    await expect(
      getAzureTemperatureCapability(
        "https://r.services.ai.azure.com",
        "chat-b",
      ),
    ).resolves.toBeUndefined();
  });

  it("[P1] 部署變更時可清掉舊能力結論", async () => {
    await setAzureTemperatureCapability(
      "https://r.services.ai.azure.com",
      "chat-a",
      false,
    );
    await clearAzureTemperatureCapability(
      "https://r.services.ai.azure.com",
      "chat-a",
    );

    await expect(
      getAzureTemperatureCapability(
        "https://r.services.ai.azure.com",
        "chat-a",
      ),
    ).resolves.toBeUndefined();
  });

  it("[P1] 過期能力結論不可套用到同名重新部署", async () => {
    await setAzureTemperatureCapability(
      "https://r.services.ai.azure.com",
      "chat-a",
      false,
    );
    const [key, value] = [...valueMap.entries()][0];
    valueMap.set(key, {
      ...(value as Record<string, unknown>),
      detectedAt: "2020-01-01T00:00:00.000Z",
    });

    await expect(
      getAzureTemperatureCapability(
        "https://r.services.ai.azure.com",
        "chat-a",
      ),
    ).resolves.toBeUndefined();
  });
});
