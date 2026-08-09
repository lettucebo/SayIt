<script setup lang="ts">
import type { Feedback } from "@/composables/useFeedbackMessage";
import InlineFeedback from "./InlineFeedback.vue";

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
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="flex items-baseline">
        <slot name="label" />
        <InlineFeedback
          :feedback="feedback"
          :assertive="assertive"
          class="ms-2"
        />
      </div>
      <slot name="description" />
    </div>
    <div class="shrink-0">
      <slot />
    </div>
  </div>
</template>
