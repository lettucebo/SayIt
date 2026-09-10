import { describe, expect, test, vi } from "vitest";
import * as screenshotMock from "../../scripts/screenshots/tauriScreenshotMock.mjs";
import {
  buildTutorialCapturePlan,
  createScreenshotEventBus,
  createScreenshotFixtures,
  normalizeScreenshotMockOptions,
  selectScreenshotRows,
} from "../../scripts/screenshots/tauriScreenshotMock.mjs";

describe("tutorial screenshot mock", () => {
  test("[P1] normalizes deterministic safe defaults", () => {
    // Given: only the requested locale and window label
    const options = {
      selectedLocale: "en",
      windowLabel: "main-window",
    };

    // When: screenshot mock options are normalized
    const normalized = normalizeScreenshotMockOptions(options);

    // Then: the UI is configured, deterministic, and visibly fake
    expect(normalized.storeValues).toMatchObject({
      selectedLocale: "en",
      selectedTranscriptionLocale: "en",
      themeMode: "light",
      groqApiKey: "gsk_••••••••",
      lastSeenVersion: "1.1.1",
    });
    expect(normalized.windowLabel).toBe("main-window");
    expect(normalized.timezoneId).toBe("Asia/Taipei");
    expect(normalized.fixedNowIso).toBe("2026-09-10T03:00:00.000Z");
    expect(normalized.colorScheme).toBe("light");
    expect(normalized.transcriptions.length).toBeGreaterThan(0);
    expect(normalized.apiUsage.length).toBeGreaterThan(0);
    expect(normalized.vocabulary.length).toBeGreaterThan(0);
    expect(JSON.stringify(normalized)).not.toMatch(
      /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|sk-[A-Za-z0-9]{16,}|gsk_[A-Za-z0-9]{16,})/i,
    );
  });

  test("[P1] routes application SQL to correctly shaped fake rows", () => {
    // Given: deterministic English screenshot fixtures
    const fixtures = createScreenshotFixtures("en");

    // When: application queries request each tutorial data surface
    const transcriptionRows = selectScreenshotRows(
      "SELECT id, timestamp, raw_text FROM transcriptions ORDER BY timestamp DESC LIMIT $1 OFFSET $2",
      [20, 0],
      fixtures,
    );
    const statsRows = selectScreenshotRows(
      "SELECT COUNT(*) as total_count, COALESCE(SUM(char_count), 0) as total_characters FROM transcriptions WHERE status != 'failed'",
      [],
      fixtures,
    );
    const usageRows = selectScreenshotRows(
      "SELECT api_type, model, COUNT(*) as request_count FROM api_usage WHERE created_at >= $1",
      ["2026-01-01", "2026-12-31"],
      fixtures,
    );
    const trendRows = selectScreenshotRows(
      "SELECT date(timestamp / 1000, 'unixepoch', 'localtime') as date, COUNT(*) as count, COALESCE(SUM(char_count), 0) as total_chars FROM transcriptions WHERE status != 'failed' GROUP BY date ORDER BY date ASC",
      [],
      fixtures,
    );
    const vocabularyRows = selectScreenshotRows(
      "SELECT id, term, weight, source, created_at FROM vocabulary ORDER BY weight DESC, created_at DESC",
      [],
      fixtures,
    );

    // Then: each result has the wire shape consumed by the Pinia stores
    expect(transcriptionRows[0]).toMatchObject({
      id: expect.any(String),
      raw_text: expect.any(String),
      processed_text: expect.any(String),
      was_enhanced: 1,
      status: "success",
    });
    expect(statsRows).toEqual([
      {
        total_count: fixtures.transcriptions.length,
        total_characters: expect.any(Number),
        total_recording_duration_ms: expect.any(Number),
      },
    ]);
    expect(usageRows[0]).toMatchObject({
      api_type: expect.any(String),
      model: expect.any(String),
      provider_bucket: expect.any(String),
      request_count: expect.any(Number),
      total_tokens: expect.any(Number),
      billed_audio_ms: expect.any(Number),
    });
    expect(vocabularyRows).toEqual(fixtures.vocabulary);
    expect(trendRows).toHaveLength(3);
    expect(trendRows.reduce((total, row) => total + row.count, 0)).toBe(
      statsRows[0].total_count,
    );
    expect(trendRows.reduce((total, row) => total + row.total_chars, 0)).toBe(
      statsRows[0].total_characters,
    );
  });

  test("[P1] replays database ready after the HUD ping event", () => {
    // Given: a ready listener registered through the pure event bus
    const dispatch = vi.fn();
    const eventBus = createScreenshotEventBus(dispatch);
    const listenerId = eventBus.listen("database:ready", 42);

    // When: the HUD asks the Dashboard to replay database readiness
    eventBus.emit("database:ready-ping");

    // Then: the listener receives a Tauri-shaped database:ready event
    expect(dispatch).toHaveBeenCalledWith(42, {
      event: "database:ready",
      id: listenerId,
      payload: null,
    });
  });

  test("[P1] builds the complete localized tutorial capture plan", () => {
    // Given: a locale-specific output directory
    const outputDirectory = "C:\\tutorial-output\\en\\images";

    // When: the screenshot plan is built
    const plan = buildTutorialCapturePlan("en", outputDirectory);

    // Then: every required tutorial surface has a stable unique PNG target
    expect(plan.map(({ id }) => id)).toEqual([
      "dashboard",
      "settings-provider-api-key",
      "settings-hotkey",
      "settings-audio",
      "settings-advanced",
      "history",
      "dictionary",
      "feature-guide",
      "hud-mode-switch",
    ]);
    expect(new Set(plan.map(({ outputPath }) => outputPath)).size).toBe(
      plan.length,
    );
    expect(plan.every(({ locale }) => locale === "en")).toBe(true);
    expect(plan.every(({ outputPath }) => outputPath.endsWith(".png"))).toBe(
      true,
    );
    expect(plan.every(({ timezoneId }) => timezoneId === "Asia/Taipei")).toBe(
      true,
    );
    expect(
      plan.every(
        ({ fixedNowIso }) => fixedNowIso === "2026-09-10T03:00:00.000Z",
      ),
    ).toBe(true);
    expect(plan.find(({ id }) => id === "dashboard")).toMatchObject({
      chartSelector: '[data-slot="chart"]',
      chartPathSelector: "svg path[d]",
    });
    expect(
      plan.find(({ id }) => id === "settings-provider-api-key"),
    ).toMatchObject({
      cardTitle: "Groq API Key",
      captureMode: "single-card",
    });
    expect(
      plan.find(({ id }) => id === "settings-provider-api-key")
        ?.revealApiKeyText,
    ).toBe("Show");
    expect(plan.find(({ id }) => id === "history")?.readyTestId).toBe(
      "reenhance-button",
    );
    expect(plan.find(({ id }) => id === "feature-guide")).toMatchObject({
      captureMode: "card-range",
      rangeStartTestId: "whats-new",
      rangeEndCardIndex: 1,
    });
    expect(plan.find(({ id }) => id === "hud-mode-switch")).toMatchObject({
      colorScheme: "dark",
      event: "hotkey:mode-toggle",
      elementSelector: ".notch-hud",
      expectedWidth: 350,
      expectedHeight: 36,
      label: "Active",
    });
  });

  test("[P1] requires rendered Dashboard area and line paths inside the chart", () => {
    // Given: unrelated SVG paths plus the real chart container
    document.body.innerHTML = `
      <aside><svg><path d="M0,0 L100,100" style="stroke: red" /></svg></aside>
      <div data-slot="card"><svg><path d="M0,0 L100,100" style="stroke: red" /></svg></div>
      <div data-slot="chart">
        <svg>
          <path data-kind="area" d="M0,80 L100,20 L100,100 Z" style="fill: rgb(245, 158, 11); stroke: none" />
          <path data-kind="line" d="M0,80 L100,20" style="fill: none; stroke: rgb(245, 158, 11)" />
        </svg>
      </div>
    `;
    for (const path of document.querySelectorAll<SVGPathElement>(
      '[data-slot="chart"] path',
    )) {
      path.getBoundingClientRect = () =>
        ({
          x: 0,
          y: 0,
          width: 100,
          height: path.dataset.kind === "line" ? 60 : 80,
          top: 0,
          right: 100,
          bottom: 80,
          left: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    }

    // When: the exact predicate used by page.waitForFunction inspects the DOM
    const chartReady = screenshotMock.dashboardChartReadyInDocument;

    // Then: both scoped, non-empty, visibly rendered paths are required
    expect(chartReady).toBeTypeOf("function");
    if (typeof chartReady !== "function") return;
    expect(
      chartReady({
        chartSelector: '[data-slot="chart"]',
        pathSelector: "svg path[d]",
      }),
    ).toBe(true);

    document
      .querySelector<SVGPathElement>('[data-kind="line"]')
      ?.setAttribute("d", "");
    expect(
      chartReady({
        chartSelector: '[data-slot="chart"]',
        pathSelector: "svg path[d]",
      }),
    ).toBe(false);

    const linePath =
      document.querySelector<SVGPathElement>('[data-kind="line"]');
    linePath?.setAttribute("d", "M0,80 L100,20");
    if (linePath) linePath.style.strokeOpacity = "0";
    expect(
      chartReady({
        chartSelector: '[data-slot="chart"]',
        pathSelector: "svg path[d]",
      }),
    ).toBe(false);
  });

  test("[P1] waits for Dashboard chart paths to stop changing", () => {
    // Given: a rendered area and line path
    document.body.innerHTML = `
      <div data-slot="chart">
        <svg>
          <path data-kind="area" d="M0,80 L100,20 L100,100 Z" style="fill: rgb(245, 158, 11); stroke: none" />
          <path data-kind="line" d="M0,80 L100,20" style="fill: none; stroke: rgb(245, 158, 11)" />
        </svg>
      </div>
    `;
    for (const path of document.querySelectorAll<SVGPathElement>(
      '[data-slot="chart"] path',
    )) {
      path.getBoundingClientRect = () =>
        ({
          x: 0,
          y: 0,
          width: 100,
          height: 60,
          top: 0,
          right: 100,
          bottom: 60,
          left: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    }
    const chartSettled = screenshotMock.dashboardChartSettledInDocument;
    const selectors = {
      chartSelector: '[data-slot="chart"]',
      pathSelector: "svg path[d]",
      stableFrameCount: 3,
    };

    // When / Then: identical frames must repeat before capture is allowed
    expect(chartSettled).toBeTypeOf("function");
    if (typeof chartSettled !== "function") return;
    expect(chartSettled(selectors)).toBe(false);
    expect(chartSettled(selectors)).toBe(false);
    expect(chartSettled(selectors)).toBe(false);
    expect(chartSettled(selectors)).toBe(true);

    document
      .querySelector<SVGPathElement>('[data-kind="line"]')
      ?.setAttribute("d", "M0,70 L100,10");
    expect(chartSettled(selectors)).toBe(false);
  });

  test("[P1] installs the exact browser runtime with a frozen clock and shared SQL results", async () => {
    // Given: normalized fixtures and the browser globals before installation
    const normalized = normalizeScreenshotMockOptions({
      selectedLocale: "en",
      windowLabel: "main-window",
    });
    const originalDate = window.Date;
    const originalInternals = (
      window as typeof window & {
        __TAURI_INTERNALS__?: {
          invoke: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;

    try {
      // When: the same self-contained callback used by page.addInitScript runs
      screenshotMock.installTauriScreenshotRuntime(normalized);
      const internals = (
        window as typeof window & {
          __TAURI_INTERNALS__: {
            invoke: (
              command: string,
              args?: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const query =
        "SELECT date(timestamp / 1000, 'unixepoch', 'localtime') as date, COUNT(*) as count FROM transcriptions GROUP BY date";
      const injectedRows = await internals.invoke("plugin:sql|select", {
        query,
        values: [],
      });

      // Then: wall-clock values are fixed while explicit dates and SQL still work
      expect(new window.Date().toISOString()).toBe(normalized.fixedNowIso);
      expect(window.Date.now()).toBe(Date.parse(normalized.fixedNowIso));
      expect(new window.Date("2020-01-02T03:04:05.000Z").toISOString()).toBe(
        "2020-01-02T03:04:05.000Z",
      );
      expect(injectedRows).toEqual(
        selectScreenshotRows(query, [], normalized),
      );
    } finally {
      window.Date = originalDate;
      if (originalInternals) {
        (
          window as typeof window & {
            __TAURI_INTERNALS__?: typeof originalInternals;
          }
        ).__TAURI_INTERNALS__ = originalInternals;
      } else {
        delete (
          window as typeof window & {
            __TAURI_INTERNALS__?: unknown;
          }
        ).__TAURI_INTERNALS__;
      }
      delete (
        window as typeof window & {
          __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown;
        }
      ).__TAURI_EVENT_PLUGIN_INTERNALS__;
      delete (
        window as typeof window & {
          __SAYIT_SCREENSHOT_TAURI_MOCK__?: unknown;
        }
      ).__SAYIT_SCREENSHOT_TAURI_MOCK__;
    }
  });
});
