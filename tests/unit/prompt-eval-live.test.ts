/**
 * Prompt 評測集的**實測** runner（#49）。
 *
 * 與 `prompt-eval-fixtures.test.ts` 的分工：
 * - fixtures 測試在 CI 跑，只驗證 fixture 自洽，不呼叫任何模型、不花錢。
 * - 這支檔案才是真正「拿 prompt 去打模型、看輸出合不合格」的工具，需要 API key，
 *   因此**沒有金鑰時整組 skip**，CI 不受影響。
 *
 * 為什麼寫成 vitest 檔而不是 `scripts/*.mjs`：可以直接 import 專案的 TypeScript
 * （prompts、llmProvider、transcriptTransforms、斷言引擎），不必為了跑腳本多裝
 * 一個 TS 執行器，也保證 runner 與 app 用的是同一份 prompt 與同一組斷言。
 *
 * 用法：
 * ```bash
 * # 最小：用預設 prompt（ACTIVE zh-TW）與預設模型跑全部案例
 * PROMPT_EVAL_API_KEY=xxx pnpm test prompt-eval-live
 *
 * # 指定模型、只跑 L1、每案跑 3 次取通過率、要求 80% 通過否則失敗
 * PROMPT_EVAL_API_KEY=xxx PROMPT_EVAL_MODEL=llama-3.3-70b-versatile \
 *   PROMPT_EVAL_CASES=l1 PROMPT_EVAL_REPEAT=3 PROMPT_EVAL_MIN_PASS_RATE=0.8 \
 *   pnpm test prompt-eval-live
 *
 * # 換成自己的 prompt 檔（例如要驗證 issue #49 的 v1.1 草稿）
 * PROMPT_EVAL_API_KEY=xxx PROMPT_EVAL_PROMPT_FILE=./my-prompt.txt pnpm test prompt-eval-live
 * ```
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACTIVE_PROMPTS, MINIMAL_PROMPTS } from "../../src/i18n/prompts";
import {
  buildFetchParams,
  getProviderIdForModel,
  parseProviderResponse,
} from "../../src/lib/llmProvider";
import { DEFAULT_LLM_MODEL_ID } from "../../src/lib/modelRegistry";
import { applyTranscriptTextTransforms } from "../../src/lib/transcriptTransforms";
import { evaluateCase } from "../support/prompt-eval/assertions";
import { loadAllCases } from "../support/prompt-eval/loadCases";
import type { PromptEvalCase } from "../support/prompt-eval/types";

const API_KEY = process.env.PROMPT_EVAL_API_KEY ?? "";
const MODEL_ID = process.env.PROMPT_EVAL_MODEL ?? DEFAULT_LLM_MODEL_ID;
const CASE_FILTER = process.env.PROMPT_EVAL_CASES ?? "";
const REPEAT = Number(process.env.PROMPT_EVAL_REPEAT ?? "1");
const MIN_PASS_RATE = process.env.PROMPT_EVAL_MIN_PASS_RATE
  ? Number(process.env.PROMPT_EVAL_MIN_PASS_RATE)
  : null;
const CONCURRENCY = Number(process.env.PROMPT_EVAL_CONCURRENCY ?? "4");
/** 是否套用 app 在送進 LLM 前的確定性轉換（取代規則 → 簡轉繁）。 */
const WITH_TRANSFORMS = process.env.PROMPT_EVAL_RAW !== "1";

function resolveSystemPrompt(): { label: string; text: string } {
  const file = process.env.PROMPT_EVAL_PROMPT_FILE;
  if (file) {
    return { label: `file:${file}`, text: readFileSync(file, "utf8") };
  }
  const preset = process.env.PROMPT_EVAL_PROMPT ?? "active";
  if (preset === "minimal") {
    return { label: "MINIMAL_PROMPTS.zh-TW", text: MINIMAL_PROMPTS["zh-TW"] };
  }
  return { label: "ACTIVE_PROMPTS.zh-TW", text: ACTIVE_PROMPTS["zh-TW"] };
}

/**
 * 送一次整理請求。
 * 訊息結構刻意與 `enhancer.ts` 的無 context 路徑一致：system = prompt、
 * user = 逐字稿、temperature 0.1，確保實測結果能對應到 app 的真實行為。
 */
async function enhanceOnce(
  systemPrompt: string,
  transcript: string,
): Promise<string> {
  const providerId = getProviderIdForModel(MODEL_ID);
  const { url, init } = buildFetchParams(
    providerId,
    {
      model: MODEL_ID,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: transcript },
      ],
      temperature: 0.1,
      maxTokens: 4096,
    },
    API_KEY,
  );
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(
      `${providerId} ${response.status} ${response.statusText}: ${await response.text()}`,
    );
  }
  return parseProviderResponse(providerId, await response.json()).text.trim();
}

/** 以固定併發數跑完所有工作，避免一次打爆 provider 的 rate limit。 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

interface CaseOutcome {
  readonly evalCase: PromptEvalCase;
  readonly runs: number;
  readonly passes: number;
  readonly failureMessages: readonly string[];
  /** 最後一次失敗的實際輸出，用來判斷是模型真的做錯還是斷言誤判。 */
  readonly lastFailedOutput?: string;
  readonly error?: string;
}

const selectedCases = loadAllCases().filter(
  (evalCase) => !CASE_FILTER || evalCase.id.startsWith(CASE_FILTER),
);

