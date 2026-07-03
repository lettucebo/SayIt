import { createRouter, createWebHashHistory } from "vue-router";
import { trackEvent } from "./lib/analytics";

// Route-level code splitting: each view becomes its own chunk instead of being
// bundled eagerly into the Dashboard entry (see perf audit F2).
const DashboardView = () => import("./views/DashboardView.vue");
const HistoryView = () => import("./views/HistoryView.vue");
const DictionaryView = () => import("./views/DictionaryView.vue");
const SettingsView = () => import("./views/SettingsView.vue");
const FeatureGuideView = () => import("./views/FeatureGuideView.vue");

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/dashboard" },
    { path: "/dashboard", component: DashboardView },
    { path: "/history", component: HistoryView },
    { path: "/dictionary", component: DictionaryView },
    { path: "/settings", component: SettingsView },
    { path: "/guide", component: FeatureGuideView },
  ],
});

router.afterEach((to) => {
  // 匿名分頁瀏覽（僅路由名稱，不含任何內容）
  trackEvent("screen_view", { name: to.path.replace(/^\//, "") || "dashboard" });
});

export default router;
