<script setup lang="ts">
import type { Feedback } from "@/composables/useFeedbackMessage";
import InlineFeedback from "./InlineFeedback.vue";

withDefaults(
  defineProps<{
    feedback?: Feedback | null;
    align?: "start" | "end";
    assertive?: boolean;
  }>(),
  {
    feedback: null,
    align: "end",
    assertive: false,
  },
);
</script>

<template>
  <div
    class="grid items-start gap-3"
    :class="
      align === 'start'
        ? 'grid-cols-[auto_minmax(0,1fr)]'
        : 'grid-cols-[minmax(0,1fr)_auto]'
    "
  >
    <InlineFeedback
      :feedback="feedback"
      :assertive="assertive"
      :class="align === 'start' ? 'order-2' : 'order-1'"
    />
    <div
      class="flex shrink-0 items-center gap-2"
      :class="align === 'start' ? 'order-1' : 'order-2'"
    >
      <slot />
    </div>
  </div>
</template>
