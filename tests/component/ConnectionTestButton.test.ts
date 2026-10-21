import {
  enableAutoUnmount,
  flushPromises,
  mount,
} from "@vue/test-utils";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectionTestButton from "../../src/components/ConnectionTestButton.vue";
import type { TestResult } from "../../src/lib/connectionTest";
import zhTW from "../../src/i18n/locales/zh-TW.json";

enableAutoUnmount(afterEach);

function deferredResult() {
  let resolve!: (value: TestResult) => void;
  const promise = new Promise<TestResult>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function mountButton(
  onTest: () => Promise<TestResult>,
  props: {
    disabled?: boolean;
    contextKey?: number;
    label?: string;
    testId?: string;
  } = {},
) {
  return mount(ConnectionTestButton, {
    props: { onTest, ...props },
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: "zh-TW",
          messages: { "zh-TW": zhTW },
        }),
      ],
    },
  });
}

const outcomes: TestResult[] = [
  { ok: true, durationMs: 37 },
  {
    ok: false,
    durationMs: 41,
    errorMessage: "API error 401: PermissionDenied",
  },
];

describe("ConnectionTestButton", () => {
  it("[P1] keeps the existing translated label without optional props", () => {
    const wrapper = mountButton(async () => outcomes[0]);

    expect(wrapper.get("button").text()).toBe(
      zhTW.settings.connectionTest.button,
    );
    expect(wrapper.get("button").element.disabled).toBe(false);
    expect(wrapper.find("[data-testid]").exists()).toBe(false);
    expect(wrapper.findAll(".text-success, .text-destructive")).toHaveLength(0);
  });

  it("[P1] binds the workflow test id to the actual disabled button", async () => {
    const pending = deferredResult();
    const onTest = vi.fn(() => pending.promise);
    const label = zhTW.settings.connectionTest.success.replace("{ms}", "37");
    const wrapper = mountButton(onTest, {
      label,
      testId: "ai-enhancement-test",
      disabled: true,
    });
    const button = wrapper.get<HTMLButtonElement>(
      '[data-testid="ai-enhancement-test"]',
    );

    expect(button.element.tagName).toBe("BUTTON");
    expect(wrapper.attributes("data-testid")).toBeUndefined();
    expect(button.element.disabled).toBe(true);
    expect(button.text()).toBe(label);
    await button.trigger("click");
    expect(onTest).not.toHaveBeenCalled();

    await wrapper.setProps({ disabled: false });
    await button.trigger("click");
    expect(button.element.disabled).toBe(true);
    expect(button.text()).toBe(zhTW.settings.connectionTest.testing);
    expect(onTest).toHaveBeenCalledTimes(1);

    pending.resolve(outcomes[0]);
    await flushPromises();
    expect(button.element.disabled).toBe(false);
    expect(button.text()).toBe(label);
  });

  it("[P1] uses a supplied workflow label except while testing", async () => {
    const pending = deferredResult();
    const label = zhTW.settings.connectionTest.success.replace("{ms}", "37");
    const wrapper = mountButton(() => pending.promise, { label });

    expect(wrapper.get("button").text()).toBe(label);
    await wrapper.get("button").trigger("click");
    expect(wrapper.get("button").text()).toBe(
      zhTW.settings.connectionTest.testing,
    );

    pending.resolve(outcomes[0]);
    await flushPromises();
    expect(wrapper.get("button").text()).toBe(label);
  });

  it("[P1] renders a normal success with the translated duration", async () => {
    const wrapper = mountButton(async () => outcomes[0]);

    await wrapper.get("button").trigger("click");
    await flushPromises();

    expect(wrapper.get(".text-success").text()).toContain(
      zhTW.settings.connectionTest.success.replace("{ms}", "37"),
    );
    expect(wrapper.find(".text-destructive").exists()).toBe(false);
    expect(wrapper.get("button").element.disabled).toBe(false);
  });

  it("[P1] preserves the diagnostic failure message", async () => {
    const failure = outcomes[1];
    const wrapper = mountButton(async () => failure);

    await wrapper.get("button").trigger("click");
    await flushPromises();

    expect(wrapper.get(".text-destructive").text()).toContain(
      "API error 401: PermissionDenied",
    );
    expect(wrapper.find(".text-success").exists()).toBe(false);
    expect(wrapper.get("button").element.disabled).toBe(false);
  });

  it("[P1] never starts a test while disabled", async () => {
    const onTest = vi.fn(async () => outcomes[0]);
    const wrapper = mountButton(onTest, { disabled: true });

    await wrapper.get("button").trigger("click");

    expect(wrapper.get("button").element.disabled).toBe(true);
    expect(onTest).not.toHaveBeenCalled();
  });

  it("[P1] blocks repeated clicks before the disabled DOM update", async () => {
    const pending = deferredResult();
    const onTest = vi.fn(() => pending.promise);
    const wrapper = mountButton(onTest);
    const button = wrapper.get("button").element;

    button.click();
    button.click();
    await nextTick();
    const callCount = onTest.mock.calls.length;
    pending.resolve(outcomes[0]);
    await flushPromises();

    expect(callCount).toBe(1);
  });

  it.each(outcomes)(
    "[P1] ignores a pending result after the context changes (ok=$ok)",
    async (outcome) => {
      const pending = deferredResult();
      const wrapper = mountButton(() => pending.promise, { contextKey: 1 });

      await wrapper.get("button").trigger("click");
      await wrapper.setProps({ contextKey: 2 });
      pending.resolve(outcome);
      await flushPromises();

      expect(wrapper.findAll(".text-success, .text-destructive")).toHaveLength(0);
      expect(wrapper.get("button").element.disabled).toBe(false);
    },
  );

  it.each(outcomes)(
    "[P1] invalidates a pending result even when the context returns (ok=$ok)",
    async (outcome) => {
      const pending = deferredResult();
      const wrapper = mountButton(() => pending.promise, { contextKey: 1 });

      await wrapper.get("button").trigger("click");
      await wrapper.setProps({ contextKey: 2 });
      await wrapper.setProps({ contextKey: 1 });
      pending.resolve(outcome);
      await flushPromises();

      expect(wrapper.findAll(".text-success, .text-destructive")).toHaveLength(0);
    },
  );

  it.each(outcomes)(
    "[P1] clears a completed result when the context changes (ok=$ok)",
    async (outcome) => {
      const wrapper = mountButton(async () => outcome);

      await wrapper.get("button").trigger("click");
      await flushPromises();
      expect(wrapper.findAll(".text-success, .text-destructive")).toHaveLength(1);

      await wrapper.setProps({ contextKey: 1 });

      expect(wrapper.findAll(".text-success, .text-destructive")).toHaveLength(0);
    },
  );

  it("[P1] keeps the original request locked across context changes", async () => {
    const original = deferredResult();
    const current = deferredResult();
    const onTest = vi.fn()
      .mockImplementationOnce(() => original.promise)
      .mockImplementationOnce(() => current.promise);
    const wrapper = mountButton(onTest, { contextKey: 1 });

    await wrapper.get("button").trigger("click");
    await wrapper.setProps({ contextKey: 2 });
    expect(wrapper.get("button").element.disabled).toBe(true);
    await wrapper.get("button").trigger("click");
    expect(onTest).toHaveBeenCalledTimes(1);

    original.resolve(outcomes[0]);
    await flushPromises();
    expect(wrapper.findAll(".text-success, .text-destructive")).toHaveLength(0);
    expect(wrapper.get("button").element.disabled).toBe(false);

    await wrapper.get("button").trigger("click");
    await wrapper.get("button").trigger("click");
    expect(onTest).toHaveBeenCalledTimes(2);
    expect(wrapper.get("button").element.disabled).toBe(true);

    current.resolve(outcomes[0]);
    await flushPromises();
    expect(wrapper.find(".text-success").exists()).toBe(true);
    expect(wrapper.get("button").element.disabled).toBe(false);
  });

  it.each(outcomes)(
    "[P1] ignores a pending result after a dirty draft is disabled and restored (ok=$ok)",
    async (outcome) => {
      const pending = deferredResult();
      const onTest = vi.fn(() => pending.promise);
      const wrapper = mountButton(onTest);

      await wrapper.get("button").trigger("click");
      await wrapper.setProps({ disabled: true });
      await wrapper.setProps({ disabled: false });
      expect(wrapper.get("button").element.disabled).toBe(true);
      await wrapper.get("button").trigger("click");
      expect(onTest).toHaveBeenCalledTimes(1);

      pending.resolve(outcome);
      await flushPromises();

      expect(wrapper.findAll(".text-success, .text-destructive")).toHaveLength(0);
      expect(wrapper.get("button").element.disabled).toBe(false);
    },
  );

  it.each(outcomes)(
    "[P1] clears a completed result when a dirty draft disables testing (ok=$ok)",
    async (outcome) => {
      const wrapper = mountButton(async () => outcome);

      await wrapper.get("button").trigger("click");
      await flushPromises();
      expect(wrapper.findAll(".text-success, .text-destructive")).toHaveLength(1);

      await wrapper.setProps({ disabled: true });

      expect(wrapper.findAll(".text-success, .text-destructive")).toHaveLength(0);
      expect(wrapper.get("button").element.disabled).toBe(true);
    },
  );
});
