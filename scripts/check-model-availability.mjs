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

/** GitHub Actions 的 job summary。非 Actions 環境下為 undefined，寫入會被跳過。 */
const SUMMARY_PATH = process.env.GITHUB_STEP_SUMMARY;

async function appendSummary(lines) {
  if (!SUMMARY_PATH) {
    console.log("GITHUB_STEP_SUMMARY not set; skipping job summary");
    return;
  }
  const { appendFile } = await import("node:fs/promises");
  const text = `${lines.join("\n")}\n`;
  await appendFile(SUMMARY_PATH, text, "utf8");
  console.log(`wrote ${text.length} chars to job summary`);
}

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


/** 檢查單一 provider；未設定金鑰時標記為跳過而非失敗。 */
async function checkProvider(provider, registry) {
  const key = process.env[provider.envKey];
  if (!key) {
    console.log(`skip ${provider.label}: ${provider.envKey} not set`);
    return { provider, skipped: true };
  }
  const liveIds = await fetchLiveIds(provider, key);
  const detail = describeDrift(provider, registry, liveIds);
  console.log(
    `${provider.label}: ${detail.registryIds.length} in registry, ${liveIds.size} live, ${detail.missing.length} missing`,
  );
  return { provider, liveIds, skipped: false, ...detail };
}

/**
 * Job summary：無論結果如何都要輸出，這樣每次執行都能一眼看到目前的模型狀態，
 * 而不是只有出事時才有東西可看。有漂移才開 issue，但「一切正常」同樣是有用的資訊。
 */
function renderSummary(results, simulated) {
  const lines = ["## 模型可用性", ""];
  if (simulated) {
    lines.push(
      "> ⚠️ **模擬模式**（`simulate_drift`）：以下為驗證告警管線用的假資料，未檢查真實模型。",
      "",
    );
  }

  lines.push("| Provider | registry | 上線 | 狀態 |", "| --- | --- | --- | --- |");
  for (const r of results) {
    if (r.skipped) {
      lines.push(
        `| ${r.provider.label} | — | — | ⏭️ 略過（未設定 \`${r.provider.envKey}\`） |`,
      );
      continue;
    }
    const status =
      r.missing.length === 0
        ? "✅ 全部可用"
        : `❌ ${r.missing.length} 個已下架`;
    lines.push(
      `| ${r.provider.label} | ${r.registryIds.length} | ${r.liveIds.size} | ${status} |`,
    );
  }
  lines.push("");

  for (const r of results) {
    if (r.skipped) continue;
    lines.push(`### ${r.provider.label}`, "");
    lines.push("| registry 內的模型 | 狀態 |", "| --- | --- |");
    for (const id of r.registryIds) {
      const mark = id === r.defaultId ? " ⭐ 預設" : "";
      const ok = r.liveIds.has(id) ? "✅ 可用" : "❌ 不在上線清單";
      lines.push(`| \`${id}\`${mark} | ${ok} |`);
    }
    lines.push("");

    // provider 有但 registry 未收錄的模型：多半是 TTS／分類器等不適用的模型，
    // 收合起來避免蓋過上面真正要看的狀態，但保留著以便評估新模型。
    const extra = [...r.liveIds].filter((id) => !r.registryIds.includes(id)).sort();
    if (extra.length > 0) {
      lines.push(
        "<details>",
        `<summary>provider 上另有 ${extra.length} 個未收錄於 registry 的模型</summary>`,
        "",
        ...extra.map((id) => `- \`${id}\``),
        "",
        "</details>",
        "",
      );
    }
  }
  return lines;
}

