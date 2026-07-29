import { describe, expect, it } from "vitest";

import {
  evaluateCase,
  findHalfWidthPunctuation,
  findMarkdownSyntax,
  findMissingLatinSpacing,
  findSimplifiedChars,
  findTrailingPeriods,
} from "../support/prompt-eval/assertions";
import {
  CASE_FILES,
  loadAllCases,
  loadCaseFile,
} from "../support/prompt-eval/loadCases";
import {
  ALL_PHENOMENA,
  UNCOVERED_PHENOMENA,
} from "../support/prompt-eval/types";
import type { PromptEvalCase } from "../support/prompt-eval/types";

const ALL_CASES = loadAllCases();

describe("prompt eval fixtures", () => {
  it("[P0] every expected output satisfies its own assertions", () => {
    const broken = ALL_CASES.map((evalCase) =>
      evaluateCase(evalCase, evalCase.expected),
    ).filter((result) => !result.passed);

    // 逐案例列出違規，讓 fixture 寫錯時錯誤訊息可直接定位。
    const report = broken
      .map(
        (result) =>
          `${result.caseId}: ${result.failures
            .map((failure) => `${failure.kind} — ${failure.message}`)
            .join(" | ")}`,
      )
      .join("\n");

    expect(report).toBe("");
  });

  it("[P0] fixtures contain no personally identifiable information", () => {
    // L1 取自使用者真實的口述歷史，去識別化不能只靠人工聲明。
    const patterns: ReadonlyArray<readonly [string, RegExp]> = [
      ["email", /[\w.+-]+@[\w-]+\.[\w.-]{2,}/],
      ["台灣手機號碼", /09\d{8}/],
      ["台灣身分證字號", /\b[A-Z][12]\d{8}\b/],
      ["信用卡號", /\b(?:\d[ -]?){13,16}\b/],
      ["OpenAI/Groq/GitHub token", /\b(?:sk-|gsk_|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/],
      ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
      ["Bearer token", /\bBearer\s+[A-Za-z0-9._-]{20,}/i],
      ["私鑰", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ];

    const leaks: string[] = [];
    for (const evalCase of ALL_CASES) {
      const haystack = `${evalCase.input}\n${evalCase.expected}\n${evalCase.notes}\n${evalCase.provenance}`;
      for (const [label, pattern] of patterns) {
        const match = pattern.exec(haystack);
        if (match) leaks.push(`${evalCase.id} 疑似含 ${label}：${match[0]}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("[P1] case ids are unique and non-empty", () => {
    const ids = ALL_CASES.map((evalCase) => evalCase.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("[P1] every case has input, expected, notes and at least one assertion", () => {
    const incomplete = ALL_CASES.filter(
      (evalCase) =>
        evalCase.input.trim().length === 0 ||
        evalCase.expected.trim().length === 0 ||
        evalCase.notes.trim().length === 0 ||
        evalCase.provenance.trim().length === 0 ||
        evalCase.assertions.length === 0 ||
        evalCase.phenomena.length === 0,
    ).map((evalCase) => evalCase.id);

    expect(incomplete).toEqual([]);
  });

  it("[P1] each case declares the source of the file it lives in", () => {
    for (const fileName of CASE_FILES) {
      const file = loadCaseFile(fileName);
      const mismatched = file.cases
        .filter((evalCase) => evalCase.source !== file.source)
        .map((evalCase) => evalCase.id);
      expect(mismatched).toEqual([]);
    }
  });

  it("[P2] the corpus contains a genuine no-op control", () => {
    // 「輸入已完全正確、模型不該改任何字」是最重要的過度校正回歸類別，
    // 因此這裡刻意**允許** expected === input，並要求至少存在一個這樣的案例。
    const noOps = ALL_CASES.filter(
      (evalCase) =>
        evalCase.phenomena.includes("no-op") &&
        evalCase.expected === evalCase.input,
    );
    expect(noOps.length).toBeGreaterThan(0);
  });

  it("[P2] every non-no-op case actually exercises a change", () => {
    const unchanged = ALL_CASES.filter(
      (evalCase) =>
        !evalCase.phenomena.includes("no-op") &&
        evalCase.expected === evalCase.input,
    ).map((evalCase) => evalCase.id);
    expect(unchanged).toEqual([]);
  });

  it("[P1] every declared phenomenon is either covered or logged as a known gap", () => {
    const covered = new Set(
      ALL_CASES.flatMap((evalCase) => evalCase.phenomena),
    );
    // ALL_PHENOMENA 由 types.ts 的 Record 導出，union 新增成員時不可能漏列，
    // 因此這裡真的會抓到「宣告了卻沒案例、也沒登記為已知缺口」的現象。
    const silentlyMissing = ALL_PHENOMENA.filter(
      (phenomenon) =>
        !covered.has(phenomenon) && !(phenomenon in UNCOVERED_PHENOMENA),
    );
    expect(silentlyMissing).toEqual([]);
  });

  it("[P2] known-gap phenomena are genuinely absent and explain why", () => {
    const covered = new Set(
      ALL_CASES.flatMap((evalCase) => evalCase.phenomena),
    );
    for (const [phenomenon, reason] of Object.entries(UNCOVERED_PHENOMENA)) {
      // 之後若補上案例，這裡會失敗，提醒把該項從缺口清單移除。
      expect({ phenomenon, covered: covered.has(phenomenon as never) }).toEqual({
        phenomenon,
        covered: false,
      });
      expect((reason ?? "").length).toBeGreaterThan(20);
    }
  });

  it("[P2] both layers contribute cases", () => {
    const bySource = (source: PromptEvalCase["source"]) =>
      ALL_CASES.filter((evalCase) => evalCase.source === source).length;
    expect(bySource("l1-personal")).toBeGreaterThanOrEqual(20);
    expect(bySource("l2-ml2021")).toBeGreaterThanOrEqual(15);
  });

  it("[P2] known-gap cases explain what currently fails", () => {
    const withGap = ALL_CASES.filter((evalCase) => evalCase.knownGap);
    expect(withGap.length).toBeGreaterThan(0);
    expect(
      withGap.every((evalCase) => (evalCase.knownGap ?? "").trim().length > 10),
    ).toBe(true);
  });

  it("[P2] fragment cases never assert full-sentence structure", () => {
    // L2 依固定句數切窗，部分案例是被切斷的片段；對它們要求句末問號沒有意義。
    const overreaching = ALL_CASES.filter(
      (evalCase) =>
        evalCase.isFragment &&
        evalCase.assertions.some(
          (assertion) => assertion.kind === "endsWithQuestionMark",
        ),
    ).map((evalCase) => evalCase.id);
    expect(overreaching).toEqual([]);
  });

  it("[P2] loading a missing or malformed fixture names the file", () => {
    expect(() => loadCaseFile("does-not-exist.json")).toThrow(
      /does-not-exist\.json/,
    );
  });
});

describe("prompt eval assertion engine", () => {
  it("[P0] detects simplified characters and leaves traditional text alone", () => {
    expect(findSimplifiedChars("这个问题")).toEqual(
      expect.arrayContaining(["这", "个", "问", "题"]),
    );
    expect(findSimplifiedChars("這個問題")).toEqual([]);
    expect(findSimplifiedChars("使用 API 呼叫")).toEqual([]);
  });

  it("[P0] does not misreport traditional chars that opencc rewrites at word level", () => {
    // opencc 即使 to:"tw" 仍有詞級規則：整句轉換會把「儀表板」變「儀錶板」、
    // 「發明了一個」變「發明瞭一個」。逐字判定才不會把這些正確的繁體字誤報成簡體。
    expect(findSimplifiedChars("儀表板")).toEqual([]);
    expect(findSimplifiedChars("他發明了一個方法")).toEqual([]);
    expect(findSimplifiedChars("表格")).toEqual([]);
  });

  it("[P0] does not misreport traditional chars that share a form with simplified ones", () => {
    // 逐字轉換擋不住一對多歧義：opencc 想把台→臺、游→遊、里→裡、干→幹…
    // 但這些字在繁體中都是合法用字，誤報會讓正確輸出被判失敗。
    const legit = [
      "台灣",
      "電台",
      "皇后",
      "公里",
      "干涉",
      "若干",
      "征服",
      "范仲淹",
      "准許",
      "丑角",
      "游泳",
      "上游",
      "占卜",
      "風采",
      "余光中",
      "划算",
      "咨詢",
      "前仆後繼",
      "茶几",
      "濃郁",
      "人云亦云",
      "復辟",
      "公厘",
    ];
    const misreported = legit.filter(
      (word) => findSimplifiedChars(word).length > 0,
    );
    expect(misreported).toEqual([]);
  });

  it("[P0] still catches genuinely simplified characters", () => {
    // 排除歧義字不能把真正的簡體字一併放過。
    for (const word of ["帮我", "请求", "图片", "总结", "转换", "简体", "状态"]) {
      expect(findSimplifiedChars(word).length).toBeGreaterThan(0);
    }
  });

  it("[P0] flags missing spacing between chinese and latin or digits", () => {
    expect(findMissingLatinSpacing("使用API呼叫")).not.toEqual([]);
    expect(findMissingLatinSpacing("再等3天")).not.toEqual([]);
    expect(findMissingLatinSpacing("使用 API 呼叫")).toEqual([]);
    expect(findMissingLatinSpacing("再等 3 天")).toEqual([]);
  });

  it("[P1] flags half-width punctuation only after chinese characters", () => {
    expect(findHalfWidthPunctuation("好的,我知道")).toEqual(["的,"]);
    expect(findHalfWidthPunctuation("原因:如下")).toEqual(["因:"]);
    expect(findHalfWidthPunctuation("好的，我知道")).toEqual([]);
    // 英文識別字內部的點號不該被誤判
    expect(findHalfWidthPunctuation("使用 Node.js 開發")).toEqual([]);
    // 以點開頭的識別字屬空白問題，不算標點誤用
    expect(findHalfWidthPunctuation("使用.NET 開發")).toEqual([]);
  });

  it("[P1] flags spacing violations around symbol-bearing identifiers", () => {
    expect(findMissingLatinSpacing("使用 C#開發")).toContain("C#開");
    expect(findMissingLatinSpacing("使用.NET 開發")).toContain("用.N");
    expect(findMissingLatinSpacing("使用 C# 開發")).toEqual([]);
    expect(findMissingLatinSpacing("使用 .NET 開發")).toEqual([]);
  });

  it("[P1] flags a period at the end of any line but allows mid-line periods", () => {
    expect(findTrailingPeriods("這是第一句。這是第二句")).toEqual([]);
    expect(findTrailingPeriods("這是第一句。這是第二句。")).toEqual([
      "這是第一句。這是第二句。",
    ]);
    expect(findTrailingPeriods("結尾是問號？")).toEqual([]);
    expect(findTrailingPeriods("1. 登入\n2. 付款")).toEqual([]);
  });

  it("[P1] flags markdown but allows plain list markers", () => {
    expect(findMarkdownSyntax("**重點**")).toContain("bold");
    expect(findMarkdownSyntax("# 標題")).toContain("heading");
    expect(findMarkdownSyntax("> 引言")).toContain("blockquote");
    expect(findMarkdownSyntax("1. 登入\n2. 驗證\n- 其他")).toEqual([]);
  });

  it("[P1] reports every violated assertion rather than stopping at the first", () => {
    const probe: PromptEvalCase = {
      id: "probe",
      source: "l1-personal",
      input: "使用API呼叫",
      expected: "使用 API 呼叫",
      phenomena: ["code-switching"],
      assertions: [
        { kind: "preserveTerms", terms: ["API"] },
        { kind: "latinSpacing" },
        { kind: "traditionalOnly" },
        { kind: "noTrailingPeriod" },
      ],
      notes: "probe",
      provenance: "probe",
    };

    const result = evaluateCase(probe, "使用api呼叫这样。");
    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.kind).sort()).toEqual([
      "latinSpacing",
      "noTrailingPeriod",
      "preserveTerms",
      "traditionalOnly",
    ]);
  });

  it("[P1] throws a locatable error for an unknown assertion kind", () => {
    // 模擬 fixture 打錯字：若無 default 分支，evaluateAssertion 會回傳 undefined，
    // 最後在報表組裝時炸成無法定位的 TypeError。
    const probe = {
      id: "probe-bad-kind",
      source: "l1-personal",
      input: "使用API呼叫",
      expected: "使用 API 呼叫",
      phenomena: ["code-switching"],
      assertions: [{ kind: "latinSpaceing" }],
      notes: "probe",
      provenance: "probe",
    } as unknown as PromptEvalCase;

    expect(() => evaluateCase(probe, "使用 API 呼叫")).toThrow(
      /未知的 assertion kind.*latinSpaceing/,
    );
  });

  it("[P2] passes a fully compliant output", () => {
    const probe: PromptEvalCase = {
      id: "probe-ok",
      source: "l2-ml2021",
      input: "那我們用API呼叫",
      expected: "那我們用 API 呼叫",
      phenomena: ["code-switching"],
      assertions: [
        { kind: "preserveTerms", terms: ["API"] },
        { kind: "latinSpacing" },
        { kind: "traditionalOnly" },
        { kind: "fullWidthPunctuation" },
        { kind: "noTrailingPeriod" },
        { kind: "noMarkdown" },
        { kind: "lengthRatio", min: 0.9, max: 1.3 },
      ],
      notes: "probe",
      provenance: "probe",
    };

    expect(evaluateCase(probe, "那我們用 API 呼叫")).toMatchObject({
      passed: true,
      failures: [],
    });
  });
});
