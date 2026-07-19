import { mount } from "@vue/test-utils";
import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import ChartTooltipContent from "../../src/components/ui/chart/ChartTooltipContent.vue";

const LABEL = "使用次數";
const config = { count: { label: LABEL, color: "#22c55e" } };

// 只掛載 tooltip 內容元件，直接餵入 unovis crosshair 會傳入的 payload 形狀（{ count: number }）。
function mountTooltip(value: number | null | undefined) {
  return mount(ChartTooltipContent, {
    props: {
      payload: { count: value },
      config,
      indicator: "dot" as const,
    },
  });
}

describe("ChartTooltipContent 數值渲染", () => {
  // 回歸保護：修正前 `v-if="value"` 會把 0 當 falsy，導致當天無使用量時只剩 label、數字空白。
  it("[P1] value=0 仍渲染數值（顯示 0 而非空白），且保留 label 該列", () => {
    const wrapper = mountTooltip(0);

    const valueSpan = wrapper.find(".tabular-nums");
    expect(valueSpan.exists()).toBe(true);
    expect(valueSpan.text()).toBe((0).toLocaleString());
    // label 那列（截圖中的「使用次數」）仍在，還原完整 tooltip 情境。
    expect(wrapper.text()).toContain(LABEL);
  });

  it("[P1] value>0 正常渲染數值", () => {
    const count = faker.number.int({ min: 1, max: 999 });
    const wrapper = mountTooltip(count);

    const valueSpan = wrapper.find(".tabular-nums");
    expect(valueSpan.exists()).toBe(true);
    expect(valueSpan.text()).toBe(count.toLocaleString());
  });

  it("[P2] value=undefined 不渲染數值 span（避免對 undefined 呼叫 toLocaleString）", () => {
    const wrapper = mountTooltip(undefined);
    expect(wrapper.find(".tabular-nums").exists()).toBe(false);
    expect(wrapper.text()).toContain(LABEL);
  });

  it("[P2] value=null 不渲染數值 span", () => {
    const wrapper = mountTooltip(null);
    expect(wrapper.find(".tabular-nums").exists()).toBe(false);
  });
});
