/**
 * 簡體 → 繁體（台灣）轉換 — 純函式，供轉錄結果落地前套用。
 *
 * 背景（#39）：Whisper 對中文預設輸出簡體，而使用者若選繁中，會期待繁體輸出。
 * SayIt 過去沒有確定性的簡→繁轉換（只靠 AI 整理偶爾順手轉、不穩定）。
 * 這裡用 opencc-js 做字元級（Taiwan 標準）轉換，只在轉譯語言解析為 zh-TW 時套用。
 * opencc-js（~1.19MB 字典）採**惰性動態載入**、不進初始 bundle；載入/轉換失敗 fail-open。
 *
 * 用 `to: "tw"`（字元級台灣正體）而非 `"twp"`（含詞彙/慣用語轉換）：
 * 只轉字、不改用詞，避免把使用者原本的措辭改掉。
 */
type ConvertFn = (text: string) => string;

// 快取「載入 converter」的 promise：成功後重用；失敗（chunk/asset 損毀、
// updater 不一致等）時重置快取，讓下次呼叫有機會重試，本次則 fail-open 回原文。
let converterPromise: Promise<ConvertFn> | null = null;

async function loadConverter(): Promise<ConvertFn> {
  // 動態載入：~1.19MB 字典成獨立 chunk，不進初始 bundle。
  const { Converter } = await import("opencc-js");
  // 用 to:"tw"（字元級台灣正體）非 "twp"（含詞彙/慣用語）：只轉字、不改用詞。
  return Converter({ from: "cn", to: "tw" });
}

function getConverter(): Promise<ConvertFn> {
  if (!converterPromise) {
    converterPromise = loadConverter().catch((err) => {
      // 重置快取讓下次重試；本次由呼叫端 fail-open 回原文。
      converterPromise = null;
      throw err;
    });
  }
  return converterPromise;
}

/**
 * 把簡體中文轉成繁體（台灣）。空字串原樣返回。
 * 惰性載入 opencc-js；載入或轉換失敗時 **fail-open**：記 content-free warning
 * 並回傳原字串，絕不讓非必要的字元轉換弄垮整條 paste / retry 流程。
 */
export async function convertSimplifiedToTraditional(
  text: string,
): Promise<string> {
  if (!text) return text;
  try {
    const convert = await getConverter();
    return convert(text);
  } catch (err) {
    // content-free：只記錯誤訊息、不記文字內容。
    console.warn(
      "[simplifiedToTraditional] opencc-js load/convert failed; returning raw text:",
      err instanceof Error ? err.message : String(err),
    );
    return text;
  }
}
