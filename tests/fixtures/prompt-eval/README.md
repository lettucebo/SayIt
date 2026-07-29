# Prompt 評測集（Golden Eval Set）

後處理 prompt（`src/i18n/prompts.ts`）的回歸防護資產。

## 為什麼需要它

改 prompt 是「改一句話、影響全部輸出」的高風險操作，但過去沒有評測基準——調完只能憑手感判斷有沒有變好，很容易在修 A 問題時弄壞 B 行為。這份評測集把「prompt 應該做到什麼」變成可驗證的資料。

> ⚠️ 這份評測集**必須留在 repo 裡**。先前曾有一版 prompt 草稿與 50 案例評測集只存在於當時的工作 session，事後完全遺失、無法重建。

## 兩層來源

| 層 | 檔案 | 案例數 | 來源 | 授權 |
|---|---|---|---|---|
| **L1** | `cases-l1-personal.json` | 32 | SayIt 使用者本機 `transcriptions` 表的真實逐字稿 | 專案內部，已去識別化 |
| **L2** | `cases-l2-ml2021.json` | 20 | [`ky552/ML2021_ASR_ST`](https://huggingface.co/datasets/ky552/ML2021_ASR_ST)（台大李宏毅 ML 2021 課程），revision `1e121cc4` | MIT |

**為什麼要兩層。** L2 是公開、可重現、他人能驗證的基準，但它的逐字稿是人工標註的「正確」文字，不含語音辨識錯誤；L1 才捕捉得到 Whisper 在中英夾雜情境下真正會犯的錯（把 repo 聽成 RuPaul、把 CI/CD 聽成 CISD、前半句輸出簡體後半句輸出繁體）。少了 L1，評測集會漏掉這個產品最核心的問題；少了 L2，評測集無法被專案外的人重現。

### L2 的前處理

原始資料集把每個中文字元用空白分隔、且完全沒有標點：

```
"這 堂 課 呢 是 machine learning ml"
```

本目錄的案例已還原成連續文字，並把**連續 5 句合併成一段**，以貼近 SayIt「一次口述一整段話」的實際情境（原始資料是逐句切分的半句片段）。合併時只在兩側都是英數字時插入空白，避免製造出 `learninggeneralization` 這種原文不存在的黏合詞。英文術語一律保持原始小寫。

固定句數切窗的代價是有些案例會在句子中間被切斷（例如 `l2-016` 以「而是」開頭、`l2-006` 結束於「結果反而對 training」）。這些標了 `isFragment: true`，且不對它們宣告 `endsWithQuestionMark` 這類要求完整句構的斷言——片段的句首句尾完整性本來就沒有唯一正解。

### L1 的隱私處理

- 已掃描確認**不含** email、電話、身分證號、密碼等個資
- 人名替換為虛構值（`Alex`）
- 客戶公司名替換為虛構值（`宏遠科技`）
- 技術術語一律保留原樣——那正是要測的東西

去識別化不只靠人工聲明：`[P0] fixtures contain no personally identifiable information` 會對全部案例掃描 email、台灣手機／身分證格式、信用卡號、常見 API token（`sk-`／`gsk_`／`ghp_`／`AKIA`）與私鑰標頭。新增 L1 案例時必須做同樣的去識別化，`provenance` 欄位要註明改了什麼。

## 評測方式：斷言而非全等比對

LLM 輸出有隨機性，拿 `expected` 做字串全等比對必然 flaky。因此每個案例宣告一組**確定性斷言**——輸出必須成立的性質：

```jsonc
{
  "id": "l1-020",
  "input": "幫我驗證一下每個RuPaul的CISD都是正常的…",
  "expected": "幫我驗證一下每個 repo 的 CI/CD 都是正常的…",
  "assertions": [
    { "kind": "requireSubstrings", "values": ["repo", "CI/CD", "job"] },
    { "kind": "forbidSubstrings", "values": ["RuPaul", "CISD", "Jump"] },
    { "kind": "traditionalOnly" },
    { "kind": "latinSpacing" }
  ]
}
```

同一組斷言有兩個用途：

1. **CI（免費、不需 API key）** — 拿案例自己的 `expected` 當輸出跑一次，確保人工撰寫的理想輸出真的符合它自己宣告的斷言。這同時驗證了 `expected` 的品質與斷言沒寫反。
2. **手動實測** — 把真實 LLM 輸出餵進 `evaluateCase()`，得到可讀的違規清單。

### 可用的斷言

| kind | 檢查什麼 |
|---|---|
| `preserveTerms` | 英文／專有名詞原樣出現（不得翻譯、改拼寫、改大小寫） |
| `requireSubstrings` | 指定內容必須出現（改口後的新值、還原後的正確術語） |
| `forbidSubstrings` | 指定內容不得出現（辨識錯誤的原字、被合併掉的重複） |
| `traditionalOnly` | 不得含簡體字 |
| `latinSpacing` | 中文與英數字之間有半形空白 |
| `fullWidthPunctuation` | 中文語境用全形標點 |
| `noTrailingPeriod` | 行尾不補句號（問號、驚嘆號不受限） |
| `noMarkdown` | 不得輸出 Markdown（行首 `1. ` `- ` 除外） |
| `lengthRatio` | 長度比例區間，防內容遺失與擅自展開 |
| `endsWithQuestionMark` | 問句輸出以問號結尾 |

> `traditionalOnly` 的簡體偵測**逐字**判定，且排除繁簡共用字。兩層防護缺一不可：整句丟給 opencc 會因詞級規則把「儀表板」轉成「儀錶板」、「發明了一個」轉成「發明瞭一個」；改成逐字後又擋不住一對多歧義（`台`→`臺`、`游`→`遊`、`里`→`裡`）。opencc 的正反向轉換**無法**區分「繁簡共用字」與「純簡體字」，只能靠字表排除。清單在 `assertions.ts` 的 `AMBIGUOUS_TRADITIONAL_CHARS`，發現新的共用字就往裡面加。

### 一律套用的內容保留底線

逐案宣告的斷言只描述「這個案例在測什麼」，擋不住整體性的災難。以 `l1-020` 為例，輸出 `repo CI/CD job Artifact` 就能通過它宣告的每一條斷言（術語都在、沒簡體、沒半形標點、行尾沒句號），儘管中文內容幾乎被刪光。

因此 `evaluateCase()` 會**自動**加套一條與案例無關的底線：輸入的中文字至少要有 **80%** 仍出現在輸出中。比對前先逐字正規化成繁體，簡→繁的案例才不會因字形改變而失分；用字元集合而非逐字對位，是因為整理過程本來就會刪贅詞、改錯字、合併重複，對位比對會有大量正常落差。

### 斷言的已知限制

這些斷言一律採「**寧可漏報也不誤報**」——誤報會讓完全正確的輸出被判失敗，使評測集失去公信力。目前已知的漏報：

- `fullWidthPunctuation` 只檢查緊接在中文字之後的半形標點。`API,請重試` 這種「英文後接半形逗號再接中文」抓不到，要正確判斷得先剖析識別字邊界，誤報風險高於收益。
- `traditionalOnly` 會放過 `AMBIGUOUS_TRADITIONAL_CHARS` 裡的字，即使它在該語境中確實是簡體用法。
- `noMarkdown` 不攔截 HTML 標籤與刪除線等較少見的格式。

## knownGap：刻意保留的失敗案例

標了 `knownGap` 的案例，是現行 prompt **實測時預期會失敗**的改進目標（例如 `l1-020` 的術語還原）。它們不代表 fixture 有錯，CI 也不會因此變紅——CI 只驗證 `expected` 自洽。這些案例存在的意義就是指出下一步該往哪裡改。

## 執行

### CI（免費，不需 API key）

```bash
pnpm test prompt-eval-fixtures    # fixture 自洽驗證 + 斷言引擎單元測試 + PII 掃描
```

### 實測（需要 API key）

`tests/unit/prompt-eval-live.test.ts` 才是真正「拿 prompt 去打模型、看輸出合不合格」的工具。沒有 `PROMPT_EVAL_API_KEY` 時整組 skip，所以 CI 不受影響。

```bash
# 用預設 prompt（ACTIVE zh-TW）與預設模型跑全部案例
PROMPT_EVAL_API_KEY=xxx pnpm test prompt-eval-live

# 指定模型、只跑 L1、每案跑 3 次取通過率、低於 80% 就讓測試失敗
PROMPT_EVAL_API_KEY=xxx PROMPT_EVAL_MODEL=llama-3.3-70b-versatile \
  PROMPT_EVAL_CASES=l1 PROMPT_EVAL_REPEAT=3 PROMPT_EVAL_MIN_PASS_RATE=0.8 \
  pnpm test prompt-eval-live

# 驗證自己的 prompt 草稿
PROMPT_EVAL_API_KEY=xxx PROMPT_EVAL_PROMPT_FILE=./my-prompt.txt pnpm test prompt-eval-live
```

| 環境變數 | 預設 | 說明 |
|---|---|---|
| `PROMPT_EVAL_API_KEY` | —— | 必填，未設定則整組 skip |
| `PROMPT_EVAL_MODEL` | `DEFAULT_LLM_MODEL_ID` | provider 由 `modelRegistry` 自動解析 |
| `PROMPT_EVAL_PROMPT` | `active` | `active` 或 `minimal` |
| `PROMPT_EVAL_PROMPT_FILE` | —— | 讀外部檔當 system prompt，優先於上者 |
| `PROMPT_EVAL_CASES` | 全部 | 用 id 前綴篩選，例如 `l1`、`l2-01` |
| `PROMPT_EVAL_REPEAT` | `1` | 每案重複次數，用來看穩定度 |
| `PROMPT_EVAL_MIN_PASS_RATE` | —— | 設了才會讓測試因通過率不足而失敗 |
| `PROMPT_EVAL_CONCURRENCY` | `4` | 併發請求數，避免撞 rate limit |
| `PROMPT_EVAL_RAW` | —— | 設 `1` 則跳過 pre-LLM 轉換，純測 prompt |

**關於 pre-LLM 轉換**：runner 預設會先套用 `applyTranscriptTextTransforms()`（取代規則 → 簡轉繁），與 app 的真實管線一致，因此評的是「使用者體感到的最終輸出」而非孤立的 prompt 行為。這也代表 `l1-001`、`l1-022` 這類簡體輸入案例的繁體化其實是由確定性轉換完成的，不該記在 prompt 頭上。想單獨看 prompt 的能力就設 `PROMPT_EVAL_RAW=1`。

報告會把 `knownGap` 案例與一般回歸案例**分開統計**，避免已知的改進目標拉低回歸訊號；失敗時會一併印出期望與實際輸出，方便判斷是模型做錯還是斷言誤判。

### 首次實測結果（gemini-3.5-flash-lite + ACTIVE_PROMPTS zh-TW）

評測集不是紙上談兵——第一次實跑就抓到現行 prompt 的真實缺陷：

```
✖ [REG] l1-001 0/2
      endsWithQuestionMark: 問句輸出未以全形問號結尾
      期望：Windows 如何進入安全模式？
      實際：Windows 如何進入安全模式
```

簡→繁與中英空白都正確（前者其實是 deterministic transform 的功勞），但明確的疑問句沒有補問號，且穩定重現。同批次還觀察到 `RubberDuck` 這類專有名詞在部分次數被改寫。另外 `l1-004` 在不同次數間時通過時失敗，正說明單次採樣不可靠，調 prompt 時應搭配 `PROMPT_EVAL_REPEAT`。

### CI 一定會跑的接線檢查

`tsconfig.json` 的 `include` 只涵蓋 `src/**`，**`tests/**` 不在 `vue-tsc --noEmit` 的檢查範圍**。因此 runner 從 `src/` import 的符號若被改名或搬家，型別檢查抓不到，而 live 測試又因為沒金鑰而 skip——問題會潛伏到某天有人帶著金鑰執行才爆開。開發這支 runner 時就實際踩到兩次（`getProviderIdForModel` 在 `llmProvider` 而非 `modelRegistry`；回傳欄位是 `text` 而非 `content`）。

`prompt eval — live runner wiring` 那組測試因此**不受金鑰 gate 限制**，在 CI 一定執行，驗證 runner 依賴的函式與回傳欄位仍然存在。

## 新增案例

1. 決定放 L1 還是 L2（真實逐字稿 → L1；公開資料集 → L2）
2. 補齊必填欄位：`id`、`source`、`input`、`expected`、`phenomena`、`assertions`、`notes`、`provenance`
3. `notes` 要寫**這個案例在測什麼、為什麼重要**，不是複述輸入內容
4. `expected` 依現行 prompt 契約撰寫：全形標點、中英之間半形空白、行尾不加句號、保留原文英文、不重組句子
5. 跑 `pnpm test prompt-eval`，讓斷言引擎驗證你的 `expected` 自洽

覆蓋率測試會確保每一種 `phenomena` 都至少有一個案例，新增現象時記得補案例。

## 現象覆蓋

已覆蓋：`code-switching`、`punctuation`、`latin-spacing`、`simplified-input`、`filler`、`repetition`、`asr-error`、`question-form`、`list`、`instruction-like`、`taiwan-localization`、`no-op`

**已知未覆蓋：`self-correction`**（說話者中途改口，需以新值取代舊值）

這個現象是 prompt 契約明列的規則之一，但兩層語料**都找不到樣本**：掃描本機 787 筆真實逐字稿與公開資料集 2600 筆 utterance，改口標記（「啊不對」「我是說」「更正」…）出現次數皆為 **0**。推測原因是 Whisper 傾向濾掉即時改口，且課堂講授與短句口述本來就少見中途改值。

在取得真實樣本前**不以合成案例充數**——那會讓評測集看起來完整、實際上是在測一個自己編的分佈。缺口登記在 `tests/support/prompt-eval/types.ts` 的 `UNCOVERED_PHENOMENA`，測試會強制它附上理由，也會在未來補了案例卻忘記移除登記時失敗。

> 這件事本身對調 prompt 有參考價值：目前的 prompt 用了一整條規則處理自我更正，但實際語料中它不出現，該規則的優先級可能被高估了。

`ALL_PHENOMENA` 由 `types.ts` 的 `Record<PromptEvalPhenomenon, true>` 導出，union 新增成員卻忘了補進去會**編譯失敗**，覆蓋率測試因此不可能因清單漏列而「技術性通過」。

刻意設計的對照組：

- `l1-006`（口說卡詞的重複，要合併）↔ `l2-003`（為解釋而刻意重述，不可合併）
- `l2-007`（句中的「呢」是停頓詞，可刪）↔ `l2-015`（句尾的「呢」構成疑問，必須留）
- `l1-031`（真正的 no-op，一個字都不該改）擋過度校正
- `l1-026`（口語鬆散但不得整句重寫，`icon` 不得翻成「圖示」）擋過度改寫
- `l1-032`（明確五步驟流程，**該**列點）↔ `l1-015`／`l2-005`（口語短列舉，**不該**硬拆成列點）
