/**
 * Prompt 評測集的確定性斷言引擎（#49）。
 *
 * 每個斷言都是純函式：給定「案例」與「一段實際輸出」，回報該輸出違反了哪些性質。
 * 不呼叫任何 LLM，因此可在 CI 免費、穩定地執行。
 *
 * 兩種用法：
 * 1. CI：以案例自身的 `expected` 當輸出跑一次，確保人工撰寫的理想輸出真的符合
 *    它自己宣告的斷言（同時驗證斷言本身沒寫反）。
 * 2. 手動實測：把真實 LLM 輸出餵進來，得到可讀的違規清單。
 */
import { Converter } from "opencc-js";

import type {
  PromptEvalAssertion,
  PromptEvalCase,
  PromptEvalFailure,
  PromptEvalResult,
} from "./types";

const CJK = "\\u4e00-\\u9fff";

/** opencc `cn→tw` 轉換器；繁體輸入會原樣返回，故差異即代表含簡體字。 */
let converter: ((text: string) => string) | null = null;
function convertToTraditional(text: string): string {
  converter ??= Converter({ from: "cn", to: "tw" });
  return converter(text);
}

/** 單一字元的簡繁判定快取（opencc 逐字呼叫不便宜，且字元重複率高）。 */
const simplifiedCharCache = new Map<string, boolean>();

const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/**
 * 繁簡共用字：opencc `cn→tw` 會把它們轉成另一個字，但它們本身就是**合法的繁體字**，
 * 因此不得判定為簡體。
 *
 * 為什麼一定要這份清單：opencc 的正反向轉換**無法**區分「繁簡共用字」與「純簡體字」
 * ——`台`（台灣、電台）與`这`的 `cn→tw` 會變、`tw→cn` 不變，行為完全相同。
 * 沒有外部判準就只能靠字表。
 *
 * 取捨：這裡寧可**漏報也不誤報**。誤報會讓完全正確的輸出被判失敗，使評測集失去
 * 公信力；漏報只是少抓到一個字。清單不可能窮盡，發現新的共用字就往這裡加。
 *
 * 括號內為 opencc 想轉成的字，以及該字在繁體中的合法用法：
 * 台（臺）台灣、電台｜后（後）皇后｜里（裡）公里｜干（幹）干涉、若干
 * 征（徵）征服｜范（範）范仲淹｜准（準）准許｜丑（醜）丑角｜游（遊）游泳、上游
 * 占（佔）占卜｜采（採）風采｜于（於）于姓｜余（餘）余姓｜涂（塗）涂姓
 * 划（劃）划船、划算｜咨（諮）咨詢｜仆（僕）前仆後繼｜几（幾）茶几
 * 朴（樸）朴姓｜郁（鬱）濃郁、郁姓｜云（雲）人云亦云｜辟（闢）復辟｜厘（釐）公厘
 */
const AMBIGUOUS_TRADITIONAL_CHARS = new Set([
  "台", "后", "里", "干", "征", "范", "准", "丑", "游", "占", "采", "于",
  "余", "涂", "划", "咨", "仆", "几", "朴", "郁", "云", "辟", "厘",
]);

/**
 * 判斷單一漢字是否為簡體字。
 *
 * 兩個必要條件缺一不可：
 * 1. **逐字判定，不能整句丟給 opencc**。opencc 即使用 `to:"tw"` 仍帶詞級規則，
 *    會把語境相依的正確繁體字換成另一個異體字——例如「儀表板」→「儀錶板」、
 *    「發明了一個」→「發明瞭一個」。拿整句比對會誤報這些字（表、了）。
 * 2. **排除繁簡共用字**（見 `AMBIGUOUS_TRADITIONAL_CHARS`）。逐字轉換解決了詞級
 *    誤報，卻擋不住一對多歧義：`台`→`臺`、`游`→`遊`、`里`→`裡` 都會被誤判。
 */
function isSimplifiedChar(char: string): boolean {
  const cached = simplifiedCharCache.get(char);
  if (cached !== undefined) return cached;
  const result =
    CJK_CHAR.test(char) &&
    !AMBIGUOUS_TRADITIONAL_CHARS.has(char) &&
    convertToTraditional(char) !== char;
  simplifiedCharCache.set(char, result);
  return result;
}

/**
 * 找出文字中的簡體字。
 * 逐字判定，避免 opencc 詞級規則造成的誤報（見 `isSimplifiedChar`）。
 */
export function findSimplifiedChars(text: string): string[] {
  const found = new Set<string>();
  for (const char of text) {
    if (isSimplifiedChar(char)) found.add(char);
  }
  return [...found];
}

/** 列點行首標記（唯一允許的排版語法）。 */
const LIST_MARKER = /^\s*(?:\d+\.\s|-\s)/;

