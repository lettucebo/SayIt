<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useVocabularyStore } from "../stores/useVocabularyStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { extractErrorMessage } from "../lib/errorUtils";
import { useFeedbackMessage } from "../composables/useFeedbackMessage";
import { useTableSort, type SortColumn } from "../composables/useTableSort";
import { useI18n } from "vue-i18n";
import {
  Plus,
  Trash2,
  Bot,
  Hand,
  Info,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-vue-next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { captureError } from "../lib/sentry";
import type { VocabularyEntry, VocabularySource } from "../types/vocabulary";

type SortKey = "term" | "source" | "weight" | "createdAt";

const vocabularyStore = useVocabularyStore();
const settingsStore = useSettingsStore();
const { t, locale } = useI18n();

const newTermInput = ref("");
const isAdding = ref(false);
const removingTermIdSet = ref(new Set<string>());
const feedback = useFeedbackMessage();

const isAddDisabled = computed(
  () => !newTermInput.value.trim() || isAdding.value,
);

const showDuplicateHint = computed(
  () =>
    newTermInput.value.trim() !== "" &&
    vocabularyStore.isDuplicateTerm(newTermInput.value),
);

// 手動優先：使用者自訂詞排在機器建議之前
const SOURCE_RANK: Record<VocabularySource, number> = { manual: 0, ai: 1 };

// SQLite created_at 為 UTC 且不帶時區後綴，附加 "Z" 確保以 UTC 解析
const timestampOf = (entry: VocabularyEntry) =>
  new Date(entry.createdAt + "Z").getTime();

const sortColumns: SortColumn<VocabularyEntry, SortKey>[] = [
  {
    key: "term",
    compare: (a, b) => a.term.localeCompare(b.term, locale.value),
    defaultDirection: "asc",
  },
  {
    key: "source",
    compare: (a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source],
    defaultDirection: "asc",
  },
  {
    key: "weight",
    compare: (a, b) => a.weight - b.weight,
    defaultDirection: "desc",
  },
  {
    key: "createdAt",
    compare: (a, b) => timestampOf(a) - timestampOf(b),
    defaultDirection: "desc",
  },
];

// 固定次鍵：weight desc → createdAt desc → id asc
// id 為全序鍵，保證排序決定性（避免同秒時間戳造成順序不定）
const sortTieBreak = (a: VocabularyEntry, b: VocabularyEntry) =>
  b.weight - a.weight ||
  timestampOf(b) - timestampOf(a) ||
  a.id.localeCompare(b.id);

const { sortState, toggleSort, sortedList } = useTableSort<
  VocabularyEntry,
  SortKey
>(
  () => vocabularyStore.termList,
  sortColumns,
  { key: "weight", direction: "desc" },
  sortTieBreak,
);

function sortIconFor(key: SortKey) {
  if (sortState.value.key !== key) return ArrowUpDown;
  return sortState.value.direction === "asc" ? ArrowUp : ArrowDown;
}

function ariaSortFor(key: SortKey): "ascending" | "descending" | "none" {
  if (sortState.value.key !== key) return "none";
  return sortState.value.direction === "asc" ? "ascending" : "descending";
}

function sourceLabel(source: VocabularySource): string {
  return source === "ai"
    ? t("dictionary.sourceAi")
    : t("dictionary.sourceManual");
}

function getWeightVariant(weight: number): "default" | "secondary" | "outline" {
  if (weight >= 30) return "default";
  if (weight >= 10) return "secondary";
  return "outline";
}

async function handleAddTerm() {
  const term = newTermInput.value.trim();
  if (!term) return;

  try {
    isAdding.value = true;
    await vocabularyStore.addTerm(term);
    newTermInput.value = "";
    feedback.show("success", t("dictionary.added", { term }));
  } catch (err) {
    feedback.show("error", extractErrorMessage(err));
  } finally {
    isAdding.value = false;
  }
}

async function handleRemoveTerm(id: string, term: string) {
  if (removingTermIdSet.value.has(id)) return;

  try {
    removingTermIdSet.value.add(id);
    await vocabularyStore.removeTerm(id);
    feedback.show("success", t("dictionary.removed", { term }));
  } catch (err) {
    feedback.show("error", extractErrorMessage(err));
  } finally {
    removingTermIdSet.value.delete(id);
  }
}

function formatDate(dateString: string): string {
  try {
    // SQLite created_at 儲存為 UTC 且不帶時區後綴，附加 "Z" 確保以 UTC 解析
    const date = new Date(dateString + "Z");
    return date.toLocaleDateString(locale.value, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return dateString;
  }
}

onMounted(async () => {
  try {
    await vocabularyStore.fetchTermList();
  } catch (err) {
    feedback.show("error", t("dictionary.loadFailed"));
    captureError(err, { source: "dictionary-view-mount" });
  }
});

onBeforeUnmount(() => {
  feedback.clearTimer();
});
</script>

<template>
  <div class="p-6">
    <!-- Page header -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-2">
        <Badge variant="secondary">{{ $t("dictionary.termCount", { count: vocabularyStore.termCount }) }}</Badge>
      </div>

      <div class="flex items-center gap-2">
        <div class="flex flex-col">
          <Input
            v-model="newTermInput"
            :placeholder="$t('dictionary.inputPlaceholder')"
            class="w-48"
            @keydown.enter="handleAddTerm"
          />
          <p v-if="showDuplicateHint" class="mt-1 text-xs text-destructive">
            {{ $t("dictionary.duplicateEntry") }}
          </p>
        </div>
        <Button
          size="sm"
          :disabled="isAddDisabled || showDuplicateHint"
          @click="handleAddTerm"
        >
          <Plus class="h-4 w-4 mr-1" />{{ $t("dictionary.add") }}
        </Button>
      </div>
    </div>

    <!-- Description -->
    <div class="mt-4 rounded-lg border border-border bg-muted/50 p-4">
      <div class="flex gap-3">
        <Info class="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <div class="space-y-1 text-sm text-muted-foreground">
          <p>{{ $t("dictionary.description") }}</p>
          <p>{{ $t("dictionary.weightDescription", { limit: 50 }) }}</p>
          <p v-if="vocabularyStore.aiSuggestedTermList.length === 0">
            {{
              settingsStore.isSmartDictionaryEnabled
                ? $t("dictionary.noAiSuggestionsEnabled")
                : $t("dictionary.noAiSuggestions")
            }}
          </p>
          <p>{{ $t("dictionary.importHint") }}</p>
        </div>
      </div>
    </div>

    <!-- Feedback message -->
    <transition name="feedback-fade">
      <p
        v-if="feedback.message.value !== ''"
        class="mt-3 text-sm"
        :class="feedback.type.value === 'success' ? 'text-emerald-500' : 'text-destructive'"
      >
        {{ feedback.message.value }}
      </p>
    </transition>

    <!-- Loading state -->
    <div v-if="vocabularyStore.isLoading" class="mt-6 text-center text-muted-foreground">
      {{ $t("dictionary.loading") }}
    </div>

    <!-- Empty state -->
    <div v-else-if="vocabularyStore.termCount === 0" class="mt-6">
      <Card>
        <div class="px-4 py-8 text-center text-muted-foreground">
          {{ $t("dictionary.emptyState") }}
        </div>
      </Card>
    </div>

    <!-- Dictionary table -->
    <div v-else class="mt-6">
      <Card>
        <CardContent class="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-full" :aria-sort="ariaSortFor('term')">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="-ml-2 h-8"
                    data-testid="sort-term"
                    @click="toggleSort('term')"
                  >
                    {{ $t("dictionary.termHeader") }}
                    <component :is="sortIconFor('term')" class="ml-1 h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead class="w-28" :aria-sort="ariaSortFor('source')">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="-ml-2 h-8"
                    data-testid="sort-source"
                    @click="toggleSort('source')"
                  >
                    {{ $t("dictionary.sourceHeader") }}
                    <component :is="sortIconFor('source')" class="ml-1 h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead class="w-24 text-center" :aria-sort="ariaSortFor('weight')">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-8"
                    data-testid="sort-weight"
                    @click="toggleSort('weight')"
                  >
                    {{ $t("dictionary.weight") }}
                    <component :is="sortIconFor('weight')" class="ml-1 h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead class="w-40" :aria-sort="ariaSortFor('createdAt')">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="-ml-2 h-8"
                    data-testid="sort-date"
                    @click="toggleSort('createdAt')"
                  >
                    {{ $t("dictionary.dateHeader") }}
                    <component :is="sortIconFor('createdAt')" class="ml-1 h-3.5 w-3.5" />
                  </Button>
                </TableHead>
                <TableHead class="w-20 text-right">{{ $t("dictionary.actionHeader") }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="entry in sortedList"
                :key="entry.id"
                :data-testid="`vocab-row-${entry.id}`"
              >
                <TableCell class="font-medium text-foreground" data-testid="vocab-term">
                  {{ entry.term }}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" class="gap-1 font-normal" data-testid="vocab-source">
                    <component :is="entry.source === 'ai' ? Bot : Hand" class="h-3 w-3" />
                    {{ sourceLabel(entry.source) }}
                  </Badge>
                </TableCell>
                <TableCell class="text-center">
                  <Badge :variant="getWeightVariant(entry.weight)">{{ entry.weight }}</Badge>
                </TableCell>
                <TableCell class="text-muted-foreground">{{ formatDate(entry.createdAt) }}</TableCell>
                <TableCell class="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="text-destructive"
                    :disabled="removingTermIdSet.has(entry.id)"
                    @click="handleRemoveTerm(entry.id, entry.term)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  </div>
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
