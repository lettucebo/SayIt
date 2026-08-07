import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SettingsActionRow from "../../src/components/SettingsActionRow.vue";

describe("SettingsActionRow", () => {
  it("[P1] fixes end-aligned actions in an auto-sized grid column", () => {
    const wrapper = mount(SettingsActionRow, {
      props: { feedback: { type: "success", message: "Saved" } },
      slots: { default: '<button type="button">Save</button>' },
    });

    expect(wrapper.classes()).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(wrapper.find("button").element.parentElement?.classList).toContain(
      "shrink-0",
    );
  });

  it("[P1] places start-aligned actions before the feedback column", () => {
    const wrapper = mount(SettingsActionRow, {
      props: {
        align: "start",
        feedback: { type: "error", message: "Connection failed" },
      },
      slots: { default: '<button type="button">Save</button>' },
    });

    expect(wrapper.classes()).toContain("grid-cols-[auto_minmax(0,1fr)]");
    expect(wrapper.find("button").element.parentElement?.classList).toContain(
      "order-1",
    );
  });
});
