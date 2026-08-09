/**
 * Prompt 評測集（golden eval set）的型別定義。
 *
 * 背景（#49）：改 `src/i18n/prompts.ts` 時沒有評測集，全憑手感，容易回歸。
 * 這裡定義「案例 + 確定性斷言」的資料結構，讓 prompt 的預期行為變成可驗證的資產。
 *
 * 設計取捨：**不做**輸出全等比對（LLM 有隨機性，必然 flaky），改成對輸出斷言
 * 一組「必須成立的性質」。同一組斷言既能驗證人工撰寫的 `expected`（CI 免費跑、
 * 不需 API key），也能直接套用在真實 LLM 輸出上（手動實測時）。
 */

/** 案例來源。 */
export type PromptEvalSource =
  /** 使用者真實逐字稿，已去識別化。含 Whisper 真實錯誤模式。 */
  | "l1-personal"
  /** 公開資料集 ky552/ML2021_ASR_ST（MIT），台大 ML 2021 課程，繁中＋英文術語。 */
  | "l2-ml2021";

/** 案例涵蓋的語言現象，供篩選與覆蓋率統計。 */
export type PromptEvalPhenomenon =
  /** 中英夾雜：句中混入英文術語。 */
  | "code-switching"
  /** 需補標點（原文無標點或標點不足）。 */
  | "punctuation"
  /** 中文與英文／數字之間需加半形空白。 */
  | "latin-spacing"
  /** 原文含簡體字，需轉為繁體。 */
  | "simplified-input"
  /** 含口語贅詞需移除。 */
  | "filler"
  /** 口說重複或繞圈，需合併為一次表達。 */
  | "repetition"
  /** 說話者中途改口，需以新值取代舊值。 */
  | "self-correction"
  /** Whisper 把英文術語聽成錯誤中文，需還原。 */
  | "asr-error"
  /** 原文是問句，輸出須保持問句。 */
  | "question-form"
  /** 內容為清單／步驟，可能需要列點。 */
  | "list"
  /** 含易被 LLM 誤當成指令的內容（prompt injection 面）。 */
  | "instruction-like"
  /**
   * 中國大陸用語需在地化為台灣用語（搜索→搜尋、軟件→軟體）。
   * 注意：`ACTIVE_PROMPTS` 只說「使用繁體中文」，這條規則來自使用者實際採用的
   * custom prompt（「一律轉為繁體並使用台灣用語」）。標成獨立現象是為了誠實
   * 標示它的契約來源，避免與單純的簡→繁字元轉換混為一談。
   */
  | "taiwan-localization"
  /** 輸入已完全符合契約，正確行為是原樣輸出（用來擋過度校正）。 */
  | "no-op";

/**
 * 所有已宣告的現象，供覆蓋率檢查使用。
 *
 * 用 `Record<PromptEvalPhenomenon, true>` 當中介：union 新增成員時若忘了補進來，
 * TypeScript 會直接編譯失敗，避免覆蓋率測試因清單漏列而「技術性通過」。
 */
const PHENOMENON_REGISTRY: Record<PromptEvalPhenomenon, true> = {
  "code-switching": true,
  punctuation: true,
  "latin-spacing": true,
  "simplified-input": true,
  filler: true,
  repetition: true,
  "self-correction": true,
  "asr-error": true,
  "question-form": true,
  list: true,
  "instruction-like": true,
  "taiwan-localization": true,
  "no-op": true,
};

export const ALL_PHENOMENA = Object.keys(
  PHENOMENON_REGISTRY,
) as readonly PromptEvalPhenomenon[];

/**
 * 所有合法的 assertion kind。
 * 同樣用 `Record<…, true>` 強制窮盡：union 新增斷言種類時漏補會編譯失敗。
 */
const ASSERTION_KIND_REGISTRY: Record<PromptEvalAssertion["kind"], true> = {
  preserveTerms: true,
  traditionalOnly: true,
  latinSpacing: true,
  noTrailingPeriod: true,
  fullWidthPunctuation: true,
  noMarkdown: true,
  forbidSubstrings: true,
  requireSubstrings: true,
  lengthRatio: true,
  endsWithQuestionMark: true,
};

export const ALL_ASSERTION_KINDS = Object.keys(
  ASSERTION_KIND_REGISTRY,
) as readonly PromptEvalAssertion["kind"][];

