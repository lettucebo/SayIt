import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import {
  getStoreSetCount,
  installTauriMock,
} from "../support/helpers/tauriMock";

/**
 * Dashboard entry（HUD 在 `/`，設定頁在 main-window entry 的 hash route）。
 */
const SETTINGS_URL = "/main-window.html#/settings";

const MODEL_GRID_TESTID_LIST = [
  "whisper-provider-group",
  "llm-provider-group",
  "prompt-mode-group",
] as const;

const LAYOUT_CASE_LIST = [
  { width: 720, expectedColumns: 1 },
  { width: 768, expectedColumns: 2 },
  { width: 769, expectedColumns: 2 },
  { width: 960, expectedColumns: 2 },
  { width: 1023, expectedColumns: 2 },
  { width: 1024, expectedColumns: 3 },
  { width: 1025, expectedColumns: 3 },
] as const;
const LAYOUT_LOCALE_LIST = ["zh-TW", "en"] as const;
const PROVIDER_MARKER_TEXT_BY_LOCALE = {
  "zh-TW": {
    free: "免費",
    recommended: "推薦",
    bestQuality: "品質最佳",
  },
  en: {
    free: "Free",
    recommended: "Recommended",
    bestQuality: "Best quality",
  },
} as const;

async function openSettings(
  page: Page,
  options: {
    azureEnabled: boolean;
    locale?: (typeof LAYOUT_LOCALE_LIST)[number];
    width?: number;
    llmProviderId?: "groq" | "openai" | "anthropic" | "gemini" | "azure";
  },
): Promise<void> {
  await page.setViewportSize({
    width: options.width ?? 1280,
    height: 900,
  });
  await installTauriMock(page, {
    storeValues: {
      azureEnabled: options.azureEnabled,
      selectedLocale: options.locale ?? "zh-TW",
      llmProviderId: options.llmProviderId,
    },
  });
  await page.goto(SETTINGS_URL, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("whisper-provider-group")).toBeVisible();
}

async function readColumnCount(grid: Locator): Promise<number> {
  return grid.evaluate(
    (el) =>
      window
        .getComputedStyle(el)
        .gridTemplateColumns.split(" ")
        .filter((value) => value.length > 0).length,
  );
}

/**
 * 回傳溢位描述清單（空陣列＝無溢位）。失敗訊息直接指出是哪個選項、哪種溢位，
 * 比單純的 boolean 斷言好除錯。
 */
async function readOverflowReportList(grid: Locator): Promise<string[]> {
  return grid.evaluate((el) => {
    const reportList: string[] = [];
    const gridRect = el.getBoundingClientRect();
    const parentRect = el.parentElement?.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const tolerancePx = 0.5;

    if (el.scrollWidth > el.clientWidth) {
      reportList.push(
        `grid: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`,
      );
    }
    if (
      gridRect.left < -tolerancePx ||
      gridRect.right > viewportWidth + tolerancePx
    ) {
      reportList.push("grid: escapes viewport");
    }
    if (
      parentRect &&
      (gridRect.left < parentRect.left - tolerancePx ||
        gridRect.right > parentRect.right + tolerancePx)
    ) {
      reportList.push("grid: escapes parent box");
    }

    const childList = Array.from(el.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    for (const child of childList) {
      if (!(child instanceof HTMLElement)) continue;
      const name = child.dataset.testid ?? child.tagName.toLowerCase();
      if (child.scrollWidth > child.clientWidth) {
        reportList.push(`${name}: scrollWidth ${child.scrollWidth} > clientWidth ${child.clientWidth}`);
      }
      const childRect = child.getBoundingClientRect();
      if (
        childRect.right > gridRect.right + tolerancePx ||
        childRect.left < gridRect.left - tolerancePx
      ) {
        reportList.push(`${name}: escapes grid box`);
      }
      for (const descendant of Array.from(child.querySelectorAll("*"))) {
        const descendantRect = descendant.getBoundingClientRect();
        if (descendantRect.width === 0 && descendantRect.height === 0) continue;
        if (
          descendantRect.left < childRect.left - tolerancePx ||
          descendantRect.right > childRect.right + tolerancePx
        ) {
          reportList.push(
            `${name}: descendant <${descendant.tagName.toLowerCase()}> overflows option box`,
          );
        }
      }
    }

    for (let leftIndex = 0; leftIndex < childList.length; leftIndex += 1) {
      const leftRect = childList[leftIndex].getBoundingClientRect();
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < childList.length;
        rightIndex += 1
      ) {
        const rightRect = childList[rightIndex].getBoundingClientRect();
        const sameRow =
          Math.min(leftRect.bottom, rightRect.bottom) -
            Math.max(leftRect.top, rightRect.top) >
          tolerancePx;
        const horizontalOverlap =
          Math.min(leftRect.right, rightRect.right) -
          Math.max(leftRect.left, rightRect.left);
        if (sameRow && horizontalOverlap > tolerancePx) {
          reportList.push(
            `${childList[leftIndex].dataset.testid} overlaps ${childList[rightIndex].dataset.testid}`,
          );
        }
      }
    }

    return reportList;
  });
}

