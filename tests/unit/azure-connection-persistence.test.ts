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
    await store.loadSettings();

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
    await store.loadSettings();

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
    await store.loadSettings();

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
    await store.loadSettings();

    mockStoreData.set("groqApiKey", "groq-key");
    mockStoreData.set("geminiApiKey", "gemini-key");

    await store.saveAzureConnection(baseConfig({ authMode: "entraUser" }));

    expect(mockStoreData.get("groqApiKey")).toBe("groq-key");
    expect(mockStoreData.get("geminiApiKey")).toBe("gemini-key");
  });

  it("[P0] 設定尚未載入完成時拒絕儲存，避免空白輸入覆寫既有設定", async () => {
    // main-window.ts 先 app.mount() 才 await loadSettings()，所以 SettingsView 的
    // onMounted 可能早於載入完成。此時輸入欄位還是預設空值，存回去會整批清空。
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();

    // 模擬持久層已有使用者資料，但 store 尚未 loadSettings()
    mockStoreData.set("azureEndpoint", "https://real.openai.azure.com");
    mockStoreData.set("azureTenantId", TENANT);
    mockStoreData.set("azureClientId", CLIENT);
    mockStoreData.set("azureClientSecret", SECRET);

    await expect(
      store.saveAzureConnection(
        baseConfig({
          endpoint: "",
          tenantId: "",
          clientId: "",
          clientSecret: "",
        }),
      ),
    ).rejects.toThrow();

    // 既有資料必須毫髮無傷
    expect(mockStoreData.get("azureEndpoint")).toBe(
      "https://real.openai.azure.com",
    );
    expect(mockStoreData.get("azureTenantId")).toBe(TENANT);
    expect(mockStoreData.get("azureClientId")).toBe(CLIENT);
    expect(mockStoreData.get("azureClientSecret")).toBe(SECRET);
  });

  it("[P0] 憑證清除失敗時不可覆寫 tenant/client（否則舊 token 永久孤兒）", async () => {
    // locator（tenant+client）一旦被覆寫，就再也算不出舊憑證的 key。
    // 因此清除失敗必須中止整個儲存，讓使用者能重試。
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();

    await store.saveAzureConnection(baseConfig({ authMode: "entraUser" }));
    expect(mockStoreData.get("azureTenantId")).toBe(TENANT);

    // 讓 azure_user_sign_out 失敗
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "azure_user_sign_out") throw new Error("keyring locked");
      return undefined;
    });

    const OTHER_CLIENT = "99999999-9999-9999-9999-999999999999";
    await expect(
      store.saveAzureConnection(
        baseConfig({ authMode: "entraUser", clientId: OTHER_CLIENT }),
      ),
    ).rejects.toThrow();

    // locator 必須維持舊值，殘留憑證才有機會被清掉
    expect(mockStoreData.get("azureClientId")).toBe(CLIENT);
  });

  it("[P0] 變更身分時會先取消進行中的登入", async () => {
    // 使用者在瀏覽器登入期間按了儲存/清除，若不取消，稍後回來的 callback
    // 仍會把 refresh token 寫回，而此時 locator 已被覆寫 → 孤兒憑證。
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();
    await store.saveAzureConnection(baseConfig({ authMode: "entraUser" }));

    const calls: string[] = [];
    mockInvoke.mockImplementation(async (cmd: string) => {
      calls.push(cmd);
      return undefined;
    });

    const OTHER_TENANT = "88888888-8888-8888-8888-888888888888";
    await store.saveAzureConnection(
      baseConfig({ authMode: "entraUser", tenantId: OTHER_TENANT }),
    );

    const cancelAt = calls.indexOf("azure_user_cancel_sign_in");
    const signOutAt = calls.indexOf("azure_user_sign_out");
    expect(signOutAt).toBeGreaterThanOrEqual(0);
    // 取消若有發出，必須在登出之前
    if (cancelAt >= 0) expect(cancelAt).toBeLessThan(signOutAt);
  });

  it("[P1] 登入失效時要立刻清掉畫面上的已登入帳號", async () => {
    // 否則設定頁一邊顯示「已登入 user@…」，使用者卻每次使用都被要求重新登入。
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "azure_user_get_account") {
        return {
          username: "user@contoso.com",
          name: "User",
          tenantId: TENANT,
          clientId: CLIENT,
        };
      }
      return undefined;
    });
    await store.saveAzureConnection(
      baseConfig({ authMode: "entraUser", chatDeployment: "gpt-4o" }),
    );
    await store.saveAzureChatDeployment("gpt-4o");
    await store.saveLlmProvider("azure");
    await store.refreshAzureUserAccount();
    expect(store.azureUserAccount).not.toBeNull();

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "azure_user_get_token") {
        throw new Error("interaction required (sign-in expired): AADSTS50173");
      }
      return undefined;
    });

    await expect(store.getLlmRequestConfig()).rejects.toThrow();
    expect(store.azureUserAccount).toBeNull();
  });

  it("[P1] 一般網路錯誤不可把使用者登出", async () => {
    // 暫時性故障若也清掉帳號，使用者會以為登入掉了而反覆重新登入。
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "azure_user_get_account") {
        return {
          username: "user@contoso.com",
          name: "User",
          tenantId: TENANT,
          clientId: CLIENT,
        };
      }
      return undefined;
    });
    await store.saveAzureConnection(baseConfig({ authMode: "entraUser" }));
    await store.saveAzureChatDeployment("gpt-4o");
    await store.saveLlmProvider("azure");
    await store.refreshAzureUserAccount();
    expect(store.azureUserAccount).not.toBeNull();

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "azure_user_get_token") {
        throw new Error("token request failed: connection refused");
      }
      return undefined;
    });

    await expect(store.getLlmRequestConfig()).rejects.toThrow();
    expect(store.azureUserAccount).not.toBeNull();
  });

  it("[P1] 輸入框改成別組身分時不可再顯示為已登入", async () => {
    // 否則設定頁會一邊顯示上一組帳號的「已登入」、一邊把登入按鈕藏起來，
    // 使用者會以為新填的 Client ID 已經生效。
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "azure_user_get_account") {
        return {
          username: "user@contoso.com",
          name: "User",
          tenantId: TENANT,
          clientId: CLIENT,
        };
      }
      return undefined;
    });
    await store.saveAzureConnection(baseConfig({ authMode: "entraUser" }));
    await store.refreshAzureUserAccount();

    // 已儲存的那組 → 已登入（前後空白不影響）
    expect(store.matchesSignedInAccount(TENANT, CLIENT)).toBe(true);
    expect(store.matchesSignedInAccount(` ${TENANT} `, ` ${CLIENT} `)).toBe(
      true,
    );

    // 使用者在輸入框換了 Client ID（尚未儲存）→ 不可算已登入
    const OTHER_CLIENT = "99999999-9999-9999-9999-999999999999";
    expect(store.matchesSignedInAccount(TENANT, OTHER_CLIENT)).toBe(false);
  });

  it("[P0] 設定尚未載入完成時拒絕清除連線", async () => {
    // 載入前 reactive 的 tenant/client 是空值，登出會直接回成功，
    // 接著就把使用者既有的 endpoint / client secret 全部刪掉，
    // 而憑證庫那筆 refresh token 反而永遠清不掉。
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    mockStoreData.set("azureEndpoint", "https://demo.openai.azure.com");
    mockStoreData.set("azureClientSecret", SECRET);
    const store = useSettingsStore();

    await expect(store.deleteAzureConnection()).rejects.toThrow(
      "SETTINGS_NOT_LOADED",
    );
    expect(mockStoreData.get("azureClientSecret")).toBe(SECRET);
    expect(mockStoreData.get("azureEndpoint")).toBe(
      "https://demo.openai.azure.com",
    );
  });

  it("[P0] 設定尚未載入完成時拒絕匯入", async () => {
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    mockStoreData.set("azureTenantId", TENANT);
    mockStoreData.set("azureClientId", CLIENT);
    const store = useSettingsStore();

    await expect(
      store.importSettings({ azureTenantId: "other-tenant" }),
    ).rejects.toThrow("SETTINGS_NOT_LOADED");
    expect(mockStoreData.get("azureTenantId")).toBe(TENANT);
  });

  it("[P1] 跨視窗刷新後 Azure 設定是同一版，不會新舊混用", async () => {
    // 語音流程可能在刷新途中呼叫 getLlmRequestConfig；若邊讀邊寫 ref，
    // 會取到新 endpoint 配舊 tenant 的混合設定，把內容送到非預期的資源。
    const { useSettingsStore } = await import(
      "../../src/stores/useSettingsStore"
    );
    const store = useSettingsStore();
    await store.loadSettings();
    await store.saveAzureConnection(baseConfig());

    // 模擬另一個視窗換了一整組設定
    const NEW_TENANT = "77777777-7777-7777-7777-777777777777";
    const NEW_CLIENT = "66666666-6666-6666-6666-666666666666";
    mockStoreData.set("azureEndpoint", "https://other.openai.azure.com");
    mockStoreData.set("azureTenantId", NEW_TENANT);
    mockStoreData.set("azureClientId", NEW_CLIENT);
    mockStoreData.set("azureAuthMode", "key");
    mockStoreData.set("azureApiKey", "new-key");

    await store.refreshCrossWindowSettings();

    expect(store.azureEndpoint).toBe("https://other.openai.azure.com");
    expect(store.azureTenantId).toBe(NEW_TENANT);
    expect(store.azureClientId).toBe(NEW_CLIENT);
    expect(store.azureAuthMode).toBe("key");
    expect(store.azureApiKey).toBe("new-key");
  });
});
