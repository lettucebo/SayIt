import { describe, expect, it } from "vitest";
import { filterSentryIntegrations } from "../../src/lib/sentry";

describe("filterSentryIntegrations", () => {
  it("[P0] retains unrelated integrations but removes BrowserSession and Dedupe", () => {
    const integrations = [
      { name: "BrowserSession" },
      { name: "Dedupe" },
      { name: "GlobalHandlers" },
    ];
    expect(filterSentryIntegrations(integrations)).toEqual([
      { name: "GlobalHandlers" },
    ]);
  });
});
