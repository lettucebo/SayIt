import { fetch } from "@tauri-apps/plugin-http";

// ── Entra ID（App Registration / client credentials）認證 ──────
//
// Azure / Microsoft Foundry 資源常設 disableLocalAuth=true（僅 Entra），
// 因此需以 service principal 換取 bearer token 呼叫資料面 REST。
// token 約 60–90 分到期且無 refresh token，過期後重打即可，這裡做記憶體快取。

export interface AzureEntraCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

// scope 依目標 host 不同：
//  - v1 chat（/openai/v1/）與 *.services.ai.azure.com → Foundry scope
//  - 傳統 deployments 路徑（/openai/deployments/.../audio）與 *.cognitiveservices → Cognitive scope
export const AZURE_SCOPE_FOUNDRY = "https://ai.azure.com/.default";
export const AZURE_SCOPE_COGNITIVE =
  "https://cognitiveservices.azure.com/.default";

/**
 * 依 endpoint host 推導 Entra token scope：
 *  - Foundry 專案端點（*.services.ai.azure.com）→ ai.azure.com 受眾
 *  - 傳統 Azure OpenAI / Cognitive Services（*.openai.azure.com、*.cognitiveservices.azure.com）→ cognitiveservices 受眾
 */
export function getAzureScopeForEndpoint(endpoint: string): string {
  if (endpoint.toLowerCase().includes("services.ai.azure.com")) {
    return AZURE_SCOPE_FOUNDRY;
  }
  return AZURE_SCOPE_COGNITIVE;
}

export class AzureAuthError extends Error {
  constructor(
    public statusCode: number,
    public body: string,
  ) {
    super(`Azure Entra token request failed: ${statusCode}`);
    this.name = "AzureAuthError";
  }
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

const tokenCache = new Map<string, CachedToken>();
// 提前 60 秒刷新，避免邊界期 token 剛好失效
const EXPIRY_BUFFER_MS = 60_000;

function buildCacheKey(
  credentials: AzureEntraCredentials,
  scope: string,
): string {
  return `${credentials.tenantId}|${credentials.clientId}|${scope}`;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

export async function getAzureAccessToken(
  credentials: AzureEntraCredentials,
  scope: string,
): Promise<string> {
  if (
    !credentials.tenantId ||
    !credentials.clientId ||
    !credentials.clientSecret
  ) {
    throw new AzureAuthError(0, "Entra credentials incomplete");
  }

  const cacheKey = buildCacheKey(credentials, scope);
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - EXPIRY_BUFFER_MS > now) {
    return cached.accessToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
    credentials.tenantId,
  )}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scope,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // ignore
    }
    throw new AzureAuthError(response.status, detail);
  }

  const json = (await response.json()) as TokenResponse;
  if (!json.access_token) {
    throw new AzureAuthError(response.status, "No access_token in response");
  }

  const expiresInMs = (json.expires_in ?? 3600) * 1000;
  tokenCache.set(cacheKey, {
    accessToken: json.access_token,
    expiresAtMs: now + expiresInMs,
  });

  return json.access_token;
}

/** 憑證變更或刪除時呼叫，清掉舊 token 快取。 */
export function clearAzureTokenCache(): void {
  tokenCache.clear();
}
