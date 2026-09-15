#!/usr/bin/env node
/**
 * 比對 modelRegistry 內的模型 ID 與 provider 實際上線的清單，偵測「模型已被下架
 * 但 registry 還留著」的漂移。
 *
 * 為什麼查 API 而不是爬棄用公告頁：2026-09 的 qwen3.6-27b 事件證明兩者不等價。
 * 那顆模型是 preview，被拉掉時棄用頁**完全沒有列它**——頁面上僅有的 9 次出現
 * 全部是「建議遷移目標」而非「已棄用項目」。Groq 官方也明言 preview 模型
 * 「may be discontinued at short notice」且不走正式棄用流程。因此只有實際清單
 * 才是權威來源；棄用頁最多提供 production 模型的提前預警。
 *
 * registry 以 Node 的型別剝離直接 import，不用 regex 解析原始碼：modelRegistry.ts
 * 沒有任何 import，能獨立載入，而 regex 會在格式微調時靜默失準。
 *
 * 退出碼：0 = 無漂移；1 = 偵測到漂移（workflow 據此開 issue）；2 = 檢查本身失敗
 * （缺金鑰、API 掛掉）。刻意區分 1 和 2——把「查不到」當成「模型不存在」會在
 * Groq 短暫故障時炸出假的下架警報。
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(HERE, "..", "src", "lib", "modelRegistry.ts");

const EXIT_OK = 0;
const EXIT_DRIFT = 1;
const EXIT_ERROR = 2;

/**
 * 各 provider 的實際模型清單來源。
 * 新增 provider 時在此擴充即可；缺對應金鑰的 provider 會被跳過而非失敗，
 * 這樣只設定部分金鑰的 repo 仍能檢查其餘 provider。
 */
const PROVIDERS = [
  {
    id: "groq",
    label: "Groq",
    envKey: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    // Groq 走 OpenAI 相容格式：{ data: [{ id }] }
    extractIds: (json) => (json.data ?? []).map((m) => m.id),
    // Groq 同時提供 chat 與轉錄模型，兩者都在 registry 裡
    collectRegistryIds: (registry) => [
      ...registry.LLM_MODEL_LIST.filter((m) => m.providerId === "groq").map(
        (m) => m.id,
      ),
      ...registry.WHISPER_MODEL_LIST.map((m) => m.id),
    ],
  },
];

async function loadRegistry() {
  // Windows 的絕對路徑必須轉成 file:// URL，否則 dynamic import 會把磁碟機
  // 代號當成 protocol。
  const url = new URL(`file://${REGISTRY_PATH.replace(/\\/g, "/")}`);
  return import(url.href);
}

