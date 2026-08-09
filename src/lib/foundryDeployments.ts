import { fetch } from "@tauri-apps/plugin-http";
import { normalizeAzureEndpoint } from "./llmProvider";
import type { AzureAuthHeaderMode } from "../types/settings";

export type AzureDeploymentSource = "foundry" | "v1";

export interface AzureChatDeployment {
  name: string;
  source: AzureDeploymentSource;
  modelName?: string;
  modelPublisher?: string;
  modelVersion?: string;
  capabilities?: Record<string, string>;
}

export interface AzureDeploymentListResult {
  deploymentList: AzureChatDeployment[];
  source: AzureDeploymentSource;
  capabilityFiltered?: boolean;
  fallbackReason?:
    | "project-not-configured"
    | "foundry-request-failed"
    | "capability-unverified";
}

export class AzureDeploymentListError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(`Azure deployment list failed: ${statusCode}`);
    this.name = "AzureDeploymentListError";
  }
}

export interface AzureDeploymentListOptions {
  foundryEndpoint: string;
  v1Endpoint: string;
  projectName: string;
  authMode: AzureAuthHeaderMode;
  authValue: string;
}

function buildHeaders(
  authMode: AzureAuthHeaderMode,
  authValue: string,
): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (authMode === "bearer") {
    headers.Authorization = `Bearer ${authValue}`;
  } else {
    headers["api-key"] = authValue;
  }
  return headers;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "boolean") {
      result[key] = String(item);
    }
  }
  return result;
}

function normalizeCapabilityKey(key: string): string {
  return key.replace(/[^a-z]/gi, "").toLowerCase();
}

function isCapabilityEnabled(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

function isChatCapable(capabilities: Record<string, string>): boolean {
  return Object.entries(capabilities).some(
    ([key, value]) =>
      ["chat", "chatcompletion", "chatcompletions"].includes(
        normalizeCapabilityKey(key),
      ) && isCapabilityEnabled(value),
  );
}

function isKnownNonChatOnly(capabilities: Record<string, string>): boolean {
  return Object.entries(capabilities).some(
    ([key, value]) =>
      ["embedding", "embeddings", "imagegeneration", "audio", "whisper"].includes(
        normalizeCapabilityKey(key),
      ) && isCapabilityEnabled(value),
  );
}

function parseFoundryDeploymentList(json: unknown): {
  chatDeploymentList: AzureChatDeployment[];
  unverifiedDeploymentList: AzureChatDeployment[];
  nextLink?: string;
} {
  const data = json as Record<string, unknown>;
  const valueList = Array.isArray(data.value) ? data.value : [];
  const chatDeploymentList: AzureChatDeployment[] = [];
  const unverifiedDeploymentList: AzureChatDeployment[] = [];

  for (const item of valueList) {
    if (!item || typeof item !== "object") continue;
    const deployment = item as Record<string, unknown>;
    const name = deployment.name;
    const capabilities = asStringRecord(deployment.capabilities) ?? {};
    if (typeof name !== "string") continue;
    const entry: AzureChatDeployment = {
      name,
      source: "foundry",
      modelName:
        typeof deployment.modelName === "string"
          ? deployment.modelName
          : undefined,
      modelPublisher:
        typeof deployment.modelPublisher === "string"
          ? deployment.modelPublisher
          : undefined,
      modelVersion:
        typeof deployment.modelVersion === "string"
          ? deployment.modelVersion
          : undefined,
      capabilities,
    };
    if (isChatCapable(capabilities)) {
      chatDeploymentList.push(entry);
    } else if (!isKnownNonChatOnly(capabilities)) {
      // 有些 Foundry 資源回傳尚未文件化的 capability key。寧可誠實顯示
      // 為未驗證候選項，也不要把使用者唯一可用的 chat deployment 隱藏掉。
      unverifiedDeploymentList.push(entry);
    }
  }

  return {
    chatDeploymentList,
    unverifiedDeploymentList,
    nextLink: typeof data.nextLink === "string" ? data.nextLink : undefined,
  };
}

async function fetchJson(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      // Diagnostic detail is best-effort only.
    }
    throw new AzureDeploymentListError(response.status, body);
  }
  return response.json();
}

async function listFoundryDeploymentsWithMetadata(
  options: AzureDeploymentListOptions,
): Promise<{
  deploymentList: AzureChatDeployment[];
  capabilityFiltered: boolean;
}> {
  const base = normalizeAzureEndpoint(options.foundryEndpoint);
  const origin = new URL(base).origin;
  const headers = buildHeaders(options.authMode, options.authValue);
  const chatDeploymentList: AzureChatDeployment[] = [];
  const unverifiedDeploymentList: AzureChatDeployment[] = [];
  let nextUrl =
    `${base}/api/projects/${encodeURIComponent(options.projectName)}` +
    "/deployments?api-version=v1";

  while (nextUrl) {
    const parsed = new URL(nextUrl);
    if (parsed.origin !== origin) {
      throw new Error("Foundry deployment nextLink has an unexpected origin");
    }
    const page = parseFoundryDeploymentList(await fetchJson(nextUrl, headers));
    chatDeploymentList.push(...page.chatDeploymentList);
    unverifiedDeploymentList.push(...page.unverifiedDeploymentList);
    nextUrl = page.nextLink ?? "";
  }

  return chatDeploymentList.length > 0
    ? { deploymentList: chatDeploymentList, capabilityFiltered: true }
    : { deploymentList: unverifiedDeploymentList, capabilityFiltered: false };
}

export async function listFoundryDeployments(
  options: AzureDeploymentListOptions,
): Promise<AzureChatDeployment[]> {
  return (await listFoundryDeploymentsWithMetadata(options)).deploymentList;
}

export async function listAzureV1Models(
  options: Omit<AzureDeploymentListOptions, "projectName">,
): Promise<AzureChatDeployment[]> {
  const base = normalizeAzureEndpoint(options.v1Endpoint);
  const data = (await fetchJson(
    `${base}/openai/v1/models`,
    buildHeaders(options.authMode, options.authValue),
  )) as Record<string, unknown>;
  const modelList = Array.isArray(data.data) ? data.data : [];

  return modelList.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = (item as Record<string, unknown>).id;
    return typeof id === "string" ? [{ name: id, source: "v1" as const }] : [];
  });
}

export async function listAzureChatDeployments(
  options: AzureDeploymentListOptions,
): Promise<AzureDeploymentListResult> {
  if (options.projectName && options.foundryEndpoint) {
    try {
      const result = await listFoundryDeploymentsWithMetadata(options);
      return {
        deploymentList: result.deploymentList,
        source: "foundry",
        capabilityFiltered: result.capabilityFiltered,
        fallbackReason: result.capabilityFiltered
          ? undefined
          : "capability-unverified",
      };
    } catch {
      return {
        deploymentList: await listAzureV1Models(options),
        source: "v1",
        fallbackReason: "foundry-request-failed",
      };
    }
  }

  return {
    deploymentList: await listAzureV1Models(options),
    source: "v1",
    fallbackReason: "project-not-configured",
  };
}
