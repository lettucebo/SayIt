---
title: SayIt UI 設計規範
description: 給 AI Agent 的前端 UI/UX 設計規則集
author: Jackle
date: 2026-03-02
---

# SayIt UI 設計規範

本文件定義 SayIt 桌面應用的 UI/UX 設計規則。所有 AI Agent 在生成或修改前端程式碼時**必須**遵守這些規則。

## 遷移狀態

本規範描述的是**目標狀態**。以下列出當前與目標之間的差距：

**尚未完成的基礎設定：**

- Teal 品牌主題未套用 — 需執行 `pnpm dlx shadcn-vue@latest init --theme teal` 覆寫 CSS 變數
- Dark mode 未啟用 — `main-window.html` 和 `index.html` 的 `<html>` 標籤需加上 `class="dark"`
- `src/components/ui/` 目錄不存在 — 尚未安裝任何 shadcn-vue 元件
- `--destructive-foreground` 和狀態色（success/warning/info）CSS 變數未定義

**現有程式碼的違規項目：**

- `MainApp.vue`：使用 Emoji 圖標、硬編碼 `bg-zinc-950`/`text-white`/`border-zinc-800`
- `SettingsView.vue`：使用 `window.confirm()`、硬編碼色彩、`lg:` 響應式斷點、裸 HTML input/button
- 其他 View 頁面：使用 `text-white`/`text-zinc-400` 等原生色彩

**規則適用範圍：**

- **所有新開發的元件和頁面**：必須完全遵守本規範
- **修改現有元件時**：順手將接觸到的區域遷移至本規範
- **不主動大規模重構**：除非 Story 明確要求

## 設計稿審核流程（強制）

任何 UI 實作前，**必須**先在設計稿中完成視覺設計並取得使用者確認。

**設計稿檔案：** `/Users/jackle/workspace/say-it/design.pen`

**流程：**

1. **設計先行**：收到 UI 相關 Story 或任務時，先在 `design.pen` 中建立對應頁面/元件的設計稿
2. **遵循本規範**：設計稿必須使用本文件定義的色彩系統、元件、間距、排版規則
3. **截圖呈現**：完成設計稿後，截取畫面呈現給使用者審查
4. **等待確認**：使用者確認設計稿後，才可進入程式碼實作階段
5. **設計變更同步**：若實作過程中需調整設計，先更新 `design.pen` 並再次確認

**禁止行為：**

- 未經設計稿確認就直接寫 UI 程式碼
- 實作與已確認的設計稿不一致
- 跳過設計稿流程（即使是「小調整」）

## 設計系統基礎

### 元件框架：shadcn-vue（強制）

- **所有 UI 元件必須使用 shadcn-vue**，禁止手寫替代品
- 安裝指令：`npx shadcn-vue@latest add <component>`
- 元件使用前必須先用 CLI 安裝，安裝後才會出現在 `src/components/ui/`
- 設定風格：`new-york`
- 基底色：`neutral`
- 圖標庫：`lucide`（`components.json` 中的值，實際 npm 套件為 `lucide-vue-next`）
- 元件安裝目錄：`src/components/ui/`
- 工具函式：`cn()` 來自 `@/lib/utils`（clsx + tailwind-merge）
- 動畫庫：`tw-animate-css`（已安裝，shadcn-vue 元件的展開/收合動畫依賴此庫）

### cn() 使用方式

在使用端合併或覆蓋 shadcn-vue 元件的樣式：

```vue
<script setup lang="ts">
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const props = defineProps<{ fullWidth?: boolean }>()
</script>

<template>
  <Button :class="cn('gap-2', fullWidth && 'w-full')">
    <slot />
  </Button>
</template>
```

### 例外區域（允許手寫 CSS）

以下元件不適用 shadcn-vue 改造，允許保留手寫樣式：

- `NotchHud.vue` — Notch clip-path 動畫引擎
- `App.vue` — Notch 啟動序列動畫

## 色彩系統

### 品牌色：Teal

品牌主題透過 `pnpm dlx shadcn-vue@latest init --theme teal` 設定（**待執行**，當前 `style.css` 仍為 neutral 預設值）。執行後 Teal 主題會覆蓋 `--primary` 系列變數為以下值：

**Light mode：**

| 變數 | Tailwind 色階 | oklch 值 |
|------|-------------|---------|
| `--primary` | teal-600 | `oklch(0.6 0.118 184.704)` |
| `--primary-foreground` | teal-50 | `oklch(0.984 0.014 180.72)` |
| `--sidebar-primary` | teal-600 | `oklch(0.6 0.118 184.704)` |
| `--sidebar-ring` | teal-400 | `oklch(0.777 0.152 181.912)` |