async function fetchLiveIds(provider, key) {
  const response = await fetch(provider.url, {
    headers: { ...provider.headers(key), Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `${provider.label} models API returned HTTP ${response.status}`,
    );
  }
  const ids = provider.extractIds(await response.json());
  if (ids.length === 0) {
    // 空清單一定是異常回應，不是「所有模型都被下架」。當成錯誤而非漂移，
    // 否則會把整份 registry 報成失效。
    throw new Error(`${provider.label} models API returned an empty list`);
  }
  // 逐筆驗證形狀，不能只看長度：回應若是 `{"data":[{}]}`（HTTP 200 但欄位缺失），
  // 清單長度是 1 卻裝著 undefined，會通過上面的守衛然後把每個 registry 模型
  // 都判成「不在清單中」——正是這個三態退出碼要避免的假下架警報。
  // 刻意整批失敗而非過濾掉壞資料：能回出畸形項目的回應，剩下的部分也不可信。
  const invalid = ids.filter((id) => typeof id !== "string" || id.trim() === "");
  if (invalid.length > 0) {
    throw new Error(
      `${provider.label} models API returned ${invalid.length} entry/entries without a usable id`,
    );
  }
  return new Set(ids);
}

function describeDrift(provider, registry, liveIds) {
  const registryIds = provider.collectRegistryIds(registry);
  const missing = registryIds.filter((id) => !liveIds.has(id));
  const defaultId = registry.DEFAULT_LLM_MODEL_ID;
  const defaultMissing =
    registryIds.includes(defaultId) && !liveIds.has(defaultId);
  return { registryIds, missing, defaultId, defaultMissing };
}

async function main() {
  const registry = await loadRegistry();
  const reportLines = [];
  let drifted = false;
  let checked = 0;

  // 告警管線只有在真的出事時才會跑到，等到那時才發現 issue 開不出來就太晚了。
  // 這條路徑僅由手動觸發帶入，排程不會設定此變數。
  if (process.env.SIMULATE_DRIFT === "1") {
    const fake = "example/model-that-does-not-exist";
    console.log("SIMULATE_DRIFT=1: emitting a synthetic report");
    reportLines.push(
      "### 這是模擬報告",
      "",
      "由 `workflow_dispatch` 的 `simulate_drift` 選項手動觸發，用來驗證告警管線本身。",
      "**沒有任何模型真的失效**，看到這則 issue 直接關閉即可。",
      "",
      `| registry 內的模型 | 狀態 |`,
      "| --- | --- |",
      `| \`${fake}\` | ❌ 不在上線清單（模擬） |`,
      "",
    );
    drifted = true;
    checked = 1;
  }

  for (const provider of PROVIDERS) {
    if (drifted && process.env.SIMULATE_DRIFT === "1") break;
    const key = process.env[provider.envKey];
    if (!key) {
      console.log(
        `skip ${provider.label}: ${provider.envKey} not set`,
      );
      continue;
    }

    const liveIds = await fetchLiveIds(provider, key);
    checked += 1;
    const { registryIds, missing, defaultId, defaultMissing } = describeDrift(
      provider,
      registry,
      liveIds,
    );

    console.log(
      `${provider.label}: ${registryIds.length} in registry, ${liveIds.size} live, ${missing.length} missing`,
    );

    if (missing.length === 0) continue;
    drifted = true;

    reportLines.push(`### ${provider.label}`, "");
    if (defaultMissing) {
      reportLines.push(
        `> **預設模型 \`${defaultId}\` 已不在上線清單。** 全新安裝與所有遷移到它的使用者都會在整理階段收到 404。`,
        "",
      );
    }
    reportLines.push("| registry 內的模型 | 狀態 |", "| --- | --- |");
    for (const id of missing) {
      const isDefault = id === defaultId ? "（預設）" : "";
      reportLines.push(`| \`${id}\`${isDefault} | ❌ 不在上線清單 |`);
    }
    reportLines.push("", "目前可用的模型：", "");
    for (const id of [...liveIds].sort()) {
      reportLines.push(`- \`${id}\``);
    }
    reportLines.push("");
  }

  if (checked === 0) {
    throw new Error(
      "No provider was checked — set at least one provider API key",
    );
  }

  if (!drifted) {
    console.log("no drift detected");
    return EXIT_OK;
  }

  const body = [
    "偵測到 `src/lib/modelRegistry.ts` 內的模型已不在 provider 的上線清單中。",
    "",
    "使用者影響：選到這些模型的請求會失敗。若其中包含預設模型，全新安裝與從舊版遷移的使用者都會受影響，且語音轉錄本身仍正常，只有 AI 整理失效，容易被忽略。",
    "",
    ...reportLines,
    "### 修正方式",
    "",
    "1. 在 `LLM_MODEL_LIST` / `WHISPER_MODEL_LIST` 移除失效模型",
    "2. 於 `DECOMMISSIONED_MODEL_MAP` 加入 `舊 ID -> 現役 ID` 的遷移對應",
    "3. 若失效的是 `DEFAULT_LLM_MODEL_ID`，同時改成現役模型",
    "4. 移除連帶孤立的 i18n 說明文案",
    "",
    "`model-registry.test.ts` 內已有守衛會驗證「預設模型必須存在於清單、且不得同時列為已下架」。",
  ].join("\n");

  // workflow 用這個檔案當 issue body，避免把多行內容塞進 shell 變數
  const outPath = process.env.MODEL_DRIFT_REPORT_PATH;
  if (outPath) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(outPath, body, "utf8");
  }
  console.log("\n--- drift report ---\n");
  console.log(body);
  return EXIT_DRIFT;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`check failed: ${error.message}`);
    process.exit(EXIT_ERROR);
  });
