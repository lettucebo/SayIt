import path from "node:path";

const SUPPORTED_LOCALE_LIST = ["zh-TW", "en"];
const SCHEMA_VERSION = 9;
const FIXED_NOW_ISO = "2026-09-10T03:00:00.000Z";
const TIMEZONE_ID = "Asia/Taipei";
const TABLE_LIST = [
  "api_usage",
  "schema_version",
  "transcriptions",
  "vocabulary",
];

const CAPTURE_LABELS = {
  "zh-TW": {
    dashboard: "儀表板",
    history: "歷史記錄",
    dictionary: "自訂字典",
    settings: "設定",
    guide: "功能介紹",
    providerApiKey: "Groq API Key",
    model: "模型選擇",
    showApiKey: "顯示",
    modeSwitch: "積極",
    hotkey: "快捷鍵設定",
    audio: "輸入裝置",
    advanced: "除錯記錄（進階）",
  },
  en: {
    dashboard: "Dashboard",
    history: "History",
    dictionary: "Dictionary",
    settings: "Settings",
    guide: "Feature Guide",
    providerApiKey: "Groq API Key",
    model: "Model Selection",
    showApiKey: "Show",
    modeSwitch: "Active",
    hotkey: "Hotkey Settings",
    audio: "Input Device",
    advanced: "Debug Logging (Advanced)",
  },
};

function assertSupportedLocale(locale) {
  if (!SUPPORTED_LOCALE_LIST.includes(locale)) {
    throw new Error(`Unsupported screenshot locale: ${locale}`);
  }
}

