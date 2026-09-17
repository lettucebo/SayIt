import type { Page } from "@playwright/test";

/**
 * Dashboard 在 `pnpm dev`（純前端）下沒有 Tauri runtime，`window.__TAURI_INTERNALS__`
 * 不存在會讓 plugin-store / plugin-sql 的 invoke 直接 throw，設定因此永遠停在預設值。
 * 這裡只在瀏覽器端安裝一組最小可用的 IPC 假實作，讓 E2E 能以指定的持久化設定
 * （例如 azureEnabled）渲染 Settings，production 程式碼完全不需要為測試開後門。
 */
export interface TauriMockOptions {
  /** 預先寫入 tauri-plugin-store 的鍵值，對應 `useSettingsStore` 讀取的欄位。 */
  storeValues?: Record<string, unknown>;
  httpResponses?: Array<{
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    delayUntil?: string;
    body: unknown;
  }>;
}

/** SQLite schema 的最新版本；回報此版本可讓所有 migration 直接略過。 */
const MOCKED_SCHEMA_VERSION = 9;
const MOCKED_TABLE_SET = new Set(["api_usage", "schema_version", "transcriptions", "vocabulary"]);

interface TauriMockState {
  getStoreSetCount: (key: string) => number;
  getHttpRequestList: () => Array<{
    url: string;
    method: string;
    headers: Array<[string, string]>;
  }>;
  resolveHttpResponse: (key: string) => void;
}

