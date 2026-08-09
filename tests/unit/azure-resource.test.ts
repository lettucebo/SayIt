import { describe, expect, it } from "vitest";
import {
  deriveAzureResourceOrigin,
  isValidAzureResourceName,
  migrateLegacyAzureEndpoints,
  parseAzureResourceName,
  resolveAzureResourceOrigins,
} from "../../src/lib/azureResource";

describe("Azure resource endpoint model", () => {
  it("[P0] derives every Azure host from a valid resource name", () => {
    expect(deriveAzureResourceOrigin("voice-resource", "openai")).toBe(
      "https://voice-resource.openai.azure.com",
    );
    expect(deriveAzureResourceOrigin("voice-resource", "foundry")).toBe(
      "https://voice-resource.services.ai.azure.com",
    );
    expect(deriveAzureResourceOrigin("voice-resource", "speech")).toBe(
      "https://voice-resource.cognitiveservices.azure.com",
    );
  });

  it("[P0] rejects values that could change the generated request host", () => {
    for (const value of [
      "",
      "a",
      "resource.",
      "-resource",
      "resource-",
      "resource.name",
      "resource/name",
      "resource\\name",
      "resource@evil",
      "資源",
    ]) {
      expect(isValidAzureResourceName(value), value).toBe(false);
    }
  });

  it("[P1] parses only a single valid resource label on supported Azure hosts", () => {
    expect(
      parseAzureResourceName("https://voice-resource.services.ai.azure.com"),
    ).toEqual({
      resourceName: "voice-resource",
      kind: "foundry",
    });
    expect(
      parseAzureResourceName("https://voice.private.openai.azure.com"),
    ).toBeUndefined();
  });

  it("[P0] preserves a legacy Foundry origin as a main override", () => {
    const migrated = migrateLegacyAzureEndpoints({
      azureEndpoint: "https://voice.services.ai.azure.com",
    });

    expect(migrated.settings).toMatchObject({
      azureResourceName: "voice",
      azureEndpointOverride: "https://voice.services.ai.azure.com",
    });
    expect(migrated.settings.azureEndpoint).toBeUndefined();
    expect(migrated.legacyKeysToDelete).toEqual(["azureEndpoint"]);
  });

  it("[P0] migrates legacy project endpoint without replacing an explicit project name", () => {
    const migrated = migrateLegacyAzureEndpoints({
      azureEndpoint:
        "https://voice.services.ai.azure.com/api/projects/legacy-project",
      azureProjectName: "explicit-project",
    });

    expect(migrated.settings.azureProjectName).toBe("explicit-project");
  });

  it("[P0] keeps Whisper on the current main origin while Speech resolves separately", () => {
    expect(
      resolveAzureResourceOrigins({
        resourceName: "main",
        whisperResourceName: "",
        speechResourceName: "speech",
        endpointOverride: "https://main.services.ai.azure.com",
        whisperEndpointOverride: "",
        speechEndpointOverride: "",
      }),
    ).toEqual({
      main: "https://main.services.ai.azure.com",
      whisper: "https://main.services.ai.azure.com",
      speech: "https://speech.cognitiveservices.azure.com",
      foundry: "https://main.services.ai.azure.com",
    });
  });

  it("[P1] is idempotent after legacy keys are removed", () => {
    const first = migrateLegacyAzureEndpoints({
      azureEndpoint: "https://voice.openai.azure.com",
    });
    const second = migrateLegacyAzureEndpoints(first.settings);

    expect(second.settings).toEqual(first.settings);
    expect(second.legacyKeysToDelete).toEqual([]);
  });

  it("[P1] keeps an unmigratable legacy endpoint instead of deleting it", () => {
    const migrated = migrateLegacyAzureEndpoints({
      azureEndpoint: "https://legacy.contoso.example",
    });

    expect(migrated.settings.azureEndpoint).toBe(
      "https://legacy.contoso.example",
    );
    expect(migrated.legacyKeysToDelete).toEqual([]);
  });
});