export function createScreenshotFixtures(locale) {
  assertSupportedLocale(locale);

  const isEnglish = locale === "en";
  const transcriptionTextList = isEnglish
    ? [
        {
          raw: "please turn this voice note into a concise project update",
          processed:
            "Project update: the onboarding flow is ready for review, and the remaining work is limited to documentation screenshots.",
        },
        {
          raw: "remember to mention the keyboard shortcut and microphone settings",
          processed:
            "Remember to mention the keyboard shortcut and microphone settings.",
        },
        {
          raw: "add SayIt and Playwright to the custom dictionary",
          processed: "Add SayIt and Playwright to the custom dictionary.",
        },
        {
          raw: "capture the dashboard after the usage chart is ready",
          processed: "Capture the dashboard after the usage chart is ready.",
        },
        {
          raw: "use only clearly fictional content in tutorial screenshots",
          processed:
            "Use only clearly fictional content in tutorial screenshots.",
        },
        {
          raw: "keep the tutorial output deterministic across repeated runs",
          processed:
            "Keep the tutorial output deterministic across repeated runs.",
        },
      ]
    : [
        {
          raw: "請把這段語音整理成簡短的專案進度",
          processed:
            "專案進度：新手引導流程已可供審閱，剩餘工作僅包含教學截圖。",
        },
        {
          raw: "記得提到快捷鍵和麥克風設定",
          processed: "請記得說明快捷鍵與麥克風設定。",
        },
        {
          raw: "把 SayIt 跟 Playwright 加到自訂字典",
          processed: "將 SayIt 與 Playwright 加入自訂字典。",
        },
        {
          raw: "等使用趨勢圖完成後再截儀表板",
          processed: "請在使用趨勢圖完成繪製後再擷取儀表板。",
        },
        {
          raw: "教學截圖只使用明顯的假資料",
          processed: "教學截圖僅使用明顯的虛構資料。",
        },
        {
          raw: "每次重拍教學圖片都要得到相同日期",
          processed: "每次重拍教學圖片都應顯示相同日期。",
        },
      ];

  const baseTimestamp = Date.UTC(2026, 8, 9, 2, 30);
  const dayOffsetList = [0, 0, 0, 1, 1, 2];
  const transcriptions = transcriptionTextList.map((text, index) => {
    const dayOffset = dayOffsetList[index];
    const timestamp =
      baseTimestamp - dayOffset * 86_400_000 - (index % 3) * 3_600_000;
    const day = String(9 - dayOffset).padStart(2, "0");
    const hour = String(10 - (index % 3)).padStart(2, "0");
    return {
      id: `tutorial-transcription-${index + 1}`,
      timestamp,
      raw_text: text.raw,
      processed_text: text.processed,
      recording_duration_ms: 18_000 + index * 7_000,
      transcription_duration_ms: 920 + index * 140,
      enhancement_duration_ms: 480 + index * 90,
      char_count: text.processed.length,
      trigger_mode: index === 1 ? "toggle" : "hold",
      was_enhanced: 1,
      was_modified: index === 0 ? 1 : 0,
      created_at: `2026-09-${day} ${hour}:30:00`,
      audio_file_path: null,
      status: "success",
      is_edit_mode: 0,
      edit_source_text: null,
    };
  });

  const apiUsage = [
    {
      api_type: "whisper",
      model: "whisper-large-v3-turbo",
      provider_bucket: "whisper",
      request_count: 7,
      total_tokens: 0,
      billed_audio_ms: 196_000,
    },
    {
      api_type: "chat",
      model: "qwen/qwen3-32b",
      provider_bucket: "whisper",
      request_count: 7,
      total_tokens: 4_820,
      billed_audio_ms: 0,
    },
    {
      api_type: "vocabulary_analysis",
      model: "qwen/qwen3-32b",
      provider_bucket: "whisper",
      request_count: 2,
      total_tokens: 860,
      billed_audio_ms: 0,
    },
  ];

  const vocabulary = isEnglish
    ? [
        {
          id: "tutorial-vocabulary-1",
          term: "SayIt",
          weight: 42,
          source: "manual",
          created_at: "2026-09-08 08:00:00",
        },
        {
          id: "tutorial-vocabulary-2",
          term: "Playwright",
          weight: 27,
          source: "ai",
          created_at: "2026-09-07 09:15:00",
        },
        {
          id: "tutorial-vocabulary-3",
          term: "Tauri",
          weight: 12,
          source: "manual",
          created_at: "2026-09-06 11:30:00",
        },
      ]
    : [
        {
          id: "tutorial-vocabulary-1",
          term: "SayIt",
          weight: 42,
          source: "manual",
          created_at: "2026-09-08 08:00:00",
        },
        {
          id: "tutorial-vocabulary-2",
          term: "語音轉錄",
          weight: 27,
          source: "ai",
          created_at: "2026-09-07 09:15:00",
        },
        {
          id: "tutorial-vocabulary-3",
          term: "教學截圖",
          weight: 12,
          source: "manual",
          created_at: "2026-09-06 11:30:00",
        },
      ];

  const dailyUsageMap = new Map();
  for (const transcription of transcriptions) {
    const date = transcription.created_at.slice(0, 10);
    const existing = dailyUsageMap.get(date) ?? {
      date,
      count: 0,
      total_chars: 0,
    };
    existing.count += 1;
    existing.total_chars += transcription.char_count;
    dailyUsageMap.set(date, existing);
  }
  const dailyUsageTrend = [...dailyUsageMap.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    tableList: [...TABLE_LIST],
    transcriptions,
    apiUsage,
    vocabulary,
    dailyUsageTrend,
  };
}

export function normalizeScreenshotMockOptions(options = {}) {
  const selectedLocale = options.selectedLocale ?? "zh-TW";
  const windowLabel = options.windowLabel ?? "main-window";
  const timezoneId = options.timezoneId ?? TIMEZONE_ID;
  const fixedNowIso = options.fixedNowIso ?? FIXED_NOW_ISO;
  const colorScheme = options.colorScheme ?? "light";
  assertSupportedLocale(selectedLocale);
  if (typeof windowLabel !== "string" || windowLabel.trim() === "") {
    throw new Error("Screenshot windowLabel must be a non-empty string");
  }

  const fixtures =
    options.fixtures ?? createScreenshotFixtures(selectedLocale);
  const storeValues = {
    selectedLocale,
    selectedTranscriptionLocale: selectedLocale,
    themeMode: colorScheme,
    groqApiKey: "gsk_••••••••",
    whisperProviderId: "groq",
    llmProviderId: "groq",
    promptMode: "minimal",
    hotkeyTriggerKey: "rightAlt",
    hotkeyTriggerMode: "hold",
    recordingAutoCleanupEnabled: true,
    recordingAutoCleanupDays: 30,
    debugLogEnabled: false,
    debugLogRetentionDays: 7,
    audioInputDeviceName: "",
    soundEffectsEnabled: true,
    muteOnRecording: false,
    copyTranscriptionToClipboard: false,
    smartDictionaryEnabled: true,
    contextInjectionEnabled: false,
    lastSeenVersion: "1.1.1",
    ...options.storeValues,
  };

  return {
    selectedLocale,
    windowLabel,
    timezoneId,
    fixedNowIso,
    colorScheme,
    storeValues,
    ...fixtures,
  };
}

