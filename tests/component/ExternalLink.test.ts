import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
}));

vi.mock("../../src/lib/externalLink", () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

import ExternalLink from "../../src/components/ExternalLink.vue";

describe("ExternalLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openExternalUrl.mockResolvedValue(true);
  });

  it("[P1] 一般點擊應交由系統瀏覽器開啟", async () => {
    const url = "https://github.com/lettucebo/SayIt";
    const wrapper = mount(ExternalLink, {
      props: { href: url },
      slots: { default: "SayIt" },
    });

    await wrapper.get("a").trigger("click");

    expect(mocks.openExternalUrl).toHaveBeenCalledWith(url);
  });

  it("[P1] 滑鼠中鍵應交由系統瀏覽器開啟", async () => {
    const url = "https://github.com/lettucebo/SayIt/releases";
    const wrapper = mount(ExternalLink, {
      props: { href: url },
    });

    await wrapper.get("a").trigger("auxclick", { button: 1 });

    expect(mocks.openExternalUrl).toHaveBeenCalledWith(url);
  });

  it("[P2] 滑鼠右鍵的 auxclick 不應開啟連結", async () => {
    const wrapper = mount(ExternalLink, {
      props: { href: "https://github.com/lettucebo/SayIt" },
    });

    await wrapper.get("a").trigger("auxclick", { button: 2 });

    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });

  it("[P2] 應保留連結語意、屬性、樣式與 slot 內容", () => {
    const url = "https://github.com/lettucebo/SayIt/issues";
    const wrapper = mount(ExternalLink, {
      props: { href: url },
      attrs: {
        class: "custom-link",
        "data-testid": "external-link",
      },
      slots: { default: "<span>Report issue</span>" },
    });
    const anchor = wrapper.get("a");

    expect(anchor.attributes("href")).toBe(url);
    expect(anchor.attributes("target")).toBe("_blank");
    expect(anchor.attributes("rel")).toBe("noopener noreferrer");
    expect(anchor.classes()).toContain("custom-link");
    expect(anchor.attributes("data-testid")).toBe("external-link");
    expect(anchor.text()).toBe("Report issue");
  });

  it("[P1] href 未定義時不應渲染假的可點擊連結", () => {
    const wrapper = mount(ExternalLink, {
      attrs: { class: "unavailable-link" },
      slots: { default: "Unavailable" },
    });

    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.get("span").classes()).toContain("unavailable-link");
    expect(wrapper.text()).toBe("Unavailable");
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });
});