function normalizeText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.describe("Settings model selector layout", () => {
  for (const locale of LAYOUT_LOCALE_LIST) {
    for (const { width, expectedColumns } of LAYOUT_CASE_LIST) {
      test(`[P1] ${locale} @ ${width}px 三組模型選擇器不溢位`, async ({
        page,
      }) => {
        // Given: 以目標 viewport 首次載入，Azure 啟用且轉錄 provider 為三個選項
        await openSettings(page, { azureEnabled: true, locale, width });

        // Then: 每組選擇器的選項都不得水平溢位、重疊或跨出 grid
        for (const testId of MODEL_GRID_TESTID_LIST) {
          const grid = page.getByTestId(testId);
          await expect(grid).toBeVisible();
          await expect
            .poll(async () => readOverflowReportList(grid), {
              message: `${testId} @ ${width}px 出現溢位`,
            })
            .toEqual([]);
        }

        // And: viewport 斷點套用精確的欄數
        await expect
          .poll(
            async () =>
              readColumnCount(page.getByTestId("whisper-provider-group")),
            { message: `whisper-provider-group @ ${width}px 欄數錯誤` },
          )
          .toBe(expectedColumns);
        await expect
          .poll(async () => readColumnCount(page.getByTestId("prompt-mode-group")))
          .toBe(expectedColumns);
        await expect
          .poll(async () => readColumnCount(page.getByTestId("llm-provider-group")))
          .toBe(width < 768 ? 1 : 2);
      });
    }
  }

  test("[P1] 寬視窗維持既有欄數上限", async ({ page }) => {
    // Given: Azure 啟用且以寬視窗首次載入
    await openSettings(page, { azureEnabled: true, width: 1280 });

    // Then: 轉錄／Prompt 為三欄、LLM provider 為兩欄
    await expect
      .poll(async () => readColumnCount(page.getByTestId("whisper-provider-group")))
      .toBe(3);
    await expect
      .poll(async () => readColumnCount(page.getByTestId("prompt-mode-group")))
      .toBe(3);
    await expect
      .poll(async () => readColumnCount(page.getByTestId("llm-provider-group")))
      .toBe(2);
  });

  test("[P1] Foundry 品質最佳 Star 可點選、可 hover 並保留無障礙名稱", async ({
    page,
  }) => {
    // Given: Azure 啟用且目前選取的不是 Foundry
    await openSettings(page, { azureEnabled: true, width: 769 });

    const foundryOption = page.getByTestId("whisper-provider-option-foundry");
    const foundryRadio = page.getByTestId("whisper-provider-radio-foundry");
    const star = page.getByTestId("whisper-provider-foundry-best-quality");
    await expect(foundryRadio).toHaveAttribute("data-state", "unchecked");

    // Then: sr-only 的 bestQuality 文字必須留在 Label 內（radio accessible name 來源）
    const bestQualityText = normalizeText(
      await foundryOption
        .getByTestId("whisper-provider-foundry-best-quality-text")
        .textContent(),
    );
    expect(bestQualityText).not.toBe("settings.model.bestQuality");
    expect(bestQualityText.length).toBeGreaterThan(0);

    const optionText = normalizeText(await foundryOption.textContent());
    const providerName = normalizeText(
      optionText.replace(bestQualityText, ""),
    );
    expect(providerName.length).toBeGreaterThan(0);

    // When: hover Star
    await star.hover();

    // Then: Tooltip 顯示的文字即 bestQuality 文案（與 sr-only 同一個 i18n key）
    const tooltip = page.getByTestId(
      "whisper-provider-foundry-best-quality-tooltip",
    );
    await expect(tooltip).toBeVisible();
    expect(normalizeText(await tooltip.textContent())).toContain(
      bestQualityText,
    );

    // And: Star 使用填色與語意色彩繼承
    const starStyle = await star.locator("svg").evaluate((svg) => {
      const style = window.getComputedStyle(svg);
      return { color: style.color, fill: style.fill };
    });
    expect(starStyle.fill).toBe(starStyle.color);

    // And: bestQuality 與 provider 名稱都留在 radio 的無障礙名稱中
    await expect(foundryRadio).toHaveAccessibleName(
      new RegExp(escapeRegExp(providerName)),
    );
    await expect(foundryRadio).toHaveAccessibleName(
      new RegExp(escapeRegExp(bestQualityText)),
    );

    const writeCountBefore = await getStoreSetCount(page, "whisperProviderId");

    // When: 直接點擊 Star（Tooltip trigger 不得吃掉 Label 的 radio 啟用）
    await star.click();

    // Then: 只觸發一次持久化，且只有 Foundry 被選取
    await expect
      .poll(async () => getStoreSetCount(page, "whisperProviderId"))
      .toBe(writeCountBefore + 1);
    await expect(foundryRadio).toHaveAttribute("data-state", "checked");
    await expect(page.getByTestId("whisper-provider-radio-groq")).toHaveAttribute(
      "data-state",
      "unchecked",
    );
    await expect(
      page.getByTestId("whisper-provider-radio-gemini"),
    ).toHaveAttribute("data-state", "unchecked"    );
  });

  test("[P1] Groq 推薦 Star 可點選、可 hover 並只觸發一次 provider 切換", async ({
    page,
  }) => {
    // Given: 明確從非 Groq provider 起始，否則點已選取的 radio 不會觸發變更
    await openSettings(page, {
      azureEnabled: true,
      llmProviderId: "openai",
      width: 769,
    });

    const groqOption = page.getByTestId("llm-provider-option-groq");
    const groqRadio = page.getByTestId("llm-provider-radio-groq");
    const star = page.getByTestId("llm-provider-recommended-groq");
    const recommendedText =
      PROVIDER_MARKER_TEXT_BY_LOCALE["zh-TW"].recommended;
    await expect(groqRadio).toHaveAttribute("data-state", "unchecked");

    // Then: 推薦 marker 只存在於 Groq，且不是沿用「品質最佳」文案
    await expect(star).toHaveCount(1);
    for (const providerId of ["openai", "anthropic", "gemini", "azure"]) {
      await expect(
        page.getByTestId(`llm-provider-recommended-${providerId}`),
      ).toHaveCount(0);
      await expect(
        page.getByTestId(`llm-provider-radio-${providerId}`),
      ).not.toHaveAccessibleName(new RegExp(escapeRegExp(recommendedText)));
    }
    await expect(
      groqOption.getByTestId("llm-provider-recommended-groq-text"),
    ).toHaveText(recommendedText);
    await expect(groqRadio).toHaveAccessibleName(
      new RegExp(escapeRegExp(recommendedText)),
    );

    // When: hover Star
    await star.hover();

    // Then: Tooltip 顯示「推薦」，而非 Foundry 的「品質最佳」
    const tooltip = page.getByTestId(
      "llm-provider-recommended-groq-tooltip",
    );
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(recommendedText);
    await expect(tooltip).not.toContainText(
      PROVIDER_MARKER_TEXT_BY_LOCALE["zh-TW"].bestQuality,
    );

    const writeCountBefore = await getStoreSetCount(page, "llmProviderId");

    // When: 直接點擊 Star
    await star.click();

    // Then: Label 只觸發一次持久化，Groq 成為唯一選取項目
    await expect
      .poll(async () => getStoreSetCount(page, "llmProviderId"))
      .toBe(writeCountBefore + 1);
    await expect(groqRadio).toHaveAttribute("data-state", "checked");
    await expect(
      page.getByTestId("llm-provider-radio-openai"),
    ).toHaveAttribute("data-state", "unchecked");
  });

  for (const locale of LAYOUT_LOCALE_LIST) {
    test(`[P1] ${locale} 免費 Badge 只顯示於 Groq 與 Gemini`, async ({
      page,
    }) => {
      // Given: Azure 啟用，兩組 provider 選項全部可見
      await openSettings(page, { azureEnabled: true, locale, width: 769 });
      const expectedText = PROVIDER_MARKER_TEXT_BY_LOCALE[locale].free;

      // Then: LLM 與轉錄的 Groq / Gemini 都顯示該語系的免費 Badge
      for (const testId of [
        "llm-provider-free-badge-groq",
        "llm-provider-free-badge-gemini",
        "whisper-provider-free-badge-groq",
        "whisper-provider-free-badge-gemini",
      ]) {
        await expect(page.getByTestId(testId)).toHaveText(expectedText);
      }

      // And: 付費 provider 與 Foundry 不得出現免費 Badge
      for (const testId of [
        "llm-provider-free-badge-openai",
        "llm-provider-free-badge-anthropic",
        "llm-provider-free-badge-azure",
        "whisper-provider-free-badge-foundry",
      ]) {
        await expect(page.getByTestId(testId)).toHaveCount(0);
      }
    });
  }

  test("[P1] Azure 停用時寬視窗維持兩欄且可切換", async ({ page }) => {
    // Given: Azure 停用且寬度已超過 lg 斷點
    await openSettings(page, { azureEnabled: false, width: 1280 });

    // Then: Foundry 選項不存在，轉錄 provider 保持兩欄
    await expect(
      page.getByTestId("whisper-provider-option-foundry"),
    ).toHaveCount(0);
    await expect
      .poll(async () => readColumnCount(page.getByTestId("whisper-provider-group")))
      .toBe(2);
    await expect(page.getByTestId("whisper-provider-option-groq")).toBeVisible();
    await expect(
      page.getByTestId("whisper-provider-option-gemini"),
    ).toBeVisible();

    // When: 切換到 Gemini
    await page.getByTestId("whisper-provider-option-gemini").click();

    // Then: 選取狀態轉移且沒有溢位
    await expect(
      page.getByTestId("whisper-provider-radio-gemini"),
    ).toHaveAttribute("data-state", "checked");
    await expect
      .poll(async () =>
        readOverflowReportList(page.getByTestId("whisper-provider-group")),
      )
      .toEqual([]);
  });
});
