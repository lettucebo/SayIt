import { load } from "@tauri-apps/plugin-store";
import { normalizeAzureEndpoint } from "./llmProvider";

const STORE_NAME = "settings.json";
const KEY_PREFIX = "azureTemperatureCapability:";
const CAPABILITY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface AzureTemperatureCapability {
  supportsTemperature: boolean;
  detectedAt: string;
}

function getKey(endpoint: string, deploymentName: string): string {
  return `${KEY_PREFIX}${normalizeAzureEndpoint(endpoint)}|${deploymentName.trim()}`;
}

function isCapability(
  value: unknown,
): value is AzureTemperatureCapability {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).supportsTemperature === "boolean" &&
    typeof (value as Record<string, unknown>).detectedAt === "string"
  );
}

export async function getAzureTemperatureCapability(
  endpoint: string,
  deploymentName: string,
): Promise<AzureTemperatureCapability | undefined> {
  if (!endpoint || !deploymentName.trim()) return undefined;
  const store = await load(STORE_NAME);
  const value = await store.get(getKey(endpoint, deploymentName));
  if (!isCapability(value)) return undefined;
  const detectedAtMs = Date.parse(value.detectedAt);
  return Number.isFinite(detectedAtMs) &&
    Date.now() - detectedAtMs <= CAPABILITY_MAX_AGE_MS
    ? value
    : undefined;
}

export async function setAzureTemperatureCapability(
  endpoint: string,
  deploymentName: string,
  supportsTemperature: boolean,
): Promise<void> {
  if (!endpoint || !deploymentName.trim()) return;
  const store = await load(STORE_NAME);
  await store.set(getKey(endpoint, deploymentName), {
    supportsTemperature,
    detectedAt: new Date().toISOString(),
  } satisfies AzureTemperatureCapability);
  await store.save();
}

export async function clearAzureTemperatureCapability(
  endpoint: string,
  deploymentName: string,
): Promise<void> {
  if (!endpoint || !deploymentName.trim()) return;
  const store = await load(STORE_NAME);
  await store.delete(getKey(endpoint, deploymentName));
  await store.save();
}