**Dark mode：**

| 變數 | Tailwind 色階 | oklch 值 |
|------|-------------|---------|
| `--primary` | teal-500 | `oklch(0.704 0.14 182.503)` |
| `--primary-foreground` | teal-50 | `oklch(0.984 0.014 180.72)` |
| `--sidebar-primary` | teal-500 | `oklch(0.704 0.14 182.503)` |
| `--sidebar-ring` | teal-900 | `oklch(0.386 0.063 188.416)` |

### 規則：只用語意色彩變數

**禁止**直接使用 Tailwind 原生色彩（如 `zinc-800`、`teal-600`、`red-500`）。
**必須**使用 shadcn-vue 定義的語意色彩變數。

| 用途 | 正確 | 禁止 |
|------|------|------|
| 頁面背景 | `bg-background` | `bg-zinc-950` |
| 主要文字 | `text-foreground` | `text-white` |
| 次要文字 | `text-muted-foreground` | `text-zinc-400` |
| 卡片背景 | `bg-card` | `bg-zinc-900` |
| 卡片文字 | `text-card-foreground` | `text-zinc-100` |
| 邊框 | `border-border` | `border-zinc-700` |
| 主要操作（teal） | `bg-primary` | `bg-teal-600` |
| 主要操作文字 | `text-primary-foreground` | `text-white` |
| 次要操作 | `bg-secondary` | `bg-zinc-700` |
| 次要操作文字 | `text-secondary-foreground` | `text-zinc-200` |
| 危險操作 | `bg-destructive` | `bg-red-500` |
| 表單輸入邊框 | `border-input` | `border-zinc-600` |
| 懸浮/選取 | `bg-accent` | `bg-zinc-800` |
| 聚焦外框 | `ring-ring` | `ring-teal-500` |
| 下拉選單背景 | `bg-popover` | `bg-zinc-900` |
| 下拉選單文字 | `text-popover-foreground` | `text-white` |

### 狀態色

在 `src/style.css` 中新增以下自訂語意色彩變數，用於業務狀態指示：

```css
/* 在 :root 中加入 */
--success: oklch(0.59 0.145 163.225);
--success-foreground: oklch(0.985 0 0);
--warning: oklch(0.75 0.183 55.934);
--warning-foreground: oklch(0.205 0 0);
--info: oklch(0.623 0.214 259.815);
--info-foreground: oklch(0.985 0 0);

/* 在 .dark 中加入 */
--success: oklch(0.696 0.17 162.48);
--success-foreground: oklch(0.145 0 0);
--warning: oklch(0.828 0.189 84.429);
--warning-foreground: oklch(0.145 0 0);
--info: oklch(0.623 0.214 259.815);
--info-foreground: oklch(0.985 0 0);
```

在 `@theme inline` 中加入對應映射：

```css
--color-success: var(--success);
--color-success-foreground: var(--success-foreground);
--color-warning: var(--warning);
--color-warning-foreground: var(--warning-foreground);
--color-info: var(--info);
--color-info-foreground: var(--info-foreground);
```

**狀態色使用場景：**

| 狀態 | class 範例 | 使用場景 |
|------|-----------|---------|
| Success | `bg-success text-success-foreground` | API Key 驗證成功、轉錄完成 Badge |
| Warning | `bg-warning text-warning-foreground` | API 逾時降級通知 |
| Info | `bg-info text-info-foreground` | 提示訊息、使用指引 |
| Destructive | `bg-destructive` | 刪除確認、錯誤狀態（已內建） |

### 注意：缺失的 CSS 變數

`src/style.css` 目前**未定義** `--destructive-foreground`。安裝 shadcn-vue 的 `button` 元件（destructive variant）前，先補上此變數：

```css
/* 在 :root 中加入 */
--destructive-foreground: oklch(0.985 0 0);

/* 在 .dark 中加入 */
--destructive-foreground: oklch(0.985 0 0);
```

並在 `@theme inline` 中加入：

```css
--color-destructive-foreground: var(--destructive-foreground);
```

### 主題模式

- 本應用預設 **dark mode**（桌面常駐 App）
- Dark mode 透過在根元素加上 `class="dark"` 啟用，目前在 `main-window.html` 和 `index.html` 的 `<html>` 標籤設定
- 所有色彩變數在 `src/style.css` 的 `:root`（light）和 `.dark`（dark）中定義
- 色彩空間：oklch（已設定，AI Agent 不變更此設定）

### 圖表配色

