<script setup lang="ts">
import { openExternalUrl } from "@/lib/externalLink";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  href?: string;
}>();

function handleClick(event: MouseEvent) {
  event.preventDefault();
  void openExternalUrl(props.href);
}

function handleAuxClick(event: MouseEvent) {
  if (event.button !== 1) return;
  event.preventDefault();
  void openExternalUrl(props.href);
}
</script>

<template>
  <a
    v-if="href"
    v-bind="$attrs"
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    @click="handleClick"
    @auxclick="handleAuxClick"
  >
    <slot />
  </a>
  <span v-else v-bind="$attrs">
    <slot />
  </span>
</template>
