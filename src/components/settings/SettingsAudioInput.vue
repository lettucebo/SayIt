<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Mic, RefreshCw } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import InlineFeedback from "@/components/InlineFeedback.vue";
import SettingsActionRow from "@/components/SettingsActionRow.vue";
import { useAudioPreview } from "@/composables/useAudioPreview";
import { useFeedbackMessage } from "@/composables/useFeedbackMessage";
import { extractErrorMessage } from "@/lib/errorUtils";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { AudioInputDeviceInfo } from "@/types/audio";

const { t } = useI18n();
const settingsStore = useSettingsStore();
const audioInputDeviceList = ref<AudioInputDeviceInfo[]>([]);
const defaultInputDeviceName = ref<string | null>(null);
const isRefreshingDeviceList = ref(false);
const audioInputFeedback = useFeedbackMessage();
const deviceListFeedback = useFeedbackMessage();
const { previewLevel, isPreviewActive, startPreview } = useAudioPreview();
let isUnmounted = false;
let hasLoadedDeviceList = false;

async function loadAudioInputDeviceList(showSuccess = false) {
  const selectedDeviceAtRefreshStart = settingsStore.selectedAudioInputDeviceName;
  isRefreshingDeviceList.value = true;
  try {
    const result = await settingsStore.getAudioInputDeviceList();
    if (isUnmounted) return;

    audioInputDeviceList.value = result.devices;
    defaultInputDeviceName.value = result.defaultDeviceName;
    hasLoadedDeviceList = true;
    if (showSuccess) {
      deviceListFeedback.show(
        "success",
        t("settings.audioInput.refreshed", { count: result.devices.length }),
      );
    }
    void startPreview(settingsStore.selectedAudioInputDeviceName);
  } catch (err) {
    if (!isUnmounted) {
      deviceListFeedback.show("error", extractErrorMessage(err));
      if (
        hasLoadedDeviceList
        && settingsStore.selectedAudioInputDeviceName !== selectedDeviceAtRefreshStart
      ) {
        void startPreview(settingsStore.selectedAudioInputDeviceName);
      }
    }
  } finally {
    isRefreshingDeviceList.value = false;
  }
}

async function handleAudioInputDeviceChange(deviceName: string) {
  try {
    await settingsStore.saveAudioInputDevice(deviceName);
    if (isUnmounted) return;
    audioInputFeedback.show("success", t("settings.audioInput.updated"));
  } catch (err) {
    if (!isUnmounted) {
      audioInputFeedback.show("error", extractErrorMessage(err));
    }
  }
}

watch(
  () => settingsStore.selectedAudioInputDeviceName,
  (deviceName) => {
    if (!isUnmounted && hasLoadedDeviceList && !isRefreshingDeviceList.value) {
      void startPreview(deviceName);
    }
  },
);

onMounted(() => {
  void loadAudioInputDeviceList();
});

onBeforeUnmount(() => {
  isUnmounted = true;
});
</script>

<template>
  <Card>
    <CardHeader class="border-b border-border">
      <CardTitle class="text-base">{{ t("settings.audioInput.title") }}</CardTitle>
    </CardHeader>
    <CardContent class="space-y-3">
      <p class="text-sm text-muted-foreground leading-relaxed">
        {{ t("settings.audioInput.description") }}
      </p>
      <div class="space-y-2">
        <div class="flex items-baseline">
          <Label for="audio-input-device">{{ t("settings.audioInput.deviceLabel") }}</Label>
          <InlineFeedback :feedback="audioInputFeedback.state.value" class="ms-2" />
        </div>
        <div class="flex items-center gap-2">
          <Select
            :model-value="settingsStore.selectedAudioInputDeviceName || '_default'"
            @update:model-value="handleAudioInputDeviceChange($event === '_default' ? '' : ($event as string))"
          >
            <SelectTrigger id="audio-input-device" class="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_default">
                {{
                  defaultInputDeviceName
                    ? t("settings.audioInput.systemDefaultWithDevice", {
                      device: defaultInputDeviceName,
                    })
                    : t("settings.audioInput.systemDefault")
                }}
              </SelectItem>
              <SelectItem
                v-for="device in audioInputDeviceList"
                :key="device.name"
                :value="device.name"
              >
                {{ device.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <SettingsActionRow :feedback="deviceListFeedback.state.value">
            <Button
              variant="outline"
              size="icon"
              :aria-label="t('settings.audioInput.refresh')"
              :disabled="isRefreshingDeviceList"
              @click="loadAudioInputDeviceList(true)"
            >
              <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isRefreshingDeviceList }" />
            </Button>
          </SettingsActionRow>
        </div>
      </div>
      <div
        v-if="isPreviewActive"
        role="meter"
        :aria-valuenow="Math.round(previewLevel * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="t('settings.audioInput.volumePreview')"
        class="flex items-center gap-2 h-5"
      >
        <Mic class="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <div class="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            class="h-full rounded-full bg-primary transition-[width] duration-75"
            :style="{ width: `${Math.round(previewLevel * 100)}%` }"
          />
        </div>
      </div>
    </CardContent>
  </Card>
</template>