Dashboard 圖表使用 teal 品牌色階（由 `--theme teal` 自動設定，**待執行**後生效）：

| 變數 | Tailwind 色階 | 用途 |
|------|-------------|------|
| `chart-1` | teal-300 | 主要資料線/面積 |
| `chart-2` | teal-500 | 次要資料線 |
| `chart-3` | teal-600 | 第三資料系列 |
| `chart-4` | teal-700 | 第四資料系列 |
| `chart-5` | teal-800 | 第五資料系列 |

## 元件使用規則

### 安裝即用原則

需要新元件時，先用 CLI 安裝。常用元件參考清單：

```bash
npx shadcn-vue@latest add button
npx shadcn-vue@latest add input
npx shadcn-vue@latest add card
npx shadcn-vue@latest add dialog
npx shadcn-vue@latest add select
npx shadcn-vue@latest add switch
npx shadcn-vue@latest add badge
npx shadcn-vue@latest add table
npx shadcn-vue@latest add tooltip
npx shadcn-vue@latest add separator
npx shadcn-vue@latest add scroll-area
npx shadcn-vue@latest add dropdown-menu
```

### 元件導入格式

```vue
<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
</script>
```

### Button 變體使用場景

| 場景 | variant | 範例 |
|------|---------|------|
| 主要操作 | `default` | 儲存設定、確認 |
| 危險操作 | `destructive` | 刪除詞彙、清除歷史 |
| 次要操作 | `outline` | 取消、返回 |
| 不顯眼操作 | `ghost` | 工具列按鈕、導航項 |
| 連結式 | `link` | 外部連結 |
| 純圖標 | size `icon` | Sidebar 收合、複製 |

### 表單模式

使用 shadcn-vue 的 label + input 組合搭配手動結構化佈局：

```vue
<script setup lang="ts">
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
</script>

<template>
  <div class="space-y-2">
    <Label for="api-key">Groq API Key</Label>
    <Input id="api-key" type="password" placeholder="gsk_..." />
    <p class="text-xs text-muted-foreground">從 Groq Console 取得你的 API Key</p>
  </div>
</template>
```

安裝所需元件：

```bash
npx shadcn-vue@latest add label
npx shadcn-vue@latest add input
```

### 卡片模式（Dashboard 統計卡片）

```vue
<Card>
  <CardHeader class="pb-2">
    <CardTitle class="text-sm font-medium text-muted-foreground">
      總口述時間
    </CardTitle>
  </CardHeader>
  <CardContent>
    <div class="text-2xl font-bold">42 分鐘</div>
  </CardContent>
</Card>
```

### 操作回饋：Toast

所有使用者操作的成功/失敗回饋統一使用 `Sonner`（shadcn-vue 推薦的 Toast 方案）：

```bash
npx shadcn-vue@latest add sonner
```

```vue
<script setup lang="ts">
import { toast } from 'vue-sonner'

function handleSave() {
  // ...
  toast.success('API Key 已儲存')
}
</script>
```

使用場景：儲存設定、複製文字、刪除詞彙、API Key 操作。不再使用內嵌 `feedbackMessage` 模式。

### 載入狀態：Skeleton

資料載入中使用 `Skeleton` 元件佔位：

```bash
npx shadcn-vue@latest add skeleton
```

適用位置：Dashboard 統計卡片、History 記錄列表、Dictionary 詞彙表格。

## 圖標系統

### 規則：只用 lucide-vue-next

```vue
<script setup lang="ts">
import { Mic, Settings, History, BookOpen, LayoutDashboard } from 'lucide-vue-next'
</script>

<template>
  <Mic class="size-4" />           <!-- 標準大小 -->
  <Settings class="size-5" />      <!-- Sidebar 大小 -->
</template>
```

**圖標大小標準：**

| 位置 | class | 像素 |
|------|-------|------|
| 內文/按鈕 | `size-4` | 16px |
| Sidebar 導航 | `size-5` | 20px |
| 空狀態插圖 | `size-12` | 48px |
| 頁面標題 | `size-6` | 24px |

**禁止**使用 Emoji 作為 UI 圖標（Notch HUD 啟動動畫中的 `🎙` 是唯一例外）。

**Sidebar 導航圖標對應：**

| 路由 | 圖標元件 |
|------|---------|
| `/dashboard` | `LayoutDashboard` |
| `/history` | `History` |
| `/dictionary` | `BookOpen` |
| `/settings` | `Settings` |

## 排版

### 字型

系統預設字型堆疊，不自訂 font-family（Tauri WebView 跟隨 OS）。

### 字級標準

