import { mkdir, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  buildTutorialCapturePlan,
  dashboardChartSettledInDocument,
  installTauriScreenshotMock,
} from "./tauriScreenshotMock.mjs";

const BASE_URL = process.env.SAYIT_SCREENSHOT_BASE_URL ?? "http://localhost:1420";
const CHROMIUM_EXECUTABLE =
  process.env.SAYIT_SCREENSHOT_CHROMIUM_EXECUTABLE || undefined;
const VIEWPORT = { width: 1280, height: 900 };
const LOCALE_LIST = ["zh-TW", "en"];
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function findSettingsCard(page, title) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
}

async function waitForRouteContent(page, shot) {
  switch (shot.id) {
    case "dashboard":
      await page
        .getByText(shot.readyText, { exact: true })
        .first()
        .waitFor({ state: "visible" });
      await page.locator(shot.chartSelector).waitFor({ state: "visible" });
      await page.waitForFunction(dashboardChartSettledInDocument, {
        chartSelector: shot.chartSelector,
        pathSelector: shot.chartPathSelector,
      });
      break;
    case "history":
      await page.getByTestId(shot.readyTestId).first().waitFor({
        state: "visible",
      });
      break;
    case "dictionary":
      await page.getByTestId("vocab-term").first().waitFor({
        state: "visible",
      });
      break;
    case "feature-guide":
      await page.getByTestId("whats-new").waitFor({ state: "visible" });
      break;
    default: {
      const titleList = shot.cardTitles ?? [shot.cardTitle];
      for (const title of titleList.filter(Boolean)) {
        await findSettingsCard(page, title).waitFor({ state: "visible" });
      }
    }
  }
}

async function captureSettingsShot(page, shot) {
  const titleList = shot.cardTitles ?? [shot.cardTitle];
  const firstCard = findSettingsCard(page, titleList[0]);

  if (shot.id === "settings-provider-api-key") {
    await firstCard
      .getByRole("button", { name: shot.revealApiKeyText, exact: true })
      .click();
    const apiKeyInput = firstCard.locator("input").first();
    if ((await apiKeyInput.inputValue()) !== "gsk_••••••••") {
      throw new Error("Tutorial API key was not rendered as the safe fake value");
    }
    await firstCard.scrollIntoViewIfNeeded();
    await firstCard.screenshot({
      path: shot.outputPath,
      type: "png",
      animations: "disabled",
    });
    return;
  }

  await firstCard.scrollIntoViewIfNeeded();
  await firstCard.screenshot({
    path: shot.outputPath,
    type: "png",
    animations: "disabled",
  });
}

async function captureFeatureGuideShot(page, shot) {
  const firstCard = page.getByTestId(shot.rangeStartTestId);
  const container = firstCard.locator("xpath=..");
  const lastCard = container
    .locator('[data-slot="card"]')
    .nth(shot.rangeEndCardIndex);

  await firstCard.evaluate((element) => {
    element.scrollIntoView({ block: "start" });
  });
  await lastCard.waitFor({ state: "visible" });

  const [containerBox, firstCardBox, lastCardBox] = await Promise.all([
    container.boundingBox(),
    firstCard.boundingBox(),
    lastCard.boundingBox(),
  ]);
  if (!containerBox || !firstCardBox || !lastCardBox) {
    throw new Error("Feature Guide capture range has no bounding box");
  }

  const clip = {
    x: Math.floor(containerBox.x),
    y: Math.floor(firstCardBox.y),
    width: Math.ceil(containerBox.width),
    height: Math.ceil(lastCardBox.y + lastCardBox.height - firstCardBox.y),
  };
  const viewport = page.viewportSize();
  if (
    !viewport ||
    clip.x < 0 ||
    clip.y < 0 ||
    clip.x + clip.width > viewport.width ||
    clip.y + clip.height > viewport.height
  ) {
    throw new Error(
      `Feature Guide clip exceeds viewport: ${JSON.stringify(clip)}`,
    );
  }

  await page.screenshot({
    path: shot.outputPath,
    type: "png",
    animations: "disabled",
    clip,
  });
}

