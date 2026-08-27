import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function findVueFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return findVueFiles(path);
    return entry.isFile() && entry.name.endsWith(".vue") ? [path] : [];
  });
}

describe("外部連結政策", () => {
  it("[P1] Vue 元件不應繞過 ExternalLink 使用外部 anchor", () => {
    const componentPath = resolve(
      process.cwd(),
      "src/components/ExternalLink.vue",
    );
    const vueFiles = findVueFiles(resolve(process.cwd(), "src")).filter(
      (path) => path !== componentPath,
    );

    for (const path of vueFiles) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(
        /<a\b[^>]*target\s*=\s*["']_blank["']/s,
      );
      expect(source, path).not.toMatch(
        /<a\b[^>]*href\s*=\s*["']https?:\/\//s,
      );
    }
  });
});