| 用途 | class |
|------|-------|
| 頁面標題 | `text-2xl font-bold` |
| 區塊標題 | `text-lg font-semibold` |
| 卡片標題 | `text-sm font-medium text-muted-foreground` |
| 卡片數值 | `text-2xl font-bold` |
| 正文 | `text-sm` |
| 輔助說明 | `text-xs text-muted-foreground` |
| 標籤 | `text-sm font-medium` |

## 間距與佈局

### 間距標準

| 場景 | class |
|------|-------|
| 頁面內距 | `p-6` |
| 區塊間距 | `space-y-6` |
| 卡片內距 | 由 shadcn Card 預設處理 |
| 表單欄位間距 | `space-y-4` |
| 按鈕組間距 | `gap-2` |
| Sidebar 項目間距 | `gap-1` |

### 頁面佈局結構

所有 View 頁面遵循統一結構：

```vue
<template>
  <div class="flex-1 space-y-6 p-6">
    <!-- 頁面標題 -->
    <div>
      <h1 class="text-2xl font-bold">頁面標題</h1>
      <p class="text-sm text-muted-foreground">頁面描述</p>
    </div>

    <!-- 內容區塊 -->
    <section class="space-y-4">
      ...
    </section>
  </div>
</template>
```

### Sidebar 佈局

MainApp.vue 使用固定 Sidebar + 動態內容區：

```
+----------+---------------------------+
|          |                           |
| Sidebar  |    <RouterView />         |
| w-56     |    flex-1                 |
|          |                           |
+----------+---------------------------+
```

- Sidebar 寬度：`w-56`（224px）
- 背景：`bg-sidebar`
- 邊框：`border-r border-sidebar-border`
- 導航項文字：`text-sidebar-foreground`
- 活動項：`bg-sidebar-accent text-sidebar-accent-foreground`

## 動畫與過渡

### 標準過渡

```css
/* 互動元素（按鈕、連結、輸入框） */
transition-colors          /* 色彩變化 */

/* 內容出現/消失 */
transition: opacity 180ms ease;

/* 佈局變化 */
transition: all 200ms ease-out;
```

shadcn-vue 元件（Accordion、Collapsible 等）的展開/收合動畫由 `tw-animate-css` 庫提供，已在 `src/style.css` 中引入，不需額外設定。

### Notch 動畫（僅限 HUD）

Notch 系統使用自訂 cubic-bezier 曲線，這些數值已調校完成，AI Agent 不修改：

```
cubic-bezier(0.32, 0.72, 0, 1)     /* Notch 形狀過渡 */
cubic-bezier(0.34, 1.56, 0.64, 1)  /* Notch 進入彈跳 */
```

**HUD 視覺狀態摘要（Visual Redesign 後）：**

| 狀態 | 視覺 | 說明 |
|------|------|------|
| recording | 6 根 bar 山丘形排列 + 計時器 | bin `[9,4,1,2,6,12]`，中間高兩側低 |
| transcribing | 5 個空心圓點依序亮起變實心 | dotSlide 週期 1.5s，掃描波浪效果 |
| success | 圓點匯聚 + SVG ✓ + 邊緣綠光 | 無底色 flash，背景保持純黑 |
| error | 圓點散開 + 抖動 + ↻ retry | 無底色 flash，背景保持純黑 |
| collapsing | 尺寸縮小 200×32 + 內容淡出 | 過渡回 hidden |

### Vue Transition 命名

```vue
<!-- 淡入淡出 -->
<Transition name="fade">...</Transition>
```

```css
.fade-enter-active,
.fade-leave-active { transition: opacity 180ms ease; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
```

## 無障礙（Accessibility）

### 強制規則

- shadcn-vue 元件已內建 ARIA 屬性，不要移除或覆蓋
- 所有互動元素必須可用鍵盤操作
- Dialog 必須有焦點陷阱（shadcn Dialog 已內建）
- 表單欄位必須關聯 `<label>`（使用 shadcn Label 元件）
- 圖標按鈕必須加 `aria-label` 或搭配 `sr-only` 文字

```vue
<!-- 正確：圖標按鈕帶無障礙標籤 -->
<Button variant="ghost" size="icon" aria-label="複製文字">
  <Copy class="size-4" />
</Button>
```

## 響應式設計

本應用為**固定尺寸桌面視窗**，不需要行動端響應式設計。

- Main Window：最小寬度 `800px`、最小高度 `600px`
- HUD Window：固定尺寸，由 Notch 引擎控制
- 不使用 `sm:`、`md:`、`lg:` 等響應式斷點

## 元件檔案組織