/**
 * 已知尚未被任何案例覆蓋的現象，以及為什麼。
 *
 * 這裡**不是**豁免清單，而是誠實記錄語料的實際分佈。列在這裡的現象仍屬 prompt
 * 契約的一部分，只是真實語料中找不到樣本；未來取得樣本後應移除該項並補上案例。
 */
export const UNCOVERED_PHENOMENA: Readonly<
  Partial<Record<PromptEvalPhenomenon, string>>
> = {
  "self-correction":
    "掃描本機 787 筆真實逐字稿與公開資料集 2600 筆 utterance，改口標記（啊不對／我是說／更正…）出現次數皆為 0。Whisper 傾向濾掉即時改口，且課堂講授與短句口述本來就少見中途改值。取得真實樣本前不以合成案例充數。",
};

/**
 * 確定性斷言。每一項都是純函式可驗證的性質，不需要 LLM 參與判斷。
 */
export type PromptEvalAssertion =
  /** 這些英文／專有名詞必須原樣出現在輸出中（不得翻譯、改拼寫或刪除）。 */
  | { readonly kind: "preserveTerms"; readonly terms: readonly string[] }
  /** 輸出不得含簡體字（以 opencc `cn→tw` 比對偵測）。 */
  | { readonly kind: "traditionalOnly" }
  /** 中文與英文／數字之間必須有半形空白。 */
  | { readonly kind: "latinSpacing" }
  /** 段落結尾與列點結尾不得補「。」（問號、驚嘆號不受限）。 */
  | { readonly kind: "noTrailingPeriod" }
  /** 中文語境必須使用全形標點（不得緊接半形 `,;!?.`）。 */
  | { readonly kind: "fullWidthPunctuation" }
  /** 不得輸出 Markdown（允許行首 `1. ` 與 `- ` 列點）。 */
  | { readonly kind: "noMarkdown" }
  /** 這些子字串不得出現（例如已移除的贅詞、被合併掉的重複）。 */
  | { readonly kind: "forbidSubstrings"; readonly values: readonly string[] }
  /** 這些子字串必須出現（例如語意關鍵詞、改口後的新值）。 */
  | { readonly kind: "requireSubstrings"; readonly values: readonly string[] }
  /** 輸出長度相對輸入的比例區間，防內容遺失與膨脹。 */
  | { readonly kind: "lengthRatio"; readonly min: number; readonly max: number }
  /** 輸出必須以問號結尾（原文為問句時）。 */
  | { readonly kind: "endsWithQuestionMark" };

/** 單一評測案例。 */
export interface PromptEvalCase {
  /** 穩定識別碼，例如 `l1-007`。 */
  readonly id: string;
  readonly source: PromptEvalSource;
  /** 輸入：模擬 Whisper 產出的原始逐字稿。 */
  readonly input: string;
  /** 人工撰寫的理想輸出，同時作為斷言的自我驗證基準。 */
  readonly expected: string;
  readonly phenomena: readonly PromptEvalPhenomenon[];
  readonly assertions: readonly PromptEvalAssertion[];
  /** 這個案例在測什麼、為什麼重要。 */
  readonly notes: string;
  /** 來源出處（L2 標資料集列索引；L1 標去識別化說明）。 */
  readonly provenance: string;
  /**
   * 已知落差：現行 prompt 實測時**預期會失敗**的案例，說明差在哪。
   * 這類案例刻意保留為改進目標，不代表 fixture 有誤。
   * CI 只驗證 `expected` 自洽，不會因為現行 prompt 做不到而失敗。
   */
  readonly knownGap?: string;
  /**
   * 這段文字是被切斷的句子片段（L2 依固定句數切窗造成）。
   * 片段案例的句首／句尾完整性帶有主觀性，不適合用來評判斷句與句末標點，
   * 因此不對它們宣告 `endsWithQuestionMark` 這類要求完整句構的斷言。
   */
  readonly isFragment?: boolean;
}

/** fixture 檔的頂層結構。 */
export interface PromptEvalCaseFile {
  readonly source: PromptEvalSource;
  readonly description: string;
  readonly license: string;
  readonly cases: readonly PromptEvalCase[];
}

/** 單一斷言的失敗描述。 */
export interface PromptEvalFailure {
  readonly kind: PromptEvalAssertion["kind"];
  readonly message: string;
}

/** 一個案例對某段實際輸出的評測結果。 */
export interface PromptEvalResult {
  readonly caseId: string;
  readonly passed: boolean;
  readonly failures: readonly PromptEvalFailure[];
}