function renderIssueBody(results) {
  const lines = [
    "偵測到 `src/lib/modelRegistry.ts` 內的模型已不在 provider 的上線清單中。",
    "",
    "使用者影響：選到這些模型的請求會失敗。若其中包含預設模型，全新安裝與從舊版遷移的使用者都會受影響，且語音轉錄本身仍正常，只有 AI 整理失效，容易被忽略。",
    "",
  ];
  for (const r of results) {
    if (r.skipped || r.missing.length === 0) continue;
    lines.push(`### ${r.provider.label}`, "");
    if (r.defaultMissing) {
      lines.push(
        `> **預設模型 \`${r.defaultId}\` 已不在上線清單。** 全新安裝與所有遷移到它的使用者都會在整理階段收到 404。`,
        "",
      );
    }
    lines.push("| registry 內的模型 | 狀態 |", "| --- | --- |");
    for (const id of r.missing) {
      const mark = id === r.defaultId ? "（預設）" : "";
      lines.push(`| \`${id}\`${mark} | ❌ 不在上線清單 |`);
    }
    lines.push("", "目前可用的模型：", "");
    for (const id of [...r.liveIds].sort()) lines.push(`- \`${id}\``);
    lines.push("");
  }
  lines.push(
    "### 修正方式",
    "",
    "1. 在 `LLM_MODEL_LIST` / `WHISPER_MODEL_LIST` 移除失效模型",
    "2. 於 `DECOMMISSIONED_MODEL_MAP` 加入 `舊 ID -> 現役 ID` 的遷移對應",
    "3. 若失效的是 `DEFAULT_LLM_MODEL_ID`，同時改成現役模型",
    "4. 移除連帶孤立的 i18n 說明文案",
    "",
    "`model-registry.test.ts` 內已有守衛會驗證「預設模型必須存在於清單、且不得同時列為已下架」。",
  );
  return lines.join("\n");
}

async function main() {
  const registry = await loadRegistry();
  const simulated = process.env.SIMULATE_DRIFT === "1";

  // 告警管線只有在真的出事時才會跑到，等到那時才發現 issue 開不出來就太晚了。
  // 這條路徑僅由手動觸發帶入，排程不會設定此變數。
  if (simulated) {
    console.log("SIMULATE_DRIFT=1: emitting a synthetic report");
    const fakeProvider = { label: "Simulation", envKey: "SIMULATE_DRIFT" };
    const fakeId = "example/model-that-does-not-exist";
    const results = [
      {
        provider: fakeProvider,
        skipped: false,
        liveIds: new Set(),
        registryIds: [fakeId],
        missing: [fakeId],
        defaultId: fakeId,
        defaultMissing: true,
      },
    ];
    await appendSummary(renderSummary(results, true));
    const body = [
      "### 這是模擬報告",
      "",
      "由 `workflow_dispatch` 的 `simulate_drift` 選項手動觸發，用來驗證告警管線本身。",
      "**沒有任何模型真的失效**，看到這則 issue 直接關閉即可。",
      "",
      "| registry 內的模型 | 狀態 |",
      "| --- | --- |",
      `| \`${fakeId}\` | ❌ 不在上線清單（模擬） |`,
    ].join("\n");
    await writeReport(body);
    console.log(`\n--- drift report ---\n\n${body}`);
    return EXIT_DRIFT;
  }

  const results = [];
  for (const provider of PROVIDERS) {
    results.push(await checkProvider(provider, registry));
  }

  if (results.every((r) => r.skipped)) {
    throw new Error(
      "No provider was checked — set at least one provider API key",
    );
  }

  // summary 在判斷退出碼之前寫出：無論有沒有漂移都要留下狀態卡片
  await appendSummary(renderSummary(results, false));

  const drifted = results.some((r) => !r.skipped && r.missing.length > 0);
  if (!drifted) {
    console.log("no drift detected");
    return EXIT_OK;
  }

  const body = renderIssueBody(results);
  await writeReport(body);
  console.log(`\n--- drift report ---\n\n${body}`);
  return EXIT_DRIFT;
}

/** workflow 用這個檔案當 issue body，避免把多行內容塞進 shell 變數 */
async function writeReport(body) {
  const outPath = process.env.MODEL_DRIFT_REPORT_PATH;
  if (!outPath) return;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outPath, body, "utf8");
}

main()
  .then((code) => process.exit(code))
  .catch(async (error) => {
    console.error(`check failed: ${error.message}`);
    // 失敗時也要留下 summary：只看到紅燈卻不知道是「模型下架」還是「API 掛掉」，
    // 會讓人第一時間跑去改 registry，而那其實不是問題所在。
    await appendSummary([
      "## 模型可用性 — 檢查失敗",
      "",
      `\`\`\`\n${error.message}\n\`\`\``,
      "",
      "**未完成比對，這不代表任何模型有問題。** 常見原因是缺少 provider 金鑰，或 provider API 暫時無法存取。",
    ]).catch(() => {});
    process.exit(EXIT_ERROR);
  });
