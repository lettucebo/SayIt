export interface AudioInputDeviceInfo {
  name: string;
}

export interface WaveformPayload {
  levels: number[];
}

export interface AudioPreviewLevelPayload {
  level: number;
}

export interface StopRecordingResult {
  recordingDurationMs: number;
  peakEnergyLevel: number;
  rmsEnergyLevel: number;
}

export interface TranscriptionResult {
  rawText: string;
  transcriptionDurationMs: number;
  /** Whisper 提供 segment-level no-speech 機率；Gemini 無此信號時為 null
   *  （幻覺偵測 Layer 2b 僅在有值時執行）。 */
  noSpeechProbability: number | null;
  /** Peak energy 0.0..=1.0 of the source audio. 0 for the live path (energy comes
   *  from StopRecordingResult); populated by retranscribe_from_file for history retries. */
  peakEnergyLevel: number;
  /** RMS energy 0.0..=1.0 of the source audio. See peakEnergyLevel. */
  rmsEnergyLevel: number;
  /** Gemini 依 token 計量（音訊約 32 tokens/秒）並回報用量；
   *  Whisper（Groq/Azure）以音訊時長計費、不回報 token，故為 null。 */
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}
