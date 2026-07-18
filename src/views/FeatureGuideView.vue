<script setup lang="ts">
import {
  Mic,
  PenLine,
  Keyboard,
  ToggleLeft,
  Zap,
  Sparkles,
  BookOpen,
  History,
  Rocket,
} from "lucide-vue-next";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useI18n } from "vue-i18n";
import { computed, markRaw } from "vue";

declare const __APP_VERSION__: string;
const appVersion = __APP_VERSION__;

const { t, tm } = useI18n();

// 重用既有的五語系「升級摘要」(mainApp.upgradeNotice) 呈現當下版本更新亮點。
// 直接萃取實際存在的 itemN key、依數字排序後 render，避免 key 不連續造成漏 item。
const whatsNewItems = computed<string[]>(() => {
  const notice = tm("mainApp.upgradeNotice");
  if (typeof notice !== "object" || notice === null || Array.isArray(notice)) {
    return [];
  }
  return Object.keys(notice as Record<string, unknown>)
    .map((key) => {
      const match = /^item([1-9]\d*)$/.exec(key);
      return match ? { key, order: Number(match[1]) } : null;
    })
    .filter((entry): entry is { key: string; order: number } => entry !== null)
    .sort((a, b) => a.order - b.order)
    .map((entry) => t(`mainApp.upgradeNotice.${entry.key}`))
    .filter((text) => text.length > 0);
});

const featureList = [
  { key: "voiceInput", icon: markRaw(Mic), hasSteps: true },
  { key: "editSelection", icon: markRaw(PenLine), hasSteps: true },
  { key: "hotkey", icon: markRaw(Keyboard), hasSteps: false },
  { key: "triggerMode", icon: markRaw(ToggleLeft), hasSteps: false },
  { key: "quickModeSwitch", icon: markRaw(Zap), hasSteps: false },
  { key: "promptMode", icon: markRaw(Sparkles), hasSteps: false },
  { key: "dictionary", icon: markRaw(BookOpen), hasSteps: false },
  { key: "history", icon: markRaw(History), hasSteps: false },
];
</script>

<template>
  <div class="p-6 space-y-4 text-foreground">
    <Card v-if="whatsNewItems.length" data-testid="whats-new">
      <CardHeader class="border-b border-border py-3">
        <CardTitle class="text-base flex items-center gap-2">
          <Rocket class="size-4 text-muted-foreground" aria-hidden="true" />
          {{ t("featureGuide.whatsNew.title", { version: appVersion }) }}
        </CardTitle>
      </CardHeader>
      <CardContent class="pt-3 pb-4">
        <ol
          class="space-y-3 text-sm text-muted-foreground leading-relaxed list-decimal list-outside pl-5"
        >
          <li v-for="(item, index) in whatsNewItems" :key="index">
            {{ item }}
          </li>
        </ol>
      </CardContent>
    </Card>

    <p class="text-sm text-muted-foreground">
      {{ t("featureGuide.subtitle") }}
    </p>

    <Card v-for="feature in featureList" :key="feature.key">
      <CardHeader class="border-b border-border py-3">
        <CardTitle class="text-base flex items-center gap-2">
          <component :is="feature.icon" class="size-4 text-muted-foreground" />
          {{ t(`featureGuide.${feature.key}.title`) }}
        </CardTitle>
      </CardHeader>
      <CardContent class="pt-3 pb-4">
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ t(`featureGuide.${feature.key}.description`) }}
        </p>
        <p
          v-if="feature.hasSteps"
          class="mt-2 text-sm text-muted-foreground leading-relaxed"
        >
          {{ t(`featureGuide.${feature.key}.steps`) }}
        </p>
      </CardContent>
    </Card>
  </div>
</template>
