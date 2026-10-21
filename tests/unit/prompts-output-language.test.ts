import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getAutoLanguagePrompt,
  getPromptForModeAndLocale,
} from "../../src/i18n/prompts";
import type { SupportedLocale } from "../../src/i18n/languageConfig";

const LOCALES = ["zh-TW", "zh-CN", "en", "ja", "ko"] as const;
const MODES = ["minimal", "active"] as const;

const AUTO_LANGUAGE_RULES: Record<SupportedLocale, string> = {
  "zh-TW": "保持輸入的原語言，不要翻譯。中文使用繁體中文",
  "zh-CN": "保持输入的原语言，不要翻译。中文使用简体中文",
  en: "Preserve the input language; do not translate",
  ja: "入力の言語を維持し、翻訳しないでください",
  ko: "입력 언어를 유지하고 번역하지 마세요",
};

// SHA-256 of each complete UTF-8 preset prompt at be78c654, before introducing auto.
const EXPLICIT_PROMPT_HASHES = {
  minimal: {
    "zh-TW": "662b5d164a47e497580fa2dc957ee8bc70bfbe13149e1513efb715476d181d44",
    en: "97b43e7cc73e1ba1e2ad7e6181eb11111f2e48639e1ca39c410ccfd888835fdf",
    ja: "fd0f585c05dd9352ffe03795c27f84978216ad2ac0ff32834666cf234831ec77",
    "zh-CN": "be9758c547526498ac4403af1d7c6f8972685d7cc20fcf7cf0b0f35f60646cc7",
    ko: "8e45aba0cf05180a80885490b0cfe914b90626afc088e689d74619db14bef350",
  },
  active: {
    "zh-TW": "7a9743c061551b394f0034638c2c928eddd634eff2d1250a70242a51ec2c2820",
    en: "893966e8c6c3c359fb61fbd0ca21d6065a0d5b2bf43a1afaf9aa1e367619f681",
    ja: "a0732fbf00c0147d8f886786a308d2d7f4f689793a05ce9a5ba58989d4185230",
    "zh-CN": "79a36488afe9b4fd4c23eb68e0083b587e89f7784fe4724fc764a0713d14b68a",
    ko: "878fd5b5f50767b885a684efc0a116c9dce016357c1b5b3feb4e7b384eb02fba",
  },
} as const;

describe("preset output language", () => {
  it.each(MODES.flatMap((mode) => LOCALES.map((locale) => [mode, locale] as const)))(
    "[P0] %s auto in %s UI preserves input language without translation",
    (mode, locale) => {
      const prompt = getAutoLanguagePrompt(mode, locale);
      expect(prompt).toContain(AUTO_LANGUAGE_RULES[locale]);
      expect(prompt).not.toBe(getPromptForModeAndLocale(mode, locale));
      if (locale === "zh-TW") {
        expect(prompt).toContain("中文使用繁體中文");
      }
      if (locale === "zh-CN") {
        expect(prompt).toContain("中文使用简体中文");
      }
    },
  );

  it.each(MODES.flatMap((mode) => LOCALES.map((locale) => [mode, locale] as const)))(
    "[P0] %s explicit %s prompt retains all baseline UTF-8 bytes",
    (mode, locale) => {
      const prompt = getPromptForModeAndLocale(mode, locale);
      expect(createHash("sha256").update(prompt, "utf8").digest("hex")).toBe(
        EXPLICIT_PROMPT_HASHES[mode][locale],
      );
    },
  );
});
