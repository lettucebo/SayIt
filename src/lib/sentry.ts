/// <reference types="vite/client" />
import * as Sentry from "@sentry/vue";
import type { App } from "vue";
import type { Router } from "vue-router";
import {
  isValidSentryDsn,
  scrubBreadcrumb,
  scrubEvent,
} from "./sentryScrubbing";

declare const __APP_VERSION__: string;

function getSentryDsn(): string {
  return import.meta.env.VITE_SENTRY_DSN?.trim() ?? "";
}

function getSentryEnvironment(): string {
  return import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || import.meta.env.MODE;
}

function getSentryRelease(): string {
  return import.meta.env.VITE_SENTRY_RELEASE?.trim() || `sayit@${__APP_VERSION__}`;
}

function getTracesSampleRate(): number {
  const rawValue = import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE?.trim();
  if (!rawValue) return 0;

  const rate = Number(rawValue);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

function isSentryEnabled(): boolean {
  return import.meta.env.PROD && isValidSentryDsn(getSentryDsn());
}

export function initSentryForHud(app: App): void {
  if (!isSentryEnabled()) return;

  Sentry.init({
    app,
    dsn: getSentryDsn(),
    environment: getSentryEnvironment(),
    release: getSentryRelease(),
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    integrations: [],
    initialScope: {
      tags: { window: "hud" },
    },
  });
}

export function initSentryForDashboard(app: App, router: Router): void {
  if (!isSentryEnabled()) return;

  const tracesSampleRate = getTracesSampleRate();

  Sentry.init({
    app,
    dsn: getSentryDsn(),
    environment: getSentryEnvironment(),
    release: getSentryRelease(),
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    integrations:
      tracesSampleRate > 0 ? [Sentry.browserTracingIntegration({ router })] : [],
    ...(tracesSampleRate > 0 ? { tracesSampleRate } : {}),
    initialScope: {
      tags: { window: "dashboard" },
    },
  });
}

export function captureError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!isSentryEnabled()) return;

  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureException(error);
    });
    return;
  }

  Sentry.captureException(error);
}
