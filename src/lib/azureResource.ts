export type AzureResourceEndpointKind = "openai" | "foundry" | "speech";

export interface AzureResourceOrigins {
  main: string;
  whisper: string;
  speech: string;
  foundry: string;
}

export interface AzureResourceSettings {
  resourceName: string;
  whisperResourceName: string;
  speechResourceName: string;
  endpointOverride: string;
  whisperEndpointOverride: string;
  speechEndpointOverride: string;
}

export interface AzureResourceNameParseResult {
  resourceName: string;
  kind: AzureResourceEndpointKind;
}

export interface AzureEndpointMigrationResult {
  settings: Record<string, unknown>;
  legacyKeysToDelete: Array<"azureEndpoint" | "azureSpeechEndpoint">;
}

const AZURE_RESOURCE_SUFFIXES: Record<AzureResourceEndpointKind, string> = {
  openai: ".openai.azure.com",
  foundry: ".services.ai.azure.com",
  speech: ".cognitiveservices.azure.com",
};

const RESOURCE_NAME_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])$/;

function hasOwn(settings: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(settings, key);
}

function getTrimmedString(
  settings: Record<string, unknown>,
  key: string,
): string {
  const value = settings[key];
  return typeof value === "string" ? value.trim() : "";
}

function getAzureOrigin(value: string): string {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== ""
    ) {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

function getProjectName(value: string): string {
  try {
    const url = new URL(value.trim());
    const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/?$/);
    if (!match) return "";
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

export function isValidAzureResourceName(value: string): boolean {
  return RESOURCE_NAME_PATTERN.test(value.trim());
}

export function normalizeAzureResourceName(value: string): string {
  const normalized = value.trim().toLowerCase();
  return isValidAzureResourceName(normalized) ? normalized : "";
}

export function deriveAzureResourceOrigin(
  resourceName: string,
  kind: AzureResourceEndpointKind,
): string {
  const normalizedName = normalizeAzureResourceName(resourceName);
  return normalizedName === ""
    ? ""
    : `https://${normalizedName}${AZURE_RESOURCE_SUFFIXES[kind]}`;
}

export function parseAzureResourceName(
  endpoint: string,
): AzureResourceNameParseResult | undefined {
  const origin = getAzureOrigin(endpoint);
  if (origin === "") return undefined;

  const host = new URL(origin).hostname.toLowerCase();
  for (const [kind, suffix] of Object.entries(AZURE_RESOURCE_SUFFIXES) as Array<
    [AzureResourceEndpointKind, string]
  >) {
    if (!host.endsWith(suffix)) continue;
    const resourceName = host.slice(0, -suffix.length);
    if (isValidAzureResourceName(resourceName)) {
      return { resourceName: resourceName.toLowerCase(), kind };
    }
  }
  return undefined;
}

export function normalizeAzureEndpointOverride(value: string): string {
  const origin = getAzureOrigin(value);
  if (origin === "") return "";
  return parseAzureResourceName(origin) ? origin : "";
}

export function resolveAzureResourceOrigins(
  settings: AzureResourceSettings,
): AzureResourceOrigins {
  const main =
    normalizeAzureEndpointOverride(settings.endpointOverride) ||
    deriveAzureResourceOrigin(settings.resourceName, "openai");
  const whisper =
    normalizeAzureEndpointOverride(settings.whisperEndpointOverride) ||
    deriveAzureResourceOrigin(settings.whisperResourceName, "openai") ||
    main;
  const speech =
    normalizeAzureEndpointOverride(settings.speechEndpointOverride) ||
    deriveAzureResourceOrigin(
      settings.speechResourceName || settings.resourceName,
      "speech",
    );
  const foundry = deriveAzureResourceOrigin(settings.resourceName, "foundry");

  return { main, whisper, speech, foundry };
}

/**
 * Converts the persisted endpoint model without changing an existing effective
 * origin. A legacy endpoint that differs from the new canonical host remains
 * an override, which is required for private DNS and proxy deployments.
 */
export function migrateLegacyAzureEndpoints(
  input: Record<string, unknown>,
): AzureEndpointMigrationResult {
  const settings = { ...input };
  const legacyKeysToDelete: AzureEndpointMigrationResult["legacyKeysToDelete"] =
    [];

  const migrateEndpoint = ({
    legacyKey,
    resourceNameKey,
    overrideKey,
    canonicalKind,
  }: {
    legacyKey: "azureEndpoint" | "azureSpeechEndpoint";
    resourceNameKey: string;
    overrideKey: string;
    canonicalKind: AzureResourceEndpointKind;
  }) => {
    if (!hasOwn(input, legacyKey)) return;
    if (hasOwn(input, resourceNameKey) || hasOwn(input, overrideKey)) {
      legacyKeysToDelete.push(legacyKey);
      delete settings[legacyKey];
      return;
    }

    const legacyEndpoint = getTrimmedString(input, legacyKey);
    const origin = getAzureOrigin(legacyEndpoint);
    if (origin === "") return;

    const parsed = parseAzureResourceName(origin);
    if (!parsed) return;

    legacyKeysToDelete.push(legacyKey);
    delete settings[legacyKey];
    settings[resourceNameKey] = parsed.resourceName;
    if (
      origin !== deriveAzureResourceOrigin(parsed.resourceName, canonicalKind)
    ) {
      settings[overrideKey] = origin;
    }
  };

  migrateEndpoint({
    legacyKey: "azureEndpoint",
    resourceNameKey: "azureResourceName",
    overrideKey: "azureEndpointOverride",
    canonicalKind: "openai",
  });
  migrateEndpoint({
    legacyKey: "azureSpeechEndpoint",
    resourceNameKey: "azureSpeechResourceName",
    overrideKey: "azureSpeechEndpointOverride",
    canonicalKind: "speech",
  });

  if (!hasOwn(input, "azureProjectName")) {
    const projectName = getProjectName(getTrimmedString(input, "azureEndpoint"));
    if (projectName !== "") settings.azureProjectName = projectName;
  }

  return { settings, legacyKeysToDelete };
}
