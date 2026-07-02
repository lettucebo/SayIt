import { resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import { version } from "./package.json";

const host = process.env.TAURI_DEV_HOST;
const shouldGenerateSentrySourcemaps =
  process.env.VITE_SENTRY_SOURCEMAPS_ENABLED === "true";
// Bundle analysis is opt-in via `ANALYZE=true pnpm build` (see docs/development-guide.md perf section).
const shouldAnalyzeBundle = process.env.ANALYZE === "true";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    vue(),
    tailwindcss(),
    shouldAnalyzeBundle &&
      visualizer({
        filename: "dist/bundle-stats.html",
        gzipSize: true,
        brotliSize: true,
        template: "treemap",
      }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  build: {
    sourcemap: shouldGenerateSentrySourcemaps,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "main-window": resolve(__dirname, "main-window.html"),
      },
      output: {
        // 明確切分重量級 vendor，讓快取更可預期、避免單一巨型 shared chunk
        // 被兩個 entry 都 preload（perf 稽核 F3）。@sentry/vue 本身已改動態
        // import 而自動獨立成 chunk，這裡另外切出 UI 元件庫與圖表庫。
        // 依「最後一個 node_modules/ 之後的套件名」精確分組，避免 substring 比對誤傷
        // （例如 "/vue/" 會誤中 @sentry/vue、@unovis/vue、@floating-ui/vue）。
        // 亦與平台無關：Rollup/Vite 的 module id 在所有 OS 皆為正斜線。
        manualChunks(id) {
          if (!id.includes("node_modules/")) return undefined;
          const afterNodeModules = id.split("node_modules/").pop() ?? "";
          const segments = afterNodeModules.split("/");
          const packageName = afterNodeModules.startsWith("@")
            ? `${segments[0]}/${segments[1]}`
            : segments[0];

          if (packageName === "reka-ui") return "vendor-reka-ui";
          if (
            packageName === "vue" ||
            packageName === "vue-router" ||
            packageName === "vue-i18n" ||
            packageName === "pinia" ||
            packageName.startsWith("@vue/") ||
            packageName.startsWith("@intlify/")
          ) {
            return "vendor-vue";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
});