```
src/components/
├── ui/                     # shadcn-vue 元件（CLI 安裝生成，不手動修改）
│   ├── button/
│   ├── card/
│   ├── input/
│   └── ...
├── NotchHud.vue            # Notch HUD 狀態顯示（手寫例外）
├── AccessibilityGuide.vue  # macOS 權限引導（遷移時改用 shadcn Dialog）
└── [功能元件].vue           # 業務元件，使用 shadcn-vue 原子元件組合
```

### 規則

- `src/components/ui/` 內的檔案由 shadcn CLI 生成，**不手動修改**
- 業務元件放在 `src/components/` 根目錄或按功能建子目錄
- 每個 `.vue` 檔案使用 `<script setup lang="ts">` + Composition API
- Props 使用 TypeScript interface 定義

## 禁止事項清單

| 禁止 | 替代方案 |
|------|---------|
| 直接用 `zinc-*`、`blue-*` 等原生色彩 | 使用語意變數 `bg-primary`、`text-foreground` |
| 手寫 Button/Input/Card/Dialog | 安裝 shadcn-vue 元件 |
| 使用 Emoji 作為 UI 圖標 | 使用 lucide-vue-next |
| 在 `ui/` 目錄手動修改元件 | 透過 `cn()` 在使用端覆蓋樣式 |
| 使用 `px` 硬編碼尺寸 | 使用 Tailwind spacing（`p-4`、`gap-2`） |
| 使用響應式斷點 `sm:`/`md:`/`lg:` | 固定桌面佈局 |
| Options API | Composition API + `<script setup>` |
| 裸 `<input>`/`<button>` HTML 元素 | shadcn `<Input />`、`<Button />` |
| `<style scoped>` 定義色彩或背景 | Tailwind utility class + 語意變數 |
| 直接在元件中 hardcode Tailwind 色彩變數值 | 引用 CSS 變數名稱 |

## 頁面佈局規範

本節定義各頁面的具體佈局結構。所有頁面共用 `MainApp.vue` 的 Sidebar + 內容區框架。

### 全域框架：MainApp.vue

使用 shadcn-vue 的 `SidebarProvider` + `SidebarInset` 模式取代目前的手寫 Sidebar：

```
+--[SidebarProvider]-----------------------------------+
|                                                       |
| +--[Sidebar]--+ +--[SidebarInset]------------------+ |
| |  SayIt Logo | | +--[header]--------------------+ | |
| |  "SayIt"    | | | SidebarTrigger  Breadcrumb    | | |
| |             | | +-------------------------------+ | |
| |  Dashboard  | | |                               | | |
| |  歷史記錄   | | |    <RouterView />             | | |
| |  自訂字典   | | |    (flex-1 space-y-6 p-6)     | | |
| |  設定       | | |                               | | |
| |             | | |                               | | |
| |  v0.1.0    | | |                               | | |
| +-------------+ +----------------------------------+ |
+-------------------------------------------------------+
```

**安裝指令：**

```bash
npx shadcn-vue@latest add sidebar
```

**關鍵元件：**

| 元件 | 用途 |
|------|------|
| `SidebarProvider` | 包裹整個應用，管理收合狀態 |
| `Sidebar` | 側邊欄容器，含 `SidebarHeader` / `SidebarContent` / `SidebarFooter` |
| `SidebarFooter` | 側邊欄底部，顯示版本號（透過 Vite `__APP_VERSION__` 從 `package.json` 動態注入） |
| `SidebarMenu` + `SidebarMenuItem` + `SidebarMenuButton` | 導航項目 |
| `SidebarInset` | 主要內容區域 |
| `SidebarTrigger` | 收合/展開按鈕 |

**收合狀態：** Sidebar 收合後顯示 icon-only 模式（寬度約 48px），僅顯示導航圖標。SidebarProvider 的 `collapsible="icon"` 屬性控制。

**Sidebar 導航項定義：**

```ts
const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/history', label: '歷史記錄', icon: History },
  { path: '/dictionary', label: '自訂字典', icon: BookOpen },
  { path: '/settings', label: '設定', icon: Settings },
]
```

### Dashboard 頁面（`/dashboard`）

參考 shadcn-vue `dashboard-01` block 佈局。

**安裝 block（可取得完整範例程式碼）：**

```bash
npx shadcn-vue@latest add dashboard-01
```

**佈局結構：**

