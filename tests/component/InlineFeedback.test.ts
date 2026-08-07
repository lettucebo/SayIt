import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import InlineFeedback from "../../src/components/InlineFeedback.vue";

describe("InlineFeedback", () => {
  it("[P1] keeps an empty live region when no feedback is present", () => {
    const wrapper = mount(InlineFeedback);

    expect(wrapper.attributes("role")).toBe("status");
    expect(wrapper.attributes("aria-live")).toBe("polite");
    expect(wrapper.text()).toBe("");
  });

  it("[P1] renders a success message with semantic color", () => {
    const wrapper = mount(InlineFeedback, {
      props: { feedback: { type: "success", message: "Saved" } },
    });

    expect(wrapper.text()).toBe("Saved");
    expect(wrapper.find("span span").classes()).toContain("text-success");
  });

  it("[P1] supports assertive error announcements", () => {
    const wrapper = mount(InlineFeedback, {
      props: {
        assertive: true,
        feedback: { type: "error", message: "Connection failed" },
      },
    });

    expect(wrapper.attributes("role")).toBe("alert");
    expect(wrapper.attributes("aria-live")).toBe("assertive");
    expect(wrapper.find("span span").classes()).toContain("text-destructive");
  });
});
