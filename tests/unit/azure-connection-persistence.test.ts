import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// 這組測試守住一條規則：**儲存連線設定不可silently 破壞使用者資料**。
//
// 起因是真實事故：切換到 entraUser 模式時，saveAzureConnection 會把
// azureClientSecret 清成空字串。使用者的 client secret 因此消失，
// 要切回 Secret 模式就得回 Azure Portal 重新產生——不可逆、且無任何提示。

const mockStoreData = new Map<string, unknown>();
const mockStoreGet = vi.fn(async (key: string) => mockStoreData.get(key));
const mockStoreSet = vi.fn(async (key: string, value: unknown) => {
  mockStoreData.set(key, value);
});
const mockStoreDelete = vi.fn(async (key: string) => {
  mockStoreData.delete(key);
});
const mockStoreSave = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: mockStoreGet,
    set: mockStoreSet,
    delete: mockStoreDelete,
    save: mockStoreSave,
  })),
}));

const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

const mockEmit = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/event", () => ({ emit: mockEmit }));

vi.mock("@tauri-apps/api/app", () => ({
  setDockVisibility: vi.fn().mockResolvedValue(undefined),
}));

const SECRET = "test-client-secret-value-40-characters!!";
const TENANT = "2aeb30d9-f0a6-4e27-8c47-f97c5b695eb6";
const CLIENT = "1671ffd4-5c2a-44dd-83a2-e1c8267aa51b";

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    endpoint: "https://demo.openai.azure.com",
    authMode: "entra" as const,
    apiKey: "",
    tenantId: TENANT,
    clientId: CLIENT,
    clientSecret: SECRET,
    apiVersion: "",
    ...overrides,
  };
}

describe("saveAzureConnection 的資料保存性", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockStoreData.clear();
    mockStoreGet.mockClear();
    mockStoreSet.mockClear();
    mockInvoke.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("[P0] 切換到 entraUser 模式不可清掉 client secret", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.saveAzureConnection(baseConfig());
    expect(mockStoreData.get("azureClientSecret")).toBe(SECRET);

    // 使用者改用 Entra ID 登入 —— secret 必須原封不動保留，
    // 否則要切回 Secret 模式得回 Azure Portal 重新產生
    await store.saveAzureConnection(
      baseConfig({ authMode: "entraUser", clientSecret: SECRET }),
    );
    expect(mockStoreData.get("azureClientSecret")).toBe(SECRET);
    expect(mockStoreData.get("azureAuthMode")).toBe("entraUser");
  });

  it("[P0] 反覆登入（先存後登入流程）不會逐次侵蝕 secret", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    // 登入流程會先呼叫一次儲存，重複登入即重複儲存
    for (let i = 0; i < 3; i++) {
      await store.saveAzureConnection(
        baseConfig({ authMode: "entraUser", clientSecret: SECRET }),
      );
    }
    expect(mockStoreData.get("azureClientSecret")).toBe(SECRET);
  });

  it("[P1] 使用者明確清空 secret 時才寫入空值", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    await store.saveAzureConnection(baseConfig());
    expect(mockStoreData.get("azureClientSecret")).toBe(SECRET);

    await store.saveAzureConnection(baseConfig({ clientSecret: "" }));
    expect(mockStoreData.get("azureClientSecret")).toBe("");
  });

  it("[P0] 其他既有設定不會因儲存而遺失", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    mockStoreData.set("groqApiKey", "groq-key");
    mockStoreData.set("geminiApiKey", "gemini-key");

    await store.saveAzureConnection(baseConfig({ authMode: "entraUser" }));

    expect(mockStoreData.get("groqApiKey")).toBe("groq-key");
    expect(mockStoreData.get("geminiApiKey")).toBe("gemini-key");
  });
});
