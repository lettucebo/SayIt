import { invoke } from "@tauri-apps/api/core";

// ── Entra 使用者委派登入（Authorization Code + PKCE）─────────
//
// 與 azureAuth.ts（服務主體 + client secret）的差別：
// 這裡是「使用者用自己的公司帳號登入」，App 不持有任何長期共享密鑰。
//
// token 的快取、refresh 與持久化全部在 Rust：HUD 與 Dashboard 是兩個獨立
// WebView，若各自快取就會有兩份 refresh 節奏，而 Entra 的 refresh token
// 每次使用都會輪替，兩邊互相覆蓋會導致登入狀態莫名失效。

export interface AzureUserAccount {
  /** preferred_username / upn / sub，取第一個有值的；不同帳號類型 claim 組合不一致 */
  username: string | null;
  name: string | null;
  tenantId: string;
  /** 綁定用：改了 client id 就不算同一個登入狀態 */
  clientId: string;
}

export interface AzureUserCredentials {
  tenantId: string;
  clientId: string;
}

/** 用途 → scope 的對應由 Rust 決定，前端無法指定任意 audience。 */
export type AzureUserScopeKind = "chat" | "whisper";

export function newSignInOperationId(): string {
  return crypto.randomUUID();
}

export async function signInAzureUser(
  credentials: AzureUserCredentials,
  operationId: string,
): Promise<AzureUserAccount> {
  return invoke<AzureUserAccount>("azure_user_sign_in", {
    tenantId: credentials.tenantId,
    clientId: credentials.clientId,
    operationId,
  });
}

/** 帶 operationId 才不會取消到「下一次」登入。 */
export async function cancelAzureUserSignIn(
  operationId: string,
): Promise<void> {
  await invoke("azure_user_cancel_sign_in", { operationId });
}

export async function signOutAzureUser(
  credentials: AzureUserCredentials,
): Promise<void> {
  await invoke("azure_user_sign_out", {
    tenantId: credentials.tenantId,
    clientId: credentials.clientId,
  });
}

export async function getAzureUserAccount(
  credentials: AzureUserCredentials,
): Promise<AzureUserAccount | null> {
  if (!credentials.tenantId || !credentials.clientId) return null;
  return invoke<AzureUserAccount | null>("azure_user_get_account", {
    tenantId: credentials.tenantId,
    clientId: credentials.clientId,
  });
}

export async function getAzureUserToken(
  credentials: AzureUserCredentials,
  scopeKind: AzureUserScopeKind,
): Promise<string> {
  return invoke<string>("azure_user_get_token", {
    tenantId: credentials.tenantId,
    clientId: credentials.clientId,
    scopeKind,
  });
}

/**
 * 已登入的帳號是否對應目前這組設定。
 * 只判斷 account 非 null 不夠——使用者改了 Client ID 但 ref 還是舊帳號時會誤判。
 */
export function matchesCredentials(
  account: AzureUserAccount | null,
  credentials: AzureUserCredentials,
): boolean {
  if (!account) return false;
  return (
    account.tenantId === credentials.tenantId &&
    account.clientId === credentials.clientId
  );
}

/** refresh token 失效（撤銷／過期／需重新同意）→ 必須重新互動登入，不是重試就能解決。 */
export function isInteractionRequiredError(message: string): boolean {
  return message.includes("interaction required");
}

export function isNotSignedInError(message: string): boolean {
  return message.includes("not signed in");
}

export function isSignInCancelledError(message: string): boolean {
  return message.includes("sign-in cancelled");
}

/**
 * 被 tenant 政策（Conditional Access 等）擋下。
 * 與「使用者自行取消」分開處理：後者不需要提示，前者要把 AADSTS 說明留給
 * 使用者拿去找 IT，否則使用者會以為是自己按了取消。
 */
export function isPolicyDeniedError(message: string): boolean {
  return message.includes("sign-in blocked by policy");
}

/**
 * Rust `AzureUserAuthError` 的固定訊息 → i18n key。
 *
 * 這些錯誤原文是給開發者看的英文，直接丟到設定頁只會讓使用者不知道下一步。
 * 只對「訊息完全固定」的變體做對應——`Failed(String)` 與帶 AADSTS 說明的
 * 變體必須保留原文，那才是使用者拿去找 IT 的依據。
 */
const SIGN_IN_ERROR_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["sign-in timed out", "settings.azure.signInTimedOut"],
  ["sign-in already in progress", "settings.azure.signInInProgress"],
  ["Entra configuration incomplete", "settings.azure.signInConfigIncomplete"],
  ["invalid tenant id", "settings.azure.invalidTenantId"],
  ["invalid client id", "settings.azure.invalidClientId"],
];

/** 找不到對應時回 null，呼叫端須保留原始訊息。 */
export function findSignInErrorKey(message: string): string | null {
  return (
    SIGN_IN_ERROR_KEYS.find(([needle]) => message.includes(needle))?.[1] ?? null
  );
}