/** 找出中文與英數字之間缺少半形空白的位置。 */
export function findMissingLatinSpacing(text: string): string[] {
  const hits = new Set<string>();
  const patterns = [
    // 中文緊接英數字，或英數字緊接中文
    new RegExp(`[${CJK}][A-Za-z0-9]`, "g"),
    new RegExp(`[A-Za-z0-9][${CJK}]`, "g"),
    // 以符號收尾的識別字（C#、C++、F#）緊接中文——基本規則抓不到，因為
    // 交界處的字元是 # 或 + 而非英數字。
    new RegExp(`[A-Za-z0-9][#+]+[${CJK}]`, "g"),
    // 中文緊接以點開頭的識別字（.NET、.gitignore）
    new RegExp(`[${CJK}]\\.[A-Za-z]`, "g"),
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) hits.add(match[0]);
  }
  return [...hits];
}

/**
 * 找出中文語境中誤用的半形標點。
 *
 * 已知限制：只檢查緊接在中文字之後的半形標點。像 `API,請重試` 這種「英文後接
 * 半形逗號再接中文」不會被抓到——要正確判斷得先剖析識別字邊界，誤報風險高於
 * 收益。這裡的取捨一律是寧可漏報也不誤報。
 */
export function findHalfWidthPunctuation(text: string): string[] {
  const hits = new Set<string>();
  // 半形標點緊接在中文字後面即違規；`Node.js` 的點前面是英文字母，不會命中。
  const re = new RegExp(`[${CJK}][,;!?:]`, "g");
  for (const match of text.matchAll(re)) hits.add(match[0]);
  // 句點另外處理：中文後接 `.` 通常是誤用的句號，但 `.NET`、`.gitignore` 這類
  // 以點開頭的識別字例外——那屬於 latinSpacing 該管的空白問題，不是標點問題。
  const period = new RegExp(`[${CJK}]\\.(?![A-Za-z])`, "g");
  for (const match of text.matchAll(period)) hits.add(match[0]);
  return [...hits];
}

/** 找出不該出現的 Markdown 語法（行首列點除外）。 */
export function findMarkdownSyntax(text: string): string[] {
  const hits = new Set<string>();
  const patterns: ReadonlyArray<readonly [string, RegExp]> = [
    ["code-fence", /```/],
    ["inline-code", /`[^`\n]+`/],
    ["bold", /\*\*[^*\n]+\*\*/],
    ["heading", /^#{1,6}\s/m],
    ["blockquote", /^>\s/m],
    ["link", /\[[^\]\n]*\]\([^)\n]*\)/],
  ];
  for (const [name, re] of patterns) {
    if (re.test(text)) hits.add(name);
  }
  return [...hits];
}

/**
 * 找出結尾多補句號的行。
 * 契約：每段最後一句與每個列點結尾都不加「。」；問號、驚嘆號不受限制。
 * 每一行的行尾即「段落最後一句」或「列點結尾」，故逐行檢查行尾即可。
 *
 * 半形句點只在前一個字元是中文時才算違規——`Node.js`、`v1.0` 這類識別字
 * 剛好落在行尾時不該被誤判。
 */
export function findTrailingPeriods(text: string): string[] {
  const cjkThenAsciiPeriod = new RegExp(`[${CJK}]\\.$`);
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(
      (line) =>
        line.length > 0 &&
        (line.endsWith("。") || cjkThenAsciiPeriod.test(line)),
    );
}