function normalizeSql(query) {
  return query.replace(/\s+/g, " ").trim().toLowerCase();
}

function cloneRows(rows) {
  return rows.map((row) => ({ ...row }));
}

export function selectScreenshotRows(query, values = [], fixtures) {
  const normalizedQuery = normalizeSql(query);

  if (normalizedQuery.includes("select version from schema_version")) {
    return [{ version: fixtures.schemaVersion }];
  }
  if (normalizedQuery.includes("from sqlite_master")) {
    const tableName = String(values[0] ?? "");
    return fixtures.tableList.includes(tableName) ? [{ name: tableName }] : [];
  }
  if (normalizedQuery.includes("pragma table_info")) {
    return [
      { name: "id" },
      { name: "weight" },
      { name: "source" },
      { name: "audio_file_path" },
      { name: "status" },
      { name: "is_edit_mode" },
      { name: "edit_source_text" },
    ];
  }
  if (normalizedQuery.includes("select 1 as n")) {
    return [{ n: 1 }];
  }
  if (
    normalizedQuery.includes("from transcriptions") &&
    normalizedQuery.includes("group by date")
  ) {
    return cloneRows(fixtures.dailyUsageTrend);
  }
  if (
    normalizedQuery.includes("from transcriptions") &&
    normalizedQuery.includes("count(*) as total_count")
  ) {
    return [
      {
        total_count: fixtures.transcriptions.length,
        total_characters: fixtures.transcriptions.reduce(
          (total, row) => total + row.char_count,
          0,
        ),
        total_recording_duration_ms: fixtures.transcriptions.reduce(
          (total, row) => total + row.recording_duration_ms,
          0,
        ),
      },
    ];
  }
  if (normalizedQuery.includes("from api_usage")) {
    return cloneRows(fixtures.apiUsage);
  }
  if (normalizedQuery.includes("from vocabulary")) {
    if (normalizedQuery.startsWith("select term from vocabulary")) {
      const limit = Number(values[0] ?? fixtures.vocabulary.length);
      return fixtures.vocabulary.slice(0, limit).map(({ term }) => ({ term }));
    }
    if (normalizedQuery.startsWith("select id, term, weight from vocabulary")) {
      return fixtures.vocabulary.map(({ id, term, weight }) => ({
        id,
        term,
        weight,
      }));
    }
    return cloneRows(fixtures.vocabulary);
  }
  if (normalizedQuery.includes("from transcriptions")) {
    let rows = fixtures.transcriptions;
    if (normalizedQuery.includes(" like ")) {
      const search = String(values[0] ?? "")
        .replace(/^%|%$/g, "")
        .replace(/\\([%_\\])/g, "$1")
        .toLocaleLowerCase();
      rows = rows.filter(
        (row) =>
          row.raw_text.toLocaleLowerCase().includes(search) ||
          row.processed_text?.toLocaleLowerCase().includes(search),
      );
    }
    const offset = Number(values.at(-1) ?? 0);
    const limit = Number(values.at(-2) ?? rows.length);
    return cloneRows(rows.slice(offset, offset + limit));
  }

  return [];
}

export function createScreenshotEventBus(dispatch) {
  const listenerMap = new Map();
  let nextListenerId = 0;

  const emitSingle = (event, payload = null) => {
    for (const [listenerId, listener] of listenerMap.entries()) {
      if (listener.event !== event) continue;
      dispatch(listener.callbackId, {
        event,
        id: listenerId,
        payload,
      });
    }

  };

  return {
    listen(event, callbackId) {
      nextListenerId += 1;
      listenerMap.set(nextListenerId, { event, callbackId });
      return nextListenerId;
    },
    unlisten(listenerId) {
      listenerMap.delete(listenerId);
    },
    emit(event, payload = null) {
      emitSingle(event, payload);
      if (event === "database:ready-ping") {
        emitSingle("database:ready", null);
      }
    },
  };
}

