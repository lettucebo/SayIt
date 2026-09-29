import { describe, expect, it } from "vitest";
import { parseRateLimitInfo } from "../../src/lib/enhancementRateLimit";

describe("parseRateLimitInfo", () => {
  it("[P0] parses Groq TPM metadata without retaining organization or response text", () => {
    const info = parseRateLimitInfo(
      "groq",
      new Headers({
        "retry-after": "1.5",
        "x-ratelimit-limit-tokens": "8000",
        "x-ratelimit-limit-requests": "1000",
        "x-ratelimit-remaining-tokens": "120",
        "x-ratelimit-remaining-requests": "998",
      }),
      '{"error":{"message":"Rate limit reached for organization org_private on tokens per minute (TPM): Limit 8000, Used 7800, Requested 400. Please try again in 1.5s."}}',
    );
    expect(info).toEqual({
      kind: "tpm",
      retryAfterMs: 1500,
      limit: 8000,
      used: 7800,
      requested: 400,
      remainingTokens: 120,
      remainingRequests: 998,
      limitTokens: 8000,
      limitRequests: 1000,
    });
    expect(JSON.stringify(info)).not.toContain("org_private");
  });

  it("[P0] identifies daily quota, which cannot be retried within two seconds", () => {
    expect(
      parseRateLimitInfo(
        "groq",
        new Headers({ "retry-after": "1" }),
        '{"error":{"message":"Rate limit reached on requests per day (RPD): Limit 1000, Used 1000, Requested 1."}}',
      ),
    ).toMatchObject({ kind: "rpd", retryAfterMs: 1000 });
  });

  it("[P1] rejects malformed retry hints and never parses arbitrary provider body text", () => {
    expect(
      parseRateLimitInfo(
        "openai",
        new Headers({ "retry-after": "-1", "x-ratelimit-remaining-tokens": "9" }),
        '{"error":{"message":"try again in 1s on tokens per minute (TPM)"}}',
      ),
    ).toEqual({ kind: "unknown" });
  });

  it("[P1] accepts Groq body delay only when header is absent", () => {
    expect(
      parseRateLimitInfo(
        "groq",
        new Headers(),
        '{"error":{"message":"Please try again in 850ms."}}',
      ),
    ).toEqual({ kind: "unknown", retryAfterMs: 850 });
  });
});
