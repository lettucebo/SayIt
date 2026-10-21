<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import type { TestResult } from "@/lib/connectionTest";

const props = withDefaults(defineProps<{
  onTest: () => Promise<TestResult>;
  disabled?: boolean;
  contextKey?: number;
  label?: string;
  testId?: string;
}>(), {
  contextKey: 0,
  label: undefined,
  testId: undefined,
});

const { t } = useI18n();
const testing = ref(false);
const result = ref<TestResult | null>(null);
let contextGeneration = 0;

function invalidateResult() {
  contextGeneration++;
  result.value = null;
}

watch(() => props.contextKey, invalidateResult, { flush: "sync" });
watch(() => props.disabled, (disabled) => {
  if (disabled) invalidateResult();
}, { flush: "sync" });

async function handleTest() {
  if (props.disabled || testing.value) return;

  const startedGeneration = contextGeneration;
  testing.value = true;
  result.value = null;
  try {
    const testResult = await props.onTest();
    if (startedGeneration === contextGeneration) {
      result.value = testResult;
    }
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div class="space-y-2">
    <Button
      type="button"
      variant="outline"
      size="sm"
      :data-testid="testId"
      :disabled="disabled || testing"
      @click="handleTest"
    >
      {{
        testing
          ? t("settings.connectionTest.testing")
          : label ?? t("settings.connectionTest.button")
      }}
    </Button>

    <div
      v-if="result?.ok === true"
      class="text-sm text-success"
    >
      ✅
      {{ t("settings.connectionTest.success", { ms: result.durationMs }) }}
    </div>

    <div
      v-else-if="result?.ok === false"
      class="text-sm text-destructive"
    >
      ❌ {{ result.errorMessage }}
    </div>
  </div>
</template>
