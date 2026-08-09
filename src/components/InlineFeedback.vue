<script setup lang="ts">
import type { Feedback } from "@/composables/useFeedbackMessage";

withDefaults(
  defineProps<{
    feedback?: Feedback | null;
    assertive?: boolean;
  }>(),
  {
    feedback: null,
    assertive: false,
  },
);
</script>

<template>
  <span
    class="min-w-0 text-sm [overflow-wrap:anywhere]"
    :role="assertive ? 'alert' : 'status'"
    :aria-live="assertive ? 'assertive' : 'polite'"
    aria-atomic="true"
  >
    <Transition name="feedback-fade">
      <span
        v-if="feedback"
        :class="feedback.type === 'success' ? 'text-success' : 'text-destructive'"
      >
        {{ feedback.message }}
      </span>
    </Transition>
  </span>
</template>

<style scoped>
.feedback-fade-enter-active,
.feedback-fade-leave-active {
  transition: opacity 180ms ease;
}

.feedback-fade-enter-from,
.feedback-fade-leave-to {
  opacity: 0;
}
</style>
