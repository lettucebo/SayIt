import { open } from "@tauri-apps/plugin-shell";
import { extractErrorMessage } from "./errorUtils";
import { captureError } from "./sentry";

export async function openExternalUrl(
  url: string | null | undefined,
): Promise<boolean> {
  if (!url) return false;

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:") {
      console.error(`[external-link] Blocked non-HTTPS URL: ${parsedUrl.protocol}`);
      return false;
    }

    await open(parsedUrl.href);
    return true;
  } catch (error) {
    console.error(
      `[external-link] Failed to open URL: ${extractErrorMessage(error)}`,
    );
    captureError(error, { source: "external-link" });
    return false;
  }
}