async function captureHudShot(page, shot) {
  await page.waitForFunction(
    () =>
      window.__SAYIT_SCREENSHOT_TAURI_MOCK__?.listenerCount(
        "hotkey:mode-toggle",
      ) > 0,
  );
  await page.evaluate((event) => {
    window.__SAYIT_SCREENSHOT_TAURI_MOCK__.emit(event);
  }, shot.event);

  await page.getByText(shot.label, { exact: true }).waitFor({
    state: "visible",
  });
  await page.waitForFunction(
    ({ elementSelector, expectedWidth, expectedHeight, label }) => {
      const element = document.querySelector(elementSelector);
      if (!element || !element.textContent?.includes(label)) return false;
      const bounds = element.getBoundingClientRect();
      return (
        Math.abs(bounds.width - expectedWidth) < 0.5 &&
        Math.abs(bounds.height - expectedHeight) < 0.5
      );
    },
    {
      elementSelector: shot.elementSelector,
      expectedWidth: shot.expectedWidth,
      expectedHeight: shot.expectedHeight,
      label: shot.label,
    },
  );

  const hud = page.locator(shot.elementSelector);
  await hud.screenshot({
    path: shot.outputPath,
    type: "png",
    animations: "disabled",
  });
}

async function captureShot(browser, shot) {
  const colorScheme = shot.colorScheme ?? "light";
  const context = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme,
    locale: shot.locale === "zh-TW" ? "zh-TW" : "en-US",
    timezoneId: shot.timezoneId,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const pageErrorList = [];
  page.on("pageerror", (error) => {
    pageErrorList.push(error);
  });

  const mockOptions = {
    selectedLocale: shot.locale,
    windowLabel: shot.windowLabel,
    fixedNowIso: shot.fixedNowIso,
    timezoneId: shot.timezoneId,
    colorScheme,
    storeValues: {
      themeMode: colorScheme,
    },
  };
  await installTauriScreenshotMock(page, mockOptions);
  await page.goto(new URL(shot.url, BASE_URL).toString(), {
    waitUntil: "domcontentloaded",
  });
  await page.emulateMedia({
    colorScheme,
    reducedMotion: "reduce",
  });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
      html {
        color-scheme: ${colorScheme} !important;
        scrollbar-width: none;
      }
      ::-webkit-scrollbar {
        display: none;
      }
    `,
  });

  if (shot.windowLabel === "main") {
    await captureHudShot(page, shot);
  } else {
    await waitForRouteContent(page, shot);
    if (shot.id.startsWith("settings-")) {
      await captureSettingsShot(page, shot);
    } else if (shot.id === "feature-guide") {
      await captureFeatureGuideShot(page, shot);
    } else {
      await page.screenshot({
        path: shot.outputPath,
        type: "png",
        animations: "disabled",
      });
    }
  }

  if (pageErrorList.length > 0) {
    throw new AggregateError(
      pageErrorList,
      `${shot.id} raised ${pageErrorList.length} page error(s)`,
    );
  }

  const outputStats = await stat(shot.outputPath);
  if (outputStats.size === 0) {
    throw new Error(`Screenshot is empty: ${shot.outputPath}`);
  }

  await context.close();
  return {
    id: shot.id,
    path: shot.outputPath,
    bytes: outputStats.size,
  };
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_EXECUTABLE,
  });
  const resultList = [];

  try {
    for (const locale of LOCALE_LIST) {
      const outputDirectory = path.join(
        REPO_ROOT,
        "docs",
        "tutorials",
        locale,
        "images",
      );
      await mkdir(outputDirectory, { recursive: true });
      await rm(path.join(outputDirectory, "hud-idle.png"), { force: true });

      for (const shot of buildTutorialCapturePlan(locale, outputDirectory)) {
        const result = await captureShot(browser, shot);
        resultList.push(result);
        console.log(
          `[capture] ${locale}/${result.id}: ${result.bytes} bytes -> ${result.path}`,
        );
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`[capture] completed ${resultList.length} screenshots`);
}

main().catch((error) => {
  console.error("[capture] failed", error);
  process.exitCode = 1;
});