/**
 * 不需 API key 的接線檢查，**在 CI 一定會跑**。
 *
 * 為什麼需要：`tsconfig.json` 的 `include` 只涵蓋 `src/**`，`tests/**` 不在
 * `vue-tsc --noEmit` 的檢查範圍內。因此這支 runner 從 `src/` import 的符號若被
 * 改名或搬家，型別檢查抓不到，而 live 測試又因為沒金鑰而 skip——問題會一直潛伏
 * 到某天有人帶著金鑰執行才爆開。開發這支 runner 時就實際踩到兩次：
 * `getProviderIdForModel` 其實在 `llmProvider` 而非 `modelRegistry`，
 * 以及回傳欄位是 `text` 而非 `content`。
 */
describe("prompt eval — live runner wiring", () => {
  it("[P1] imported helpers still exist with the expected shape", () => {
    expect(typeof getProviderIdForModel).toBe("function");
    expect(typeof buildFetchParams).toBe("function");
    expect(typeof parseProviderResponse).toBe("function");
    expect(typeof applyTranscriptTextTransforms).toBe("function");
    expect(typeof ACTIVE_PROMPTS["zh-TW"]).toBe("string");
    expect(typeof MINIMAL_PROMPTS["zh-TW"]).toBe("string");
    expect(typeof DEFAULT_LLM_MODEL_ID).toBe("string");
  });

  it("[P1] parsed provider response exposes the field the runner reads", () => {
    const parsed = parseProviderResponse("groq", {
      choices: [{ message: { content: "整理後的文字" } }],
    });
    expect(parsed.text).toBe("整理後的文字");
  });

  it("[P1] request params can be built for the configured model", () => {
    const providerId = getProviderIdForModel(DEFAULT_LLM_MODEL_ID);
    const { url, init } = buildFetchParams(
      providerId,
      {
        model: DEFAULT_LLM_MODEL_ID,
        messages: [{ role: "user", content: "測試" }],
        temperature: 0.1,
        maxTokens: 16,
      },
      "dummy-key",
    );
    expect(url).toMatch(/^https:\/\//);
    expect(init.method).toBe("POST");
  });
});

describe.skipIf(!API_KEY)("prompt eval — live model run", () => {
  it(
    "[P3] reports pass rate against the golden eval set",
    async () => {
      const { label, text: systemPrompt } = resolveSystemPrompt();

      const outcomes = await mapWithConcurrency(
        selectedCases,
        CONCURRENCY,
        async (evalCase): Promise<CaseOutcome> => {
          const transcript = WITH_TRANSFORMS
            ? await applyTranscriptTextTransforms(evalCase.input, "zh-TW", [])
            : evalCase.input;
          let passes = 0;
          const failureMessages: string[] = [];
          let lastFailedOutput: string | undefined;
          for (let attempt = 0; attempt < Math.max(1, REPEAT); attempt += 1) {
            try {
              const actual = await enhanceOnce(systemPrompt, transcript);
              const result = evaluateCase(evalCase, actual);
              if (result.passed) {
                passes += 1;
              } else {
                lastFailedOutput = actual;
                failureMessages.push(
                  result.failures
                    .map((failure) => `${failure.kind}: ${failure.message}`)
                    .join(" | "),
                );
              }
            } catch (err) {
              return {
                evalCase,
                runs: attempt + 1,
                passes,
                failureMessages,
                lastFailedOutput,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          }
          return {
            evalCase,
            runs: Math.max(1, REPEAT),
            passes,
            failureMessages,
            lastFailedOutput,
          };
        },
      );

      // knownGap 案例是「已知現在做不到」的改進目標，分開統計才不會拉低回歸訊號。
      const regression = outcomes.filter((o) => !o.evalCase.knownGap);
      const gaps = outcomes.filter((o) => o.evalCase.knownGap);
      const rate = (list: readonly CaseOutcome[]) => {
        const runs = list.reduce((sum, o) => sum + o.runs, 0);
        const passes = list.reduce((sum, o) => sum + o.passes, 0);
        return runs === 0 ? 1 : passes / runs;
      };

      const lines: string[] = [
        "",
        "═══ prompt eval — live run ═══",
        `prompt      : ${label}`,
        `model       : ${MODEL_ID}`,
        `pre-transforms: ${WITH_TRANSFORMS ? "on (取代規則 → 簡轉繁，同 app)" : "off (raw input)"}`,
        `cases       : ${selectedCases.length}  repeat: ${Math.max(1, REPEAT)}`,
        `regression  : ${(rate(regression) * 100).toFixed(1)}%  (${regression.length} cases)`,
        `known gaps  : ${(rate(gaps) * 100).toFixed(1)}%  (${gaps.length} cases)`,
        "",
      ];
      for (const outcome of outcomes) {
        if (outcome.error) {
          lines.push(`✖ ${outcome.evalCase.id} API 錯誤：${outcome.error}`);
          continue;
        }
        if (outcome.passes === outcome.runs) continue;
        const tag = outcome.evalCase.knownGap ? "GAP" : "REG";
        lines.push(
          `✖ [${tag}] ${outcome.evalCase.id} ${outcome.passes}/${outcome.runs}`,
        );
        for (const message of [...new Set(outcome.failureMessages)]) {
          lines.push(`      ${message}`);
        }
        if (outcome.lastFailedOutput !== undefined) {
          // 附上實際輸出，才能判斷是模型做錯還是斷言誤判。
          lines.push(`      期望：${outcome.evalCase.expected}`);
          lines.push(`      實際：${outcome.lastFailedOutput}`);
        }
      }
      // runner 的產出就是這份報告，直接印出。
      console.log(lines.join("\n"));

      const apiErrors = outcomes.filter((o) => o.error).map((o) => o.evalCase.id);
      expect(apiErrors).toEqual([]);

      if (MIN_PASS_RATE !== null) {
        expect(rate(regression)).toBeGreaterThanOrEqual(MIN_PASS_RATE);
      }
    },
    30 * 60 * 1000,
  );
});