export function dashboardChartReadyInDocument({
  chartSelector = '[data-slot="chart"]',
  pathSelector = "svg path[d]",
} = {}) {
  const chart = document.querySelector(chartSelector);
  if (!chart) return false;

  let hasArea = false;
  let hasLine = false;
  for (const path of chart.querySelectorAll(pathSelector)) {
    const d = path.getAttribute("d")?.trim() ?? "";
    if (!d) continue;

    const bounds = path.getBoundingClientRect();
    if (bounds.width < 8 || bounds.height < 8) continue;

    const style = getComputedStyle(path);
    const fill = style.fill.trim().toLowerCase();
    const stroke = style.stroke.trim().toLowerCase();
    const opacity = Number.parseFloat(style.opacity || "1");
    const fillOpacity = Number.parseFloat(style.fillOpacity || "1");
    const strokeOpacity = Number.parseFloat(style.strokeOpacity || "1");
    const isDisplayed =
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      opacity > 0;
    const hasVisibleFill =
      isDisplayed &&
      fillOpacity > 0 &&
      fill !== "" &&
      fill !== "none" &&
      fill !== "transparent" &&
      fill !== "rgba(0, 0, 0, 0)";
    const hasVisibleStroke =
      isDisplayed &&
      strokeOpacity > 0 &&
      stroke !== "" &&
      stroke !== "none" &&
      stroke !== "transparent" &&
      stroke !== "rgba(0, 0, 0, 0)";

    hasArea ||= hasVisibleFill;
    hasLine ||= hasVisibleStroke && !hasVisibleFill;
  }

  return hasArea && hasLine;
}

export function dashboardChartSettledInDocument({
  chartSelector = '[data-slot="chart"]',
  pathSelector = "svg path[d]",
  stableFrameCount = 8,
} = {}) {
  const chart = document.querySelector(chartSelector);
  const stateKey = "__SAYIT_SCREENSHOT_DASHBOARD_CHART_STATE__";
  if (!chart) {
    delete globalThis[stateKey];
    return false;
  }

  let hasArea = false;
  let hasLine = false;
  const signaturePartList = [];
  for (const path of chart.querySelectorAll(pathSelector)) {
    const d = path.getAttribute("d")?.trim() ?? "";
    if (!d) continue;

    const bounds = path.getBoundingClientRect();
    if (bounds.width < 8 || bounds.height < 8) continue;

    const style = getComputedStyle(path);
    const fill = style.fill.trim().toLowerCase();
    const stroke = style.stroke.trim().toLowerCase();
    const opacity = Number.parseFloat(style.opacity || "1");
    const fillOpacity = Number.parseFloat(style.fillOpacity || "1");
    const strokeOpacity = Number.parseFloat(style.strokeOpacity || "1");
    const isDisplayed =
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      opacity > 0;
    const hasVisibleFill =
      isDisplayed &&
      fillOpacity > 0 &&
      fill !== "" &&
      fill !== "none" &&
      fill !== "transparent" &&
      fill !== "rgba(0, 0, 0, 0)";
    const hasVisibleStroke =
      isDisplayed &&
      strokeOpacity > 0 &&
      stroke !== "" &&
      stroke !== "none" &&
      stroke !== "transparent" &&
      stroke !== "rgba(0, 0, 0, 0)";

    hasArea ||= hasVisibleFill;
    hasLine ||= hasVisibleStroke && !hasVisibleFill;
    if (hasVisibleFill || hasVisibleStroke) {
      signaturePartList.push(`${fill}|${stroke}|${d}`);
    }
  }

  if (!hasArea || !hasLine) {
    delete globalThis[stateKey];
    return false;
  }

  const signature = signaturePartList.join("\n");
  const previousState = globalThis[stateKey];
  const stableFrames =
    previousState?.signature === signature
      ? previousState.stableFrames + 1
      : 0;
  globalThis[stateKey] = { signature, stableFrames };
  return stableFrames >= stableFrameCount;
}