```
+--[頁面容器 flex-1 space-y-6 p-6]---------------------+
|                                                        |
| +--[標題區]----------------------------------------+  |
| | "Dashboard"                text-2xl font-bold     |  |
| | "語音轉文字統計總覽"       text-muted-foreground  |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[統計卡片 grid grid-cols-2 gap-4]-----------------+  |
| | +--Card------+ +--Card------+                      |  |
| | |總口述時間  | |口述字數    |                      |  |
| | |42 分鐘     | |12,350字    |                      |  |
| | +------------+ +------------+                      |  |
| | +--Card------+ +--Card------+                      |  |
| | |平均口述速度| |節省時間    |                      |  |
| | |185字/分    | |28 分鐘     |                      |  |
| | +------------+ +------------+                      |  |
| | +--Card------+ +--Card------+                      |  |
| | |使用次數    | |AI整理使用率|                      |  |
| | |156 次      | |87%         |                      |  |
| | +------------+ +------------+                      |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[趨勢圖表 Card]----------------------------------+  |
| | CardHeader: "使用趨勢"  [時間篩選 Select]         |  |
| | CardContent:                                       |  |
| |   Area Chart（每日口述次數 / 字數趨勢）            |  |
| |   X 軸：日期   Y 軸：次數或字數                    |  |
| |   使用 chart-1 (teal-300) 作為主要面積色           |  |
| +---------------------------------------------------+  |
+--------------------------------------------------------+
```

**統計卡片元件模式：**

每張 Card 遵循統一結構：

```vue
<Card>
  <CardHeader class="flex flex-row items-center justify-between pb-2">
    <CardTitle class="text-sm font-medium text-muted-foreground">
      總口述時間
    </CardTitle>
    <Badge variant="outline" class="text-xs">
      <TrendingUp class="mr-1 size-3" />
      +12%
    </Badge>
  </CardHeader>
  <CardContent>
    <div class="text-2xl font-bold">42 分鐘</div>
    <p class="text-xs text-muted-foreground">較上週增加 5 分鐘</p>
  </CardContent>
</Card>
```

**六項統計指標（對應 PRD FR24）：**

| 指標 | 卡片標題 | 數值格式 | 圖標 |
|------|---------|---------|------|
| 總口述時間 | 總口述時間 | `X 分鐘` 或 `X 小時 Y 分` | `Timer` |
| 口述字數 | 口述字數 | `12,350 字`（千位分隔） | `Type` |
| 平均口述速度 | 平均口述速度 | `185 字/分` | `Gauge` |
| 節省時間 | 節省時間 | `X 分鐘`（預估打字所需時間 - 口述時間） | `Clock` |
| 使用次數 | 使用次數 | `156 次` | `Mic` |
| AI 整理使用率 | AI 整理使用率 | `87%` | `Sparkles` |

**趨勢圖表技術選型：**

