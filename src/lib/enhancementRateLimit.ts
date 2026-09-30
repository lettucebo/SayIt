import type { LlmProviderId } from "./modelRegistry";

export type RateLimitKind = "itpm" | "otpm" | "tpm" | "rpm" | "rpd" | "tpd" | "unknown";

export interface RateLimitInfo {
  kind: RateLimitKind;
  retryAfterMs?: number;
  limit?: number;
  used?: number;
  requested?: number;
  limitTokens?: number;
  limitRequests?: number;
  remainingTokens?: number;
  remainingRequests?: number;
  errorType?: "tokens";
  errorCode?: "rate_limit_exceeded";
}

function nonNegativeNumber(value: string | null): number | undefined {
  if (value === null || !/^\d+(?:\.\d+)?$/.test(value.trim())) return;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  const seconds = nonNegativeNumber(value);
  if (seconds !== undefined) return seconds * 1000;
  if (!value) return;
  const date = Date.parse(value);
  const delay = date - Date.now();
  return Number.isFinite(date) && delay >= 0 ? delay : undefined;
}

export function parseRateLimitInfo(
  provider: LlmProviderId,
  headers: Headers,
  body: string,
): RateLimitInfo {
  const info: RateLimitInfo = { kind: "unknown" };
  const headerDelay = retryAfterMs(headers);
  if (headerDelay !== undefined) info.retryAfterMs = headerDelay;
  if (provider !== "groq") return info;

  for (const [key, header] of [
    ["limitTokens", "x-ratelimit-limit-tokens"],
    ["limitRequests", "x-ratelimit-limit-requests"],
    ["remainingTokens", "x-ratelimit-remaining-tokens"],
    ["remainingRequests", "x-ratelimit-remaining-requests"],
  ] as const) {
    const value = nonNegativeNumber(headers.get(header));
    if (value !== undefined) info[key] = value;
  }

  let message: string | undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const error = parsed.error;
      if (typeof error === "object" && error !== null && "message" in error) {
        message = typeof error.message === "string" ? error.message : undefined;
        if ("type" in error && error.type === "tokens") info.errorType = "tokens";
        if ("code" in error && error.code === "rate_limit_exceeded") {
          info.errorCode = "rate_limit_exceeded";
        }
      }
    }
  } catch {
    return info;
  }
  if (!message) return info;

  const kindMatch = message.match(/\b(ITPM|OTPM|TPM|RPM|RPD|TPD)\b/i);
  if (kindMatch) info.kind = kindMatch[1].toLowerCase() as RateLimitKind;
  for (const [key, label] of [
    ["limit", "Limit"],
    ["used", "Used"],
    ["requested", "Requested"],
  ] as const) {
    const value = nonNegativeNumber(
      message.match(new RegExp(`\\b${label}\\s*:?\\s*(\\d+(?:\\.\\d+)?)`, "i"))?.[1] ?? null,
    );
    if (value !== undefined) info[key] = value;
  }
  if (info.retryAfterMs === undefined) {
    const hint = message.match(/\btry again in (\d+(?:\.\d+)?)\s*(ms|s)\b/i);
    const delay = nonNegativeNumber(hint?.[1] ?? null);
    if (delay !== undefined) {
      info.retryAfterMs = delay * (hint?.[2].toLowerCase() === "ms" ? 1 : 1000);
    }
  }
  return info;
}