export function buildTutorialCapturePlan(locale, outputDirectory) {
  assertSupportedLocale(locale);
  const labels = CAPTURE_LABELS[locale];
  const outputPathFor = (id) => path.join(outputDirectory, `${id}.png`);

  const shotList = [
    {
      id: "dashboard",
      locale,
      windowLabel: "main-window",
      url: "/main-window.html#/dashboard",
      readyText: labels.dashboard,
      chartSelector: '[data-slot="chart"]',
      chartPathSelector: "svg path[d]",
      outputPath: outputPathFor("dashboard"),
    },
    {
      id: "settings-provider-api-key",
      locale,
      windowLabel: "main-window",
      url: "/main-window.html#/settings",
      readyText: labels.settings,
      cardTitle: labels.providerApiKey,
      captureMode: "single-card",
      revealApiKeyText: labels.showApiKey,
      outputPath: outputPathFor("settings-provider-api-key"),
    },
    {
      id: "settings-hotkey",
      locale,
      windowLabel: "main-window",
      url: "/main-window.html#/settings",
      readyText: labels.settings,
      cardTitle: labels.hotkey,
      outputPath: outputPathFor("settings-hotkey"),
    },
    {
      id: "settings-audio",
      locale,
      windowLabel: "main-window",
      url: "/main-window.html#/settings",
      readyText: labels.settings,
      cardTitle: labels.audio,
      outputPath: outputPathFor("settings-audio"),
    },
    {
      id: "settings-advanced",
      locale,
      windowLabel: "main-window",
      url: "/main-window.html#/settings",
      readyText: labels.settings,
      cardTitle: labels.advanced,
      outputPath: outputPathFor("settings-advanced"),
    },
    {
      id: "history",
      locale,
      windowLabel: "main-window",
      url: "/main-window.html#/history",
      readyText: labels.history,
      readyTestId: "reenhance-button",
      outputPath: outputPathFor("history"),
    },
    {
      id: "dictionary",
      locale,
      windowLabel: "main-window",
      url: "/main-window.html#/dictionary",
      readyText: labels.dictionary,
      outputPath: outputPathFor("dictionary"),
    },
    {
      id: "feature-guide",
      locale,
      windowLabel: "main-window",
      url: "/main-window.html#/guide",
      readyText: labels.guide,
      captureMode: "card-range",
      rangeStartTestId: "whats-new",
      rangeEndCardIndex: 1,
      outputPath: outputPathFor("feature-guide"),
    },
    {
      id: "hud-mode-switch",
      locale,
      windowLabel: "main",
      url: "/",
      event: "hotkey:mode-toggle",
      label: labels.modeSwitch,
      colorScheme: "dark",
      elementSelector: ".notch-hud",
      expectedWidth: 350,
      expectedHeight: 36,
      outputPath: outputPathFor("hud-mode-switch"),
    },
  ];

  return shotList.map((shot) => ({
    timezoneId: TIMEZONE_ID,
    fixedNowIso: FIXED_NOW_ISO,
    colorScheme: "light",
    ...shot,
  }));
}

