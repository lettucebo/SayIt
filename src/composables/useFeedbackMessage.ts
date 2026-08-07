import { onScopeDispose, ref } from "vue";

export type FeedbackType = "success" | "error";

export type Feedback = {
  type: FeedbackType;
  message: string;
};

export type FeedbackOptions = {
  durationMs?: number;
  persistent?: boolean;
};

const SUCCESS_DISPLAY_DURATION_MS = 2_500;
const ERROR_DISPLAY_DURATION_MS = 6_000;

export function useFeedbackMessage() {
  const state = ref<Feedback | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function hide() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    state.value = null;
  }

  function show(
    type: FeedbackType,
    message: string,
    options: FeedbackOptions = {},
  ) {
    hide();
    state.value = { type, message };

    if (options.persistent) return;

    const durationMs = options.durationMs ??
      (type === "success"
        ? SUCCESS_DISPLAY_DURATION_MS
        : ERROR_DISPLAY_DURATION_MS);

    timer = setTimeout(() => {
      timer = null;
      state.value = null;
    }, durationMs);
  }

  onScopeDispose(hide);

  return { state, show, hide };
}
