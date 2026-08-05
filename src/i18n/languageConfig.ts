export type SupportedLocale = "zh-TW" | "en" | "ja" | "zh-CN" | "ko";

export const FALLBACK_LOCALE: SupportedLocale = "zh-TW";

export interface LanguageOption {
  locale: SupportedLocale;
  displayName: string;
  whisperCode: string;
  /** Azure AI Speech Fast Transcription 的候選語言 BCP-47 代碼。 */
  maiLocale: MaiCandidateLocale;
  htmlLang: string;
  navigatorPatternList: string[];
}

export type MaiCandidateLocale =
  | "zh-TW"
  | "en-US"
  | "ja-JP"
  | "zh-CN"
  | "ko-KR";

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  {
    locale: "zh-TW",
    displayName: "\u7E41\u9AD4\u4E2D\u6587",
    whisperCode: "zh",
    maiLocale: "zh-TW",
    htmlLang: "zh-Hant",
    navigatorPatternList: ["zh-Hant-TW", "zh-Hant", "zh-TW"],
  },
  {
    locale: "en",
    displayName: "English",
    whisperCode: "en",
    maiLocale: "en-US",
    htmlLang: "en",
    navigatorPatternList: ["en"],
  },
  {
    locale: "ja",
    displayName: "\u65E5\u672C\u8A9E",
    whisperCode: "ja",
    maiLocale: "ja-JP",
    htmlLang: "ja",
    navigatorPatternList: ["ja"],
  },
  {
    locale: "zh-CN",
    displayName: "\u7B80\u4F53\u4E2D\u6587",
    whisperCode: "zh",
    maiLocale: "zh-CN",
    htmlLang: "zh-Hans",
    navigatorPatternList: ["zh-Hans", "zh-CN"],
  },
  {
    locale: "ko",
    displayName: "\uD55C\uAD6D\uC5B4",
    whisperCode: "ko",
    maiLocale: "ko-KR",
    htmlLang: "ko",
    navigatorPatternList: ["ko"],
  },
];

export function detectSystemLocale(): SupportedLocale {
  const browserLanguageList =
    typeof navigator !== "undefined" ? navigator.languages : [];

  for (const browserLang of browserLanguageList) {
    // 1. Exact match (e.g. "zh-Hant-TW" -> zh-TW)
    for (const option of LANGUAGE_OPTIONS) {
      if (
        option.navigatorPatternList.some(
          (pattern) => pattern.toLowerCase() === browserLang.toLowerCase(),
        )
      ) {
        return option.locale;
      }
    }

    // 2. Script subtag match (e.g. "zh-Hant" -> zh-TW, "zh-Hans" -> zh-CN)
    for (const option of LANGUAGE_OPTIONS) {
      if (
        option.navigatorPatternList.some((pattern) =>
          browserLang.toLowerCase().startsWith(pattern.toLowerCase() + "-"),
        )
      ) {
        return option.locale;
      }
    }

    // 3. Language prefix match (e.g. "ja-JP" -> ja, "ko-KR" -> ko, "en-US" -> en)
    const langPrefix = browserLang.split("-")[0].toLowerCase();
    for (const option of LANGUAGE_OPTIONS) {
      if (option.locale.toLowerCase() === langPrefix) {
        return option.locale;
      }
    }

    // 4. Bare "zh" -> zh-TW (protect traditional Chinese users)
    if (langPrefix === "zh") {
      return "zh-TW";
    }
  }

  // 5. Fallback
  return FALLBACK_LOCALE;
}

export function getHtmlLangForLocale(locale: SupportedLocale): string {
  const option = LANGUAGE_OPTIONS.find((o) => o.locale === locale);
  return option?.htmlLang ?? "zh-Hant";
}

export function getWhisperCodeForLocale(locale: SupportedLocale): string {
  const option = LANGUAGE_OPTIONS.find((o) => o.locale === locale);
  return option?.whisperCode ?? "zh";
}

export type TranscriptionLocale = SupportedLocale | "auto";

export interface TranscriptionLanguageOption {
  locale: TranscriptionLocale;
  displayName: string;
  whisperCode: string | null;
}

export const TRANSCRIPTION_LANGUAGE_OPTIONS: TranscriptionLanguageOption[] = [
  {
    locale: "auto",
    displayName: "自動偵測",
    whisperCode: null,
  },
  ...LANGUAGE_OPTIONS.map((opt) => ({
    locale: opt.locale as TranscriptionLocale,
    displayName: opt.displayName,
    whisperCode: opt.whisperCode,
  })),
];

/**
 * MAI 目前設定頁提供與 SayIt 五個 UI 語系對應的輸入語言。
 * Fast Transcription 的 MAI enhanced mode 限制最多一個 locale；留空才是多語自動辨識。
 */
export const MAI_CANDIDATE_LOCALE_OPTIONS = LANGUAGE_OPTIONS.map((option) => ({
  locale: option.maiLocale,
  displayName: option.displayName,
}));

const MAI_CANDIDATE_LOCALE_SET = new Set<string>(
  MAI_CANDIDATE_LOCALE_OPTIONS.map((option) => option.locale),
);

export function normalizeMaiCandidateLocales(
  value: unknown,
): MaiCandidateLocale[] {
  if (!Array.isArray(value)) return [];
  const normalized: MaiCandidateLocale[] = [];
  for (const locale of value) {
    if (
      typeof locale === "string" &&
      MAI_CANDIDATE_LOCALE_SET.has(locale) &&
      !normalized.includes(locale as MaiCandidateLocale)
    ) {
      normalized.push(locale as MaiCandidateLocale);
    }
  }
  return normalized.slice(0, 1);
}

export function getWhisperCodeForTranscriptionLocale(
  locale: TranscriptionLocale,
): string | null {
  if (locale === "auto") return null;
  return getWhisperCodeForLocale(locale);
}