使用 shadcn-vue 的 Chart 元件（底層為 [Unovis](https://unovis.dev/)）。安裝：

```bash
npx shadcn-vue@latest add chart-area
```

**Dashboard 空狀態：** 當歷史記錄為零時，統計卡片顯示 `0`/`0%`/`0 分鐘`，趨勢圖表區域顯示空狀態插圖（`BarChart3` icon `size-12` + 「開始使用語音輸入以累積統計資料」）。

### History 頁面（`/history`）

```
+--[頁面容器 flex-1 space-y-6 p-6]---------------------+
|                                                        |
| +--[標題區 + 搜尋]----------------------------------+  |
| | "歷史記錄"             text-2xl font-bold          |  |
| | "瀏覽與搜尋轉錄歷史"   text-muted-foreground       |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[工具列 flex items-center gap-2]-----------------+  |
| | [Search Input w/ icon]              [排序 Select]  |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[記錄列表 space-y-3]---------scroll-area----------+  |
| | +--Card (hover:bg-accent)---------------------+    |  |
| | | 2026-03-02 14:32     Badge:"AI整理"          |    |  |
| | | "會議記錄：今天下午討論了新功能的..."         |    |  |
| | | text-xs: 原始 52字 → 整理後 48字  耗時 1.2s  |    |  |
| | | [複製原始] [複製整理後] 按鈕靠右 ghost        |    |  |
| | +----------------------------------------------+    |  |
| |                                                     |  |
| | +--Card------------------------------------------+  |  |
| | | ...下一筆記錄...                                |  |  |
| | +------------------------------------------------+  |  |
| |                                                     |  |
| +-----------------------------------------------------+  |
|                                                        |
| +--[分頁 flex justify-center]------------------------+  |
| | Pagination 元件                                    |  |
| +---------------------------------------------------+  |
+--------------------------------------------------------+
```

**關鍵元件：**

- 搜尋：`Input` + `Search` icon（lucide）
- 排序：`Select`（時間正序/倒序）
- 記錄卡片：`Card` 包含轉錄內容截斷顯示（`line-clamp-2`）
- 複製按鈕：`Button variant="ghost" size="icon"`，使用 `Copy` icon
- AI 整理標記：`Badge`（經 AI 整理的記錄顯示）
- 滾動區域：`ScrollArea`（固定高度，內部捲動）
- 分頁：安裝 `npx shadcn-vue@latest add pagination`

**記錄卡片展開互動：** 點擊卡片展開顯示完整原始文字與整理後文字的對照。使用 `Collapsible` 元件。

**History 空狀態：** 無記錄時顯示 `History` icon（`size-12 text-muted-foreground`）+ 「尚無轉錄記錄」+ 「按住快捷鍵開始語音輸入」。

### Dictionary 頁面（`/dictionary`）

```
+--[頁面容器 flex-1 space-y-6 p-6]---------------------+
|                                                        |
| +--[標題區]----------------------------------------+  |
| | "自訂字典"             text-2xl font-bold          |  |
| | "管理自訂詞彙以提升轉錄精準度" text-muted-fg       |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[新增區 Card]-------------------------------------+  |
| | CardHeader: "新增詞彙"                             |  |
| | CardContent:                                       |  |
| |   +--[flex gap-2]-------------------------------+  |  |
| |   | [Input placeholder="輸入詞彙..."]  [Button] |  |  |
| |   |                                    "新增"   |  |  |
| |   +---------------------------------------------+  |  |
| |   text-xs text-muted-foreground:                   |  |
| |   "詞彙會同時注入 Whisper 辨識與 AI 整理上下文"    |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[詞彙列表 Card]-----------------------------------+  |
| | CardHeader: "已建立詞彙" Badge:"12 個"             |  |
| | CardContent:                                       |  |
| |   +--[Table]------------------------------------+  |  |
| |   | 詞彙         | 建立時間        | 操作       |  |  |
| |   |--------------|-----------------|------------|  |  |
| |   | Fortuna      | 2026-03-01      | [刪除]     |  |  |
| |   | NoWayLM      | 2026-03-01      | [刪除]     |  |  |
| |   | OAuth        | 2026-02-28      | [刪除]     |  |  |
| |   +----------------------------------------------+  |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[空狀態（無詞彙時顯示）]---------------------------+  |
| |   BookOpen icon (size-12 text-muted-foreground)    |  |
| |   "尚未建立任何詞彙"                                |  |
| |   "新增常用專有名詞，提升辨識準確率"                |  |
| +---------------------------------------------------+  |
+--------------------------------------------------------+
```

**關鍵元件：**

- 新增表單：`Input` + `Button`（inline flex 佈局）
- 詞彙表格：`Table` + `TableHeader` + `TableBody` + `TableRow` + `TableCell`
- 刪除按鈕：`Button variant="ghost" size="icon"` + `Trash2` icon
- 刪除確認：`AlertDialog`（取代 `window.confirm()`）
- 詞彙計數：`Badge variant="secondary"`
- 空狀態：居中圖標 + 說明文字（參照 圖標系統 > 空狀態插圖 `size-12`）

**安裝所需元件：**

```bash
npx shadcn-vue@latest add table
npx shadcn-vue@latest add alert-dialog
```

### Settings 頁面（`/settings`）

```
+--[頁面容器 flex-1 space-y-6 p-6]---------------------+
|                                                        |
| +--[標題區]----------------------------------------+  |
| | "設定"                 text-2xl font-bold          |  |
| | "快捷鍵、API Key 與應用程式偏好" text-muted-fg     |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[快捷鍵設定 Card]--------------------------------+  |
| | CardHeader: "快捷鍵"  Keyboard icon               |  |
| | CardContent (space-y-4):                           |  |
| |   Label: "觸發鍵"                                  |  |
| |   Select: macOS=[Fn/Option/Ctrl/Cmd/Shift]         |  |
| |           Windows=[右Alt/左Alt/Ctrl/Shift]         |  |
| |   Separator                                        |  |
| |   Label: "觸發模式"                                |  |
| |   RadioGroup:                                      |  |
| |     ○ Hold（按住錄音，放開停止）                   |  |
| |     ○ Toggle（按一下開始，再按一下停止）           |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[API Key 設定 Card]-------------------------------+  |
| | CardHeader:                                        |  |
| |   "Groq API Key"  Badge:"已設定"(success) or      |  |
| |                    Badge:"未設定"(destructive)      |  |
| | CardContent (space-y-4):                           |  |
| |   text-sm text-muted-foreground: Groq Console 連結 |  |
| |   Label + Input (type=password) + 顯示/隱藏 Button |  |
| |   flex justify-between:                            |  |
| |     [儲存 Button default] [刪除 Button destructive]|  |
| +---------------------------------------------------+  |
|                                                        |
| +--[AI Prompt 設定 Card]-----------------------------+  |
| | CardHeader: "AI 整理 Prompt"  Sparkles icon        |  |
| | CardContent (space-y-4):                           |  |
| |   text-sm text-muted-foreground: 說明文字          |  |
| |   Textarea (rows=6, class="font-mono")             |  |
| |   flex justify-between:                            |  |
| |     [重置為預設 Button outline]  [儲存 Button]     |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[一般設定 Card]-----------------------------------+  |
| | CardHeader: "一般"                                 |  |
| | CardContent (space-y-4):                           |  |
| |   flex items-center justify-between:               |  |
| |     Label:"開機自動啟動"  Switch                   |  |
| |   Separator                                        |  |
| |   flex items-center justify-between:               |  |
| |     Label:"自動更新"      Switch                   |  |
| +---------------------------------------------------+  |
+--------------------------------------------------------+
```

**關鍵元件：**

- 區塊容器：每個設定區塊使用 `Card` + `CardHeader` + `CardContent`
- 觸發鍵選擇：`Select` + `SelectTrigger` + `SelectContent` + `SelectItem`（依平台動態載入選項：macOS 為 Fn/Option/Ctrl/Cmd/Shift；Windows 為 右Alt/左Alt/Ctrl/Shift）
- 觸發模式：`RadioGroup` + `RadioGroupItem`
- API Key 輸入：`Input type="password"` + 顯示/隱藏 `Button variant="outline" size="icon"`（`Eye` / `EyeOff` icon）
- API Key 狀態：`Badge variant="outline"` 搭配 `bg-success/20 text-success`（已設定）或 `bg-destructive/20 text-destructive`（未設定）
- Prompt 編輯：`Textarea`（需安裝 `npx shadcn-vue@latest add textarea`）
- 開關：`Switch`
- 區塊分隔：`Separator`

**安裝所需元件：**

```bash
npx shadcn-vue@latest add select
npx shadcn-vue@latest add radio-group
npx shadcn-vue@latest add textarea
npx shadcn-vue@latest add switch
npx shadcn-vue@latest add separator
```

## Dark Mode 配色調整

本應用預設 dark mode。以下是 `src/style.css` 中 `.dark` 區塊的調整指引。

### 現有配色保留

shadcn-vue 的 `neutral` base color 的 dark mode 預設值已經過設計，大部分情況下直接使用。以下變數**不修改**：

- `--background`、`--foreground`（頁面基底）
- `--card`、`--card-foreground`（卡片）
- `--popover`、`--popover-foreground`（下拉選單）
- `--muted`、`--muted-foreground`（次要色）
- `--secondary`、`--secondary-foreground`（次要操作）
- `--accent`、`--accent-foreground`（懸浮/選取）
- `--border`、`--input`（邊框/輸入框）

### Teal 品牌色 Dark Mode 調整

由 `--theme teal` 自動處理。Dark mode 下 `--primary` 使用 teal-500（較亮）取代 light mode 的 teal-600（較暗），確保在深色背景上的可讀性。

### 狀態色 Dark Mode 對照表

| 變數 | Light Mode | Dark Mode | 調整理由 |
|------|-----------|-----------|---------|
| `--success` | green-600 `oklch(0.59 0.145 163.225)` | green-500 `oklch(0.696 0.17 162.48)` | 深色背景需更亮 |
| `--warning` | orange-400 `oklch(0.75 0.183 55.934)` | amber-400 `oklch(0.828 0.189 84.429)` | 提高辨識度 |
| `--info` | blue-500 `oklch(0.623 0.214 259.815)` | blue-500 `oklch(0.623 0.214 259.815)` | 明度已足夠 |
| `--destructive` | 已在 style.css 定義 | 已在 style.css 定義 | 不修改 |

### Dark Mode 對比度規則

- 文字對比度 >= 4.5:1（WCAG AA），`text-foreground` 在 `bg-background` 上已滿足
- `text-muted-foreground` 對比度 >= 3:1（輔助文字可接受較低對比）
- 狀態色背景（`bg-success`、`bg-warning`）上的文字使用對應 `*-foreground` 變數
- 邊框使用 `oklch(1 0 0 / 10%)`（白色 10% 透明度），在深色背景上微妙可見