export function installTauriScreenshotRuntime(mockOptions) {
    const storeState = new Map(Object.entries(mockOptions.storeValues));
    const callbackRegistry = new Map();
    const listenerMap = new Map();
    const globalScope = window;
    const NativeDate = globalScope.Date;
    const fixedTimestamp = NativeDate.parse(mockOptions.fixedNowIso);
    function FixedDate(...args) {
      if (new.target) {
        return args.length === 0
          ? new NativeDate(fixedTimestamp)
          : new NativeDate(...args);
      }
      return new NativeDate(fixedTimestamp).toString();
    }
    Object.setPrototypeOf(FixedDate, NativeDate);
    FixedDate.prototype = NativeDate.prototype;
    FixedDate.now = () => fixedTimestamp;
    globalScope.Date = FixedDate;
    let nextCallbackId = 0;
    let nextListenerId = 0;

    const normalizeQuery = (query) =>
      String(query).replace(/\s+/g, " ").trim().toLowerCase();
    const cloneResultRows = (rows) => rows.map((row) => ({ ...row }));

    const selectRows = (query, values = []) => {
      const normalizedQuery = normalizeQuery(query);

      if (normalizedQuery.includes("select version from schema_version")) {
        return [{ version: mockOptions.schemaVersion }];
      }
      if (normalizedQuery.includes("from sqlite_master")) {
        const tableName = String(values[0] ?? "");
        return mockOptions.tableList.includes(tableName)
          ? [{ name: tableName }]
          : [];
      }
      if (normalizedQuery.includes("pragma table_info")) {
        return [
          { name: "id" },
          { name: "weight" },
          { name: "source" },
          { name: "audio_file_path" },
          { name: "status" },
          { name: "is_edit_mode" },
          { name: "edit_source_text" },
        ];
      }
      if (normalizedQuery.includes("select 1 as n")) {
        return [{ n: 1 }];
      }
      if (
        normalizedQuery.includes("from transcriptions") &&
        normalizedQuery.includes("group by date")
      ) {
        return cloneResultRows(mockOptions.dailyUsageTrend);
      }
      if (
        normalizedQuery.includes("from transcriptions") &&
        normalizedQuery.includes("count(*) as total_count")
      ) {
        return [
          {
            total_count: mockOptions.transcriptions.length,
            total_characters: mockOptions.transcriptions.reduce(
              (total, row) => total + row.char_count,
              0,
            ),
            total_recording_duration_ms: mockOptions.transcriptions.reduce(
              (total, row) => total + row.recording_duration_ms,
              0,
            ),
          },
        ];
      }
      if (normalizedQuery.includes("from api_usage")) {
        return cloneResultRows(mockOptions.apiUsage);
      }
      if (normalizedQuery.includes("from vocabulary")) {
        if (normalizedQuery.startsWith("select term from vocabulary")) {
          const limit = Number(values[0] ?? mockOptions.vocabulary.length);
          return mockOptions.vocabulary
            .slice(0, limit)
            .map(({ term }) => ({ term }));
        }
        if (
          normalizedQuery.startsWith(
            "select id, term, weight from vocabulary",
          )
        ) {
          return mockOptions.vocabulary.map(({ id, term, weight }) => ({
            id,
            term,
            weight,
          }));
        }
        return cloneResultRows(mockOptions.vocabulary);
      }
      if (normalizedQuery.includes("from transcriptions")) {
        let rows = mockOptions.transcriptions;
        if (normalizedQuery.includes(" like ")) {
          const search = String(values[0] ?? "")
            .replace(/^%|%$/g, "")
            .replace(/\\([%_\\])/g, "$1")
            .toLocaleLowerCase();
          rows = rows.filter(
            (row) =>
              row.raw_text.toLocaleLowerCase().includes(search) ||
              row.processed_text?.toLocaleLowerCase().includes(search),
          );
        }
        const offset = Number(values.at(-1) ?? 0);
        const limit = Number(values.at(-2) ?? rows.length);
        return cloneResultRows(rows.slice(offset, offset + limit));
      }
      return [];
    };

    const dispatchEvent = (event, payload = null) => {
      for (const [listenerId, listener] of listenerMap.entries()) {
        if (listener.event !== event) continue;
        const callback = globalScope[`_${listener.callbackId}`];
        callback?.({ event, id: listenerId, payload });
      }
    };

    const emitEvent = (event, payload = null) => {
      dispatchEvent(event, payload);
      if (event === "database:ready-ping") {
        dispatchEvent("database:ready", null);
      }
    };

    const invokeStore = (command, args) => {
      const key = String(args.key ?? "");
      switch (command) {
        case "plugin:store|load":
        case "plugin:store|get_store":
          return 1;
        case "plugin:store|get":
          return [storeState.get(key), storeState.has(key)];
        case "plugin:store|set":
          storeState.set(key, args.value);
          return null;
        case "plugin:store|has":
          return storeState.has(key);
        case "plugin:store|delete":
          return storeState.delete(key);
        case "plugin:store|clear":
        case "plugin:store|reset":
          storeState.clear();
          return null;
        case "plugin:store|keys":
          return [...storeState.keys()];
        case "plugin:store|values":
          return [...storeState.values()];
        case "plugin:store|entries":
          return [...storeState.entries()];
        case "plugin:store|length":
          return storeState.size;
        case "plugin:store|reload":
        case "plugin:store|save":
          return null;
        default:
          throw new Error(`Unsupported store command: ${command}`);
      }
    };

    const invokeSql = (command, args) => {
      switch (command) {
        case "plugin:sql|load":
          return String(args.db ?? "sqlite:tutorial.db");
        case "plugin:sql|select":
          return selectRows(args.query, args.values ?? []);
        case "plugin:sql|execute":
          return [0, null];
        case "plugin:sql|close":
          return true;
        default:
          throw new Error(`Unsupported SQL command: ${command}`);
      }
    };

    const invoke = async (command, args = {}) => {
      if (command.startsWith("plugin:store|")) {
        return invokeStore(command, args);
      }
      if (command.startsWith("plugin:sql|")) {
        return invokeSql(command, args);
      }
      if (command === "plugin:event|listen") {
        nextListenerId += 1;
        listenerMap.set(nextListenerId, {
          event: String(args.event),
          callbackId: Number(args.handler),
        });
        return nextListenerId;
      }
      if (command === "plugin:event|unlisten") {
        listenerMap.delete(Number(args.eventId));
        return null;
      }
      if (
        command === "plugin:event|emit" ||
        command === "plugin:event|emit_to"
      ) {
        emitEvent(String(args.event), args.payload ?? null);
        return null;
      }
      if (command === "plugin:window|get_all_windows") {
        return [...new Set([mockOptions.windowLabel, "main", "main-window"])];
      }
      if (command === "plugin:window|theme" || command === "get_os_theme") {
        return mockOptions.colorScheme;
      }
      if (
        command.startsWith("plugin:window|") ||
        command.startsWith("plugin:webview|")
      ) {
        if (command.includes("|is_")) return false;
        return null;
      }
      if (command === "plugin:autostart|is_enabled") return false;
      if (command.startsWith("plugin:autostart|")) return null;
      if (command === "plugin:updater|check") return null;
      if (command.startsWith("plugin:updater|")) return null;
      if (command === "plugin:log|log") return null;
      if (command === "get_hud_target_position") {
        return {
          monitorKey: "tutorial-monitor",
          space: "logical",
          x: 440,
          y: 24,
        };
      }
      if (command === "list_audio_input_devices") {
        return [
          { name: "Tutorial Microphone", isDefault: true },
          { name: "Demo USB Microphone", isDefault: false },
        ];
      }
      if (command === "get_default_input_device_name") {
        return "Tutorial Microphone";
      }
      if (command === "read_selection_state") {
        return { kind: "noSelection", text: null };
      }
      if (
        command === "read_focused_text_field" ||
        command === "read_selected_text" ||
        command === "get_foreground_app_name" ||
        command === "azure_user_get_account"
      ) {
        return null;
      }
      if (
        command === "cleanup_old_logs" ||
        command === "cleanup_old_recordings"
      ) {
        return [];
      }
      if (command === "delete_all_recordings") return 0;
      if (command === "read_recording_file") return [];
      if (command === "is_debug_build") return true;
      if (command === "check_accessibility_permission_command") return true;
      return null;
    };

    const transformCallback = (callback, once = false) => {
      nextCallbackId += 1;
      const callbackId = nextCallbackId;
      const callbackName = `_${callbackId}`;
      globalScope[callbackName] = (payload) => {
        if (once) {
          delete globalScope[callbackName];
          callbackRegistry.delete(callbackId);
        }
        callback?.(payload);
      };
      callbackRegistry.set(callbackId, callback ?? (() => {}));
      return callbackId;
    };

    globalScope.__TAURI_INTERNALS__ = {
      invoke,
      transformCallback,
      unregisterCallback: (callbackId) => {
        callbackRegistry.delete(callbackId);
        delete globalScope[`_${callbackId}`];
      },
      convertFileSrc: (filePath) => filePath,
      metadata: {
        currentWindow: { label: mockOptions.windowLabel },
        currentWebview: {
          windowLabel: mockOptions.windowLabel,
          label: mockOptions.windowLabel,
        },
      },
    };
    globalScope.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event, listenerId) => {
        listenerMap.delete(listenerId);
      },
    };
    globalScope.__SAYIT_SCREENSHOT_TAURI_MOCK__ = {
      emit: emitEvent,
      getStoreValue: (key) => storeState.get(key),
      listenerCount: (event) =>
        [...listenerMap.values()].filter(
          (listener) => listener.event === event,
        ).length,
    };
    globalScope.isTauri = true;
}

export async function installTauriScreenshotMock(page, options = {}) {
  const init = normalizeScreenshotMockOptions(options);
  await page.addInitScript(installTauriScreenshotRuntime, init);
}
