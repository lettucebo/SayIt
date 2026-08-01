import { describe, it, expect } from "vitest";
import {
  AZURE_AUTH_MODE_VALUES,
  isAzureAuthMode,
  toAzureAuthMode,
  toAzureAuthHeaderMode,
  isAzureUserAuthMode,
  type AzureAuthMode,
} from "../../src/types/settings";
import { sanitizeSettingsPayload } from "../../src/lib/settingsTransfer";
import { redactSensitiveString } from "../../src/lib/sentryScrubbing";
import { matchesCredentials, findSignInErrorKey } from "../../src/lib/azureUserAuth";
import zhTW from "../../src/i18n/locales/zh-TW.json";
import zhCN from "../../src/i18n/locales/zh-CN.json";
import en from "../../src/i18n/locales/en.json";
import ja from "../../src/i18n/locales/ja.json";
import ko from "../../src/i18n/locales/ko.json";

// 這組測試守住一個關鍵不變式：
//   「使用者選的驗證模式」與「HTTP 要送哪種 header」是兩件事。
// 兩者混用會讓 access token 被塞進 api-key header，請求必然 401。

describe("Azure auth mode", () => {
  describe("wire header mapping", () => {
    it("[P0] 服務主體與使用者登入都映射為 bearer", () => {
      expect(toAzureAuthHeaderMode("entra")).toBe("bearer");
      expect(toAzureAuthHeaderMode("entraUser")).toBe("bearer");
    });

    it("[P0] API Key 模式映射為 key", () => {
      expect(toAzureAuthHeaderMode("key")).toBe("key");
    });

    it("[P0] 每個持久化模式都有對應的 wire 值", () => {
      for (const mode of AZURE_AUTH_MODE_VALUES) {
        expect(["key", "bearer"]).toContain(toAzureAuthHeaderMode(mode));
      }
    });
  });

  describe("runtime validation", () => {
    it("[P0] 只接受已知模式", () => {
      for (const mode of AZURE_AUTH_MODE_VALUES) {
        expect(isAzureAuthMode(mode)).toBe(true);
      }
    });

    it("[P0] 拒絕未知值與非字串", () => {
      for (const value of ["", "bearer", "ENTRA", "entrauser", null, 1, {}]) {
        expect(isAzureAuthMode(value)).toBe(false);
      }
    });

    it("[P0] 正規化時未知值退回最保守的 key", () => {
      expect(toAzureAuthMode("entraUser")).toBe("entraUser");
      expect(toAzureAuthMode("bogus")).toBe("key");
      expect(toAzureAuthMode(undefined)).toBe("key");
    });

    it("[P1] 只有 entraUser 需要互動登入", () => {
      expect(isAzureUserAuthMode("entraUser")).toBe(true);
      expect(isAzureUserAuthMode("entra")).toBe(false);
      expect(isAzureUserAuthMode("key")).toBe(false);
    });
  });

  describe("backup import", () => {
    it("[P0] 丟棄備份中不合法的 azureAuthMode", () => {
      // 備份是可任意編輯的 JSON——光檢查 typeof 會讓未知模式一路進到 store
      const result = sanitizeSettingsPayload({
        azureAuthMode: "totally-bogus",
        azureEndpoint: "https://r.openai.azure.com",
      });
      expect(result.azureAuthMode).toBeUndefined();
      expect(result.azureEndpoint).toBe("https://r.openai.azure.com");
    });

    it("[P0] 保留合法的舊備份值", () => {
      for (const mode of AZURE_AUTH_MODE_VALUES) {
        const result = sanitizeSettingsPayload({ azureAuthMode: mode });
        expect(result.azureAuthMode).toBe(mode);
      }
    });
  });
});

