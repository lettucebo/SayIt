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
}

/** SQLite schema 的最新版本；回報此版本可讓所有 migration 直接略過。 */
const MOCKED_SCHEMA_VERSION = 9;
const MOCKED_TABLE_SET = new Set(["api_usage", "schema_version", "transcriptions", "vocabulary"]);

interface TauriMockState {
  getStoreSetCount: (key: string) => number;
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
    }) => {
      const storeState = new Map<string, unknown>(
        Object.entries(init.storeValues),
      );
      const callbackRegistry = new Map<number, (payload: unknown) => void>();
      const eventCallbackIdMap = new Map<number, number>();
      const storeSetCountMap = new Map<string, number>();
      const globalScope = window as unknown as Record<string, unknown>;
      let nextCallbackId = 0;
      let nextListenerId = 0;

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

      const invoke = async (
        cmd: string,
        args: Record<string, unknown> = {},
      ): Promise<unknown> => {
        if (cmd.startsWith("plugin:store|")) return invokeStore(cmd, args);
        if (cmd.startsWith("plugin:sql|")) return invokeSql(cmd, args);
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
      } satisfies TauriMockState;
      globalScope.isTauri = true;
    },
    {
      storeValues: options.storeValues ?? {},
      schemaVersion: MOCKED_SCHEMA_VERSION,
      tableList: [...MOCKED_TABLE_SET],
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
