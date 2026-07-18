import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import zhTW from "../../src/i18n/locales/zh-TW.json";
import en from "../../src/i18n/locales/en.json";
import FeatureGuideView from "../../src/views/FeatureGuideView.vue";

type Messages = Record<string, unknown>;

function createTestI18n(
  locale = "zh-TW",
  messages: Record<string, Messages> = { "zh-TW": zhTW, en },
) {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: "en",
    messages,
  });
}

// 以獨立於元件實作的方式（用 slice 取數字，而非同一組 regex）取出 canonical item，
// 避免測試複製元件內潛在的萃取 bug。
function canonicalItems(messages: Messages): string[] {
  const mainApp = messages.mainApp as Record<string, unknown>;
  const notice = mainApp.upgradeNotice as Record<string, string>;
  return Object.keys(notice)
    .filter((k) => /^item\d+$/.test(k))
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
    .map((k) => notice[k]);
}

describe("FeatureGuideView 更新亮點卡片", () => {
  beforeEach(() => {
    // vitest 未套用 vite define，須手動注入 __APP_VERSION__，否則 mount 會 ReferenceError。
    vi.stubGlobal("__APP_VERSION__", "9.9.9");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[P1] 更新亮點卡片應是頁面第一個元素並顯示當下版本號", () => {
    const wrapper = mount(FeatureGuideView, {
      global: { plugins: [createTestI18n()] },
    });

    const first = wrapper.element.firstElementChild;
    expect(first?.getAttribute("data-testid")).toBe("whats-new");

    const card = wrapper.get('[data-testid="whats-new"]');
    expect(card.text()).toContain("9.9.9");
  });

  it("[P2] 應依序渲染 upgradeNotice 的每個 item，且不出現未翻譯的 key", () => {
    const wrapper = mount(FeatureGuideView, {
      global: { plugins: [createTestI18n()] },
    });

    const items = wrapper
      .findAll('[data-testid="whats-new"] li')
      .map((li) => li.text());
    expect(items).toEqual(canonicalItems(zhTW));
    expect(items.length).toBeGreaterThan(0);

    const text = wrapper.text();
    expect(text).not.toContain("mainApp.upgradeNotice");
    expect(text).not.toContain("featureGuide.whatsNew.title");
  });

  it("[P2] 切換語系後標題與內容應更新為對應語言", async () => {
    const i18n = createTestI18n();
    const wrapper = mount(FeatureGuideView, {
      global: { plugins: [i18n] },
    });

    expect(wrapper.get('[data-testid="whats-new"]').text()).toContain(
      "本次更新重點",
    );

    i18n.global.locale.value = "en";
    await nextTick();

    const card = wrapper.get('[data-testid="whats-new"]');
    expect(card.text()).toContain("What's new in v9.9.9");
    const items = wrapper
      .findAll('[data-testid="whats-new"] li')
      .map((li) => li.text());
    expect(items).toEqual(canonicalItems(en));
  });

  it("[P2] itemN key 非連續且亂序時應依數字順序渲染", () => {
    const messages = structuredClone(zhTW) as Messages;
    const mainApp = messages.mainApp as Record<string, unknown>;
    const notice = mainApp.upgradeNotice as Record<string, unknown>;
    for (const k of Object.keys(notice)) {
      if (/^item\d+$/.test(k)) delete notice[k];
    }
    // 刻意以非數字順序、且非連續（缺 item3..item9）插入，確保確實測到元件的數字排序。
    notice.item10 = "第十項";
    notice.item2 = "第二項";
    notice.item1 = "第一項";

    const wrapper = mount(FeatureGuideView, {
      global: {
        plugins: [createTestI18n("zh-TW", { "zh-TW": messages, en })],
      },
    });

    const items = wrapper
      .findAll('[data-testid="whats-new"] li')
      .map((li) => li.text());
    expect(items).toEqual(["第一項", "第二項", "第十項"]);
  });

  it("[P3] upgradeNotice 無任何 item 時應隱藏卡片", () => {
    const noItems = structuredClone(zhTW) as Messages;
    const mainApp = noItems.mainApp as Record<string, unknown>;
    const notice = mainApp.upgradeNotice as Record<string, unknown>;
    for (const k of Object.keys(notice)) {
      if (/^item\d+$/.test(k)) delete notice[k];
    }

    const wrapper = mount(FeatureGuideView, {
      global: { plugins: [createTestI18n("zh-TW", { "zh-TW": noItems, en })] },
    });

    expect(wrapper.find('[data-testid="whats-new"]').exists()).toBe(false);
  });
});