export async function installTauriMock(
  page: Page,
  options: TauriMockOptions = {},
): Promise<void> {
  await page.addInitScript(
    (init: {
      storeValues: Record<string, unknown>;
      schemaVersion: number;
      tableList: string[];
      httpResponses: Array<{
        status?: number;
        statusText?: string;
        headers?: Record<string, string>;
        delayUntil?: string;
        body: unknown;
      }>;
    }) => {
      const storeState = new Map<string, unknown>(
        Object.entries(init.storeValues),
      );
      const callbackRegistry = new Map<number, (payload: unknown) => void>();
      const eventCallbackIdMap = new Map<number, number>();
      const storeSetCountMap = new Map<string, number>();
      const httpRequestList: Array<{
        url: string;
        method: string;
        headers: Array<[string, string]>;
      }> = [];
      const httpResponseMap = new Map<
        number,
        {
          status: number;
          statusText: string;
          url: string;
          headers: Record<string, string>;
          delayUntil?: string;
          body: unknown;
        }
      >();
      const httpBodyReadCountMap = new Map<number, number>();
      const httpDelayResolverMap = new Map<string, () => void>();
      const httpDelayPromiseMap = new Map<string, Promise<void>>();
      const globalScope = window as unknown as Record<string, unknown>;
      let nextCallbackId = 0;
      let nextListenerId = 0;
      let nextHttpRid = 0;

      const selectRows = (query: string, values: unknown[]): unknown[] => {
        if (query.includes("SELECT version FROM schema_version")) {
          return [{ version: init.schemaVersion }];
        }
        if (query.includes("sqlite_master")) {
          const tableName = String(values[0] ?? "");
          return init.tableList.includes(tableName) ? [{ name: tableName }] : [];
        }
        if (query.includes("SELECT 1 AS n")) {
          return [{ n: 1 }];
        }
        return [];
      };

      const invokeStore = (cmd: string, args: Record<string, unknown>) => {
        const key = String(args.key ?? "");
        switch (cmd) {
          case "plugin:store|load":
          case "plugin:store|get_store":
            return 1;
          case "plugin:store|get":
            return [storeState.get(key), storeState.has(key)];
          case "plugin:store|set":
            storeState.set(key, args.value);
            storeSetCountMap.set(key, (storeSetCountMap.get(key) ?? 0) + 1);
            return null;
          case "plugin:store|has":
            return storeState.has(key);
          case "plugin:store|delete":
            return storeState.delete(key);
          case "plugin:store|keys":
            return [...storeState.keys()];
          case "plugin:store|values":
            return [...storeState.values()];
          case "plugin:store|entries":
            return [...storeState.entries()];
          case "plugin:store|length":
            return storeState.size;
          case "plugin:store|save":
            return null;
          default:
            throw new Error(`Unsupported store command in E2E mock: ${cmd}`);
        }
      };

      const invokeSql = (cmd: string, args: Record<string, unknown>) => {
        switch (cmd) {
          case "plugin:sql|load":
            return String(args.db ?? "sqlite:e2e.db");
          case "plugin:sql|select":
            return selectRows(
              String(args.query ?? ""),
              (args.values as unknown[]) ?? [],
            );
          case "plugin:sql|execute":
            return [0, null];
          case "plugin:sql|close":
            return null;
          default:
            throw new Error(`Unsupported SQL command in E2E mock: ${cmd}`);
        }
      };

      const waitForHttpDelay = (key: string): Promise<void> => {
        const existing = httpDelayPromiseMap.get(key);
        if (existing) return existing;
        const promise = new Promise<void>((resolve) => {
          httpDelayResolverMap.set(key, resolve);
        });
        httpDelayPromiseMap.set(key, promise);
        return promise;
      };

      const invokeHttp = async (cmd: string, args: Record<string, unknown>) => {
        switch (cmd) {
          case "plugin:http|fetch": {
            const clientConfig =
              (args.clientConfig as Record<string, unknown>) ?? {};
            const request = {
              url: String(clientConfig.url ?? ""),
              method: String(clientConfig.method ?? "GET"),
              headers:
                (clientConfig.headers as Array<[string, string]>) ?? [],
            };
            httpRequestList.push(request);
            const rid = ++nextHttpRid;
            const response =
              init.httpResponses[httpRequestList.length - 1] ?? {
                status: 200,
                body: {},
              };
            httpResponseMap.set(rid, {
              status: response.status ?? 200,
              statusText: response.statusText ?? "OK",
              url: request.url,
              headers: response.headers ?? { "content-type": "application/json" },
              delayUntil: response.delayUntil,
              body: response.body,
            });
            return rid;
          }
          case "plugin:http|fetch_send": {
            const rid = Number(args.rid);
            const response = httpResponseMap.get(rid);
            if (!response) throw new Error(`Unknown mocked HTTP rid: ${rid}`);
            if (response.delayUntil) {
              await waitForHttpDelay(response.delayUntil);
            }
            return {
              status: response.status,
              statusText: response.statusText,
              url: response.url,
              headers: response.headers,
              rid,
            };
          }
          case "plugin:http|fetch_read_body": {
            const rid = Number(args.rid);
            const response = httpResponseMap.get(rid);
            if (!response) throw new Error(`Unknown mocked HTTP body rid: ${rid}`);
            const readCount = httpBodyReadCountMap.get(rid) ?? 0;
            httpBodyReadCountMap.set(rid, readCount + 1);
            if (readCount > 0) return [1];
            const text = JSON.stringify(response.body);
            return [...new TextEncoder().encode(text), 0];
          }
          case "plugin:http|fetch_cancel":
          case "plugin:http|fetch_cancel_body":
            return null;
          default:
            throw new Error(`Unsupported HTTP command in E2E mock: ${cmd}`);
        }
      };

      const invoke = async (
        cmd: string,
        args: Record<string, unknown> = {},
      ): Promise<unknown> => {
        if (cmd.startsWith("plugin:store|")) return invokeStore(cmd, args);
        if (cmd.startsWith("plugin:sql|")) return invokeSql(cmd, args);
        if (cmd.startsWith("plugin:http|")) return invokeHttp(cmd, args);
        if (cmd === "plugin:event|listen") {
          const eventId = ++nextListenerId;
          eventCallbackIdMap.set(eventId, Number(args.handler));
          return eventId;
        }
        if (cmd === "plugin:event|unlisten") {
          eventCallbackIdMap.delete(Number(args.eventId));
          return null;
        }
        if (cmd === "plugin:event|emit" || cmd === "plugin:event|emit_to") {
          return null;
        }
        if (cmd === "plugin:autostart|is_enabled") return false;
        if (cmd === "get_os_theme") return "light";
        if (cmd === "get_azure_entra_token") {
          return { accessToken: "e2e-access-token", expiresIn: 3600 };
        }
        if (cmd === "cleanup_old_logs" || cmd === "cleanup_old_recordings") {
          return [];
        }
        return null;
      };

      const transformCallback = (
        callback?: (payload: unknown) => void,
        once = false,
      ): number => {
        nextCallbackId += 1;
        const id = nextCallbackId;
        const identifier = `_${id}`;
        globalScope[identifier] = (payload: unknown) => {
          if (once) {
            delete globalScope[identifier];
            callbackRegistry.delete(id);
          }
          callback?.(payload);
        };
        callbackRegistry.set(id, callback ?? (() => {}));
        return id;
      };

      globalScope.__TAURI_INTERNALS__ = {
        invoke,
        transformCallback,
        unregisterCallback: (id: number) => {
          callbackRegistry.delete(id);
          delete globalScope[`_${id}`];
        },
        convertFileSrc: (filePath: string) => filePath,
        metadata: {
          currentWindow: { label: "main-window" },
          currentWebview: { windowLabel: "main-window", label: "main-window" },
        },
      };
      globalScope.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (_event: string, eventId: number) => {
          const callbackId = eventCallbackIdMap.get(eventId);
          eventCallbackIdMap.delete(eventId);
          if (callbackId !== undefined) {
            callbackRegistry.delete(callbackId);
            delete globalScope[`_${callbackId}`];
          }
        },
      };
      globalScope.__SAYIT_E2E_TAURI_MOCK__ = {
        getStoreSetCount: (key: string) => storeSetCountMap.get(key) ?? 0,
        getHttpRequestList: () => httpRequestList,
        resolveHttpResponse: (key: string) => {
          const resolve = httpDelayResolverMap.get(key);
          resolve?.();
          httpDelayResolverMap.delete(key);
        },
      } satisfies TauriMockState;
      globalScope.isTauri = true;
    },
    {
      storeValues: options.storeValues ?? {},
      schemaVersion: MOCKED_SCHEMA_VERSION,
      tableList: [...MOCKED_TABLE_SET],
      httpResponses: options.httpResponses ?? [],
    },
  );
}

export async function getStoreSetCount(page: Page, key: string): Promise<number> {
  return page.evaluate((storeKey) => {
    const mockState = (
      window as unknown as {
        __SAYIT_E2E_TAURI_MOCK__: TauriMockState;
      }
    ).__SAYIT_E2E_TAURI_MOCK__;
    return mockState.getStoreSetCount(storeKey);
  }, key);
}

export async function getHttpRequestList(
  page: Page,
): Promise<Array<{ url: string; method: string; headers: Array<[string, string]> }>> {
  return page.evaluate(() => {
    const mockState = (
      window as unknown as {
        __SAYIT_E2E_TAURI_MOCK__: TauriMockState;
      }
    ).__SAYIT_E2E_TAURI_MOCK__;
    return mockState.getHttpRequestList();
  });
}

export async function resolveHttpResponse(
  page: Page,
  key: string,
): Promise<void> {
  await page.evaluate((delayKey) => {
    const mockState = (
      window as unknown as {
        __SAYIT_E2E_TAURI_MOCK__: TauriMockState;
      }
    ).__SAYIT_E2E_TAURI_MOCK__;
    mockState.resolveHttpResponse(delayKey);
  }, key);
}