function evaluateAssertion(
  assertion: PromptEvalAssertion,
  actual: string,
  input: string,
): PromptEvalFailure | null {
  switch (assertion.kind) {
    case "preserveTerms": {
      const missing = assertion.terms.filter((term) => !actual.includes(term));
      return missing.length === 0
        ? null
        : {
            kind: assertion.kind,
            message: `術語未原樣保留：${missing.join("、")}`,
          };
    }
    case "traditionalOnly": {
      const simplified = findSimplifiedChars(actual);
      return simplified.length === 0
        ? null
        : {
            kind: assertion.kind,
            message: `輸出含簡體字：${simplified.join("")}`,
          };
    }
    case "latinSpacing": {
      const hits = findMissingLatinSpacing(actual);
      return hits.length === 0
        ? null
        : {
            kind: assertion.kind,
            message: `中英之間缺少半形空白：${hits.join("、")}`,
          };
    }
    case "noTrailingPeriod": {
      const lines = findTrailingPeriods(actual);
      return lines.length === 0
        ? null
        : {
            kind: assertion.kind,
            message: `行尾多補句號：${lines.map((l) => `「…${l.slice(-12)}」`).join("、")}`,
          };
    }
    case "fullWidthPunctuation": {
      const hits = findHalfWidthPunctuation(actual);
      return hits.length === 0
        ? null
        : {
            kind: assertion.kind,
            message: `中文語境使用半形標點：${hits.join("、")}`,
          };
    }
    case "noMarkdown": {
      const hits = findMarkdownSyntax(actual);
      return hits.length === 0
        ? null
        : { kind: assertion.kind, message: `輸出含 Markdown：${hits.join("、")}` };
    }
    case "forbidSubstrings": {
      const present = assertion.values.filter((value) => actual.includes(value));
      return present.length === 0
        ? null
        : {
            kind: assertion.kind,
            message: `不該出現的內容仍在：${present.join("、")}`,
          };
    }
    case "requireSubstrings": {
      const missing = assertion.values.filter(
        (value) => !actual.includes(value),
      );
      return missing.length === 0
        ? null
        : {
            kind: assertion.kind,
            message: `必要內容缺漏：${missing.join("、")}`,
          };
    }
    case "lengthRatio": {
      const ratio = actual.length / Math.max(input.length, 1);
      return ratio >= assertion.min && ratio <= assertion.max
        ? null
        : {
            kind: assertion.kind,
            message: `長度比例 ${ratio.toFixed(2)} 超出 [${assertion.min}, ${assertion.max}]`,
          };
    }
    case "endsWithQuestionMark": {
      // zh-TW 契約要求全形標點，因此這裡只接受「？」；輸出半形 `?` 視為未達成。
      return /？\s*$/.test(actual)
        ? null
        : { kind: assertion.kind, message: "問句輸出未以全形問號結尾" };
    }
    default: {
      // 窮盡性防線：fixture 是用 `as` 轉型讀進來的，沒有執行期驗證，
      // 打錯的 kind（如 latinSpaceing）會走到這裡。若無此分支，函式會回傳
      // undefined，被 evaluateCase 的 `!== null` 過濾器放行，最後在報表組裝時
      // 炸成無法定位的 TypeError。這裡改成明確指名壞掉的 kind。
      // 同時，union 新增成員卻忘了實作時，`never` 指派會在編譯期就報錯。
      const exhaustive: never = assertion;
      throw new Error(
        `未知的 assertion kind：${JSON.stringify((exhaustive as { kind?: unknown }).kind)}`,
      );
    }
  }
}

/** 判斷一行是否為列點（供測試與報表使用）。 */
export function isListLine(line: string): boolean {
  return LIST_MARKER.test(line);
}

/**
 * 全體案例一律套用的內容保留底線。
 *
 * 為什麼需要：逐案宣告的斷言只描述「該案在測什麼」，擋不住整體性的災難。
 * 以 l1-020 為例，只要輸出 `repo CI/CD job Artifact` 就能通過它宣告的每一條
 * 斷言（術語都在、沒簡體、沒半形標點、行尾沒句號），儘管中文內容幾乎被刪光。
 * 這條底線與案例無關、由引擎自動套用，作者不必也不能忘記加。
 */
const BASELINE_MIN_CJK_COVERAGE = 0.8;

/** 逐字正規化成繁體，讓簡→繁的案例在比對時不會因字形改變而失分。 */
function normalizeForCoverage(text: string): string {
  return [...text]
    .map((char) => (isSimplifiedChar(char) ? convertToTraditional(char) : char))
    .join("");
}

/**
 * 輸入的中文字有多少比例仍出現在輸出中。
 *
 * 用「字元集合」而非逐字對位比對：整理過程本來就會刪贅詞、改錯字、合併重複，
 * 對位比對會有大量正常的落差。集合比對抓不到細微差異，但足以攔截「刪掉大半
 * 內容」這種必須擋下的情況，而且不會誤傷正常的潤飾。
 */
export function computeCjkCoverage(input: string, actual: string): number {
  const inputChars = [...normalizeForCoverage(input)].filter((char) =>
    CJK_CHAR.test(char),
  );
  if (inputChars.length === 0) return 1;
  const actualChars = new Set(
    [...normalizeForCoverage(actual)].filter((char) => CJK_CHAR.test(char)),
  );
  const kept = inputChars.filter((char) => actualChars.has(char)).length;
  return kept / inputChars.length;
}

function evaluateBaseline(
  input: string,
  actual: string,
): PromptEvalFailure | null {
  const coverage = computeCjkCoverage(input, actual);
  return coverage >= BASELINE_MIN_CJK_COVERAGE
    ? null
    : {
        kind: "lengthRatio",
        message: `內容保留率 ${(coverage * 100).toFixed(0)}% 低於底線 ${BASELINE_MIN_CJK_COVERAGE * 100}%——輸出可能刪去大量原文`,
      };
}

/**
 * 對單一案例評測一段實際輸出。
 * 除了案例自己宣告的斷言，一律加套 `evaluateBaseline` 的內容保留底線。
 */
export function evaluateCase(
  evalCase: PromptEvalCase,
  actual: string,
): PromptEvalResult {
  const declared = evalCase.assertions
    .map((assertion) => evaluateAssertion(assertion, actual, evalCase.input))
    // 用寬鬆比較同時濾掉 null 與 undefined，避免型別謂詞把 undefined 誤放行。
    .filter((failure): failure is PromptEvalFailure => failure != null);
  const baseline = evaluateBaseline(evalCase.input, actual);
  const failures = baseline ? [...declared, baseline] : declared;
  return { caseId: evalCase.id, passed: failures.length === 0, failures };
}
