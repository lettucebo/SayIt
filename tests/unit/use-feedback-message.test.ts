import { effectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFeedbackMessage } from "../../src/composables/useFeedbackMessage";

describe("useFeedbackMessage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("[P1] clears a success message after 2500ms", () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const feedback = scope.run(() => useFeedbackMessage());

    feedback?.show("success", "Saved");
    expect(feedback?.state.value).toEqual({ type: "success", message: "Saved" });

    vi.advanceTimersByTime(2_499);
    expect(feedback?.state.value).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(feedback?.state.value).toBeNull();
    scope.stop();
  });

  it("[P1] keeps an error message for 6000ms", () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const feedback = scope.run(() => useFeedbackMessage());

    feedback?.show("error", "Connection failed");
    vi.advanceTimersByTime(5_999);
    expect(feedback?.state.value).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(feedback?.state.value).toBeNull();
    scope.stop();
  });

  it("[P1] replaces the prior timer when a new result arrives", () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const feedback = scope.run(() => useFeedbackMessage());

    feedback?.show("error", "Old failure");
    vi.advanceTimersByTime(1_000);
    feedback?.show("success", "Saved");
    vi.advanceTimersByTime(2_500);

    expect(feedback?.state.value).toBeNull();
    scope.stop();
  });

  it("[P1] clears feedback when its Vue scope is disposed", () => {
    const scope = effectScope();
    const feedback = scope.run(() => useFeedbackMessage());

    feedback?.show("error", "Connection failed", { persistent: true });
    scope.stop();

    expect(feedback?.state.value).toBeNull();
  });
});
