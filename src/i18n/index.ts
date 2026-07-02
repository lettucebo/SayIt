import { createI18n } from "vue-i18n";
import { FALLBACK_LOCALE, type SupportedLocale } from "./languageConfig";
import zhTW from "./locales/zh-TW.json";
import en from "./locales/en.json";

// zh-TW（預設 locale）與 en（fallbackLocale）需在啟動時就緒，避免 mount 後、
// loadSettings() 完成前出現缺字/閃爍；其餘語系延遲載入（perf 稽核 F3）。
const loadedLocaleSet = new Set<SupportedLocale>(["zh-TW", "en"]);

type MessageSchema = typeof zhTW;

// 明確標註支援的 locale 清單，讓 TS 知道 `i18n.global.locale` 可被指派為任一 SupportedLocale
// （非只有初始 messages 內含的 zh-TW/en），因為其餘語系是動態載入後才呼叫 setLocaleMessage。
const i18n = createI18n({
  legacy: false,
  locale: FALLBACK_LOCALE,
  fallbackLocale: "en",
  messages: {
    "zh-TW": zhTW,
    en,
  } as Record<SupportedLocale, MessageSchema>,
});

type LazyLocale = Exclude<SupportedLocale, "zh-TW" | "en">;

const lazyLocaleLoaderMap: Record<
  LazyLocale,
  () => Promise<{ default: MessageSchema }>
> = {
  ja: () => import("./locales/ja.json"),
  "zh-CN": () => import("./locales/zh-CN.json"),
  ko: () => import("./locales/ko.json"),
};

/** 確保指定語系的翻譯訊息已載入（非預設語系為動態 import，僅在真正需要時才下載）。 */
export async function ensureLocaleLoaded(
  locale: SupportedLocale,
): Promise<void> {
  if (loadedLocaleSet.has(locale)) return;

  const loader = lazyLocaleLoaderMap[locale as LazyLocale];
  if (!loader) return;

  const messages = await loader();
  i18n.global.setLocaleMessage(locale, messages.default);
  loadedLocaleSet.add(locale);
}

/** 切換目前顯示語系；會先確保訊息載入完成，避免短暫顯示 key 或 fallback 語系內容。
 *  `i18n.global.locale` 的型別是依 `messages` 靜態 key 推斷（僅 zh-TW/en），
 *  但其餘語系訊息已於 `ensureLocaleLoaded()` 動態載入，故此處需明確轉型。 */
export async function switchLocale(locale: SupportedLocale): Promise<void> {
  await ensureLocaleLoaded(locale);
  (i18n.global.locale as unknown as { value: SupportedLocale }).value =
    locale;
}

export default i18n;