describe("Azure user account binding", () => {
  const account = {
    username: "user@contoso.com",
    name: "User",
    tenantId: "t1",
    clientId: "c1",
  };

  it("[P0] 帳號必須同時對應 tenant 與 client", () => {
    expect(matchesCredentials(account, { tenantId: "t1", clientId: "c1" })).toBe(
      true,
    );
  });

  it("[P0] 換了 client id 就不算已登入", () => {
    // 只判斷 account 非 null 會讓使用者改了 Client ID 後誤以為仍已登入
    expect(matchesCredentials(account, { tenantId: "t1", clientId: "c2" })).toBe(
      false,
    );
    expect(matchesCredentials(account, { tenantId: "t2", clientId: "c1" })).toBe(
      false,
    );
  });

  it("[P0] 未登入時回 false", () => {
    expect(matchesCredentials(null, { tenantId: "t1", clientId: "c1" })).toBe(
      false,
    );
  });
});

describe("Sentry scrubbing of OAuth tokens", () => {
  it("[P0] 遮蔽 JSON 形式的 token 欄位", () => {
    // Entra 的 refresh token 不是 JWT、也不帶 Bearer 前綴 → 只靠樣式抓不到
    const payload =
      '{"refresh_token":"0.AXoAopaque-not-a-jwt_value","expires_in":3600}';
    const scrubbed = redactSensitiveString(payload);
    expect(scrubbed).not.toContain("opaque-not-a-jwt_value");
    expect(scrubbed).toContain("expires_in");
  });

  it("[P0] 遮蔽 form-encoded 形式的 token 欄位", () => {
    const body =
      "grant_type=refresh_token&refresh_token=0.AXoAsecret-value&client_id=abc";
    const scrubbed = redactSensitiveString(body);
    expect(scrubbed).not.toContain("secret-value");
    expect(scrubbed).toContain("client_id=abc");
  });

  it("[P0] 遮蔽 access_token / id_token / code_verifier", () => {
    for (const field of ["access_token", "id_token", "code_verifier"]) {
      const scrubbed = redactSensitiveString(`{"${field}":"leaked-secret"}`);
      expect(scrubbed).not.toContain("leaked-secret");
    }
  });
});

describe("exhaustiveness", () => {
  it("[P1] 新增模式時提醒同步 wire 映射", () => {
    // 這裡刻意寫死清單：新增 AzureAuthMode 成員時測試會失敗，
    // 提醒同步更新 llmProvider header 分支與 Rust 的 parse_auth_header_mode。
    const expected: AzureAuthMode[] = ["key", "entra", "entraUser"];
    expect([...AZURE_AUTH_MODE_VALUES]).toEqual(expected);
  });
});

describe("登入錯誤訊息", () => {
  // Rust 端的錯誤原文是給開發者看的英文，直接顯示在設定頁只會讓使用者
  // 不知道下一步該做什麼。訊息固定的變體必須有對應的 i18n key。
  const localeMessages: Record<string, { settings: { azure: unknown } }> = {
    "zh-TW": zhTW,
    "zh-CN": zhCN,
    en,
    ja,
    ko,
  };

  it.each([
    ["sign-in timed out", "settings.azure.signInTimedOut"],
    ["sign-in already in progress", "settings.azure.signInInProgress"],
    ["Entra configuration incomplete", "settings.azure.signInConfigIncomplete"],
    ["invalid tenant id", "settings.azure.invalidTenantId"],
    ["invalid client id", "settings.azure.invalidClientId"],
  ])("[P1] %s 對應到可讀的說明", (message, key) => {
    expect(findSignInErrorKey(message)).toBe(key);
  });

  it("[P0] 帶 AADSTS 說明的錯誤必須保留原文", () => {
    // 那串原文是使用者拿去找 IT 的唯一依據，不可被翻譯蓋掉
    expect(
      findSignInErrorKey("interaction required: AADSTS50173 something"),
    ).toBeNull();
    expect(findSignInErrorKey("token request failed: dns error")).toBeNull();
  });

  it("[P1] 五個語系都有對應字串", () => {
    const keys = [
      "signInTimedOut",
      "signInInProgress",
      "signInConfigIncomplete",
      "invalidTenantId",
      "invalidClientId",
    ];
    for (const [locale, json] of Object.entries(localeMessages)) {
      const azure = json.settings.azure as Record<string, unknown>;
      for (const key of keys) {
        const value = azure[key];
        expect(
          typeof value === "string" && value.length > 0,
          `${locale} 缺少 settings.azure.${key}`,
        ).toBe(true);
      }
    }
  });
});
