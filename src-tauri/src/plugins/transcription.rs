use std::time::Instant;

use tauri::{command, State};

use super::audio_recorder::AudioRecorderState;

// ========== Constants ==========

const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_WHISPER_PROMPT_TERMS: usize = 50;
const MINIMUM_AUDIO_SIZE: usize = 1000;
/// Groq free tier 上限 25MB
const MAX_AUDIO_FILE_SIZE: usize = 25 * 1024 * 1024;
const DEFAULT_WHISPER_MODEL_ID: &str = "whisper-large-v3";
const REQUEST_TIMEOUT_SECS: u64 = 120;

// ========== State ==========

pub struct TranscriptionState {
    client: reqwest::Client,
}

impl TranscriptionState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .use_rustls_tls()
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .expect("Failed to build HTTP client");
        Self { client }
    }
}

// ========== Error Type ==========

#[derive(Debug, thiserror::Error)]
pub enum TranscriptionError {
    #[error("No audio data available — call stop_recording first")]
    NoAudioData,
    #[error("Audio data too small ({0} bytes), recording may have failed")]
    AudioTooSmall(usize),
    #[error("Audio file too large ({size_mb:.1} MB, limit {limit_mb} MB). Please shorten your recording.")]
    FileTooLarge { size_mb: f64, limit_mb: usize },
    #[error("API key is missing")]
    ApiKeyMissing,
    #[error("Transcription API request failed: {0}")]
    RequestFailed(String),
    #[error("Transcription API error ({0}): {1}")]
    ApiError(u16, String),
    #[error("Failed to parse API response: {0}")]
    ParseError(String),
    #[error("Lock poisoned")]
    LockPoisoned,
}

impl serde::Serialize for TranscriptionError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ========== Result Types ==========

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub raw_text: String,
    pub transcription_duration_ms: f64,
    pub no_speech_probability: f64,
    // Peak/RMS energy (0.0..=1.0) of the source audio. Populated by
    // `retranscribe_from_file` (computed from the WAV) so the frontend
    // hallucination detector can run on history retries; the live
    // transcription path leaves these at 0.0 (it derives energy from the
    // recorder's StopRecordingResult instead).
    pub peak_energy_level: f32,
    pub rms_energy_level: f32,
}

// ========== Groq API Response ==========

#[derive(serde::Deserialize)]
struct WhisperVerboseResponse {
    text: String,
    segments: Vec<WhisperSegment>,
}

#[derive(serde::Deserialize)]
struct WhisperSegment {
    no_speech_prob: f64,
}

// ========== Helpers ==========

fn format_whisper_prompt(term_list: &[String]) -> String {
    let terms: Vec<&str> = term_list
        .iter()
        .take(MAX_WHISPER_PROMPT_TERMS)
        .map(|s| s.as_str())
        .collect();
    format!("Important Vocabulary: {}", terms.join(", "))
}

const DEFAULT_AZURE_WHISPER_API_VERSION: &str = "2024-06-01";

/// Azure OpenAI Whisper（deployment-path）轉錄設定。
struct AzureWhisperConfig {
    endpoint: String,
    deployment: String,
    api_version: String,
    /// entra → Authorization: Bearer；key → api-key header
    use_bearer: bool,
}

/// 依 provider 參數建出 Azure 設定；非 azure 回 None。
fn build_azure_whisper_config(
    provider: Option<String>,
    endpoint: Option<String>,
    deployment: Option<String>,
    api_version: Option<String>,
    auth_mode: Option<String>,
) -> Result<Option<AzureWhisperConfig>, TranscriptionError> {
    if provider.as_deref() != Some("azure") {
        return Ok(None);
    }
    let endpoint = endpoint
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| TranscriptionError::RequestFailed("Azure endpoint missing".to_string()))?;
    let deployment = deployment
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            TranscriptionError::RequestFailed("Azure whisper deployment missing".to_string())
        })?;
    let api_version = api_version
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_AZURE_WHISPER_API_VERSION.to_string());
    let use_bearer = auth_mode.as_deref() == Some("entra");
    Ok(Some(AzureWhisperConfig {
        endpoint,
        deployment,
        api_version,
        use_bearer,
    }))
}

// ========== Shared Transcription Logic ==========

async fn send_transcription_request(
    wav_data: Vec<u8>,
    transcription_state: &TranscriptionState,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    model_id: Option<String>,
    language: Option<String>,
    azure: Option<AzureWhisperConfig>,
) -> Result<TranscriptionResult, TranscriptionError> {
    if wav_data.len() < MINIMUM_AUDIO_SIZE {
        return Err(TranscriptionError::AudioTooSmall(wav_data.len()));
    }

    if wav_data.len() > MAX_AUDIO_FILE_SIZE {
        let size_mb = wav_data.len() as f64 / (1024.0 * 1024.0);
        let limit_mb = MAX_AUDIO_FILE_SIZE / (1024 * 1024);
        return Err(TranscriptionError::FileTooLarge { size_mb, limit_mb });
    }

    let model = model_id.unwrap_or_else(|| DEFAULT_WHISPER_MODEL_ID.to_string());

    // 依 provider 決定 URL、是否帶 model 欄位、與認證 header 型式
    let (url, use_bearer, include_model) = match &azure {
        Some(cfg) => {
            let base = cfg.endpoint.trim_end_matches('/');
            (
                format!(
                    "{}/openai/deployments/{}/audio/transcriptions?api-version={}",
                    base, cfg.deployment, cfg.api_version
                ),
                cfg.use_bearer,
                false,
            )
        }
        None => (GROQ_API_URL.to_string(), true, true),
    };

    log::info!(
        "[transcription] Sending {} bytes WAV to {} (model={})",
        wav_data.len(),
        if azure.is_some() { "Azure" } else { "Groq" },
        model
    );

    let start_time = Instant::now();

    // Build multipart form
    let file_part = reqwest::multipart::Part::bytes(wav_data)
        .file_name("recording.wav")
        .mime_str("audio/wav")
        .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("response_format", "verbose_json");

    // Azure deployment-path 不需要 model 欄位（部署已在 URL）
    if include_model {
        form = form.text("model", model);
    }

    // Conditionally add language — None means auto-detect
    if let Some(lang) = language {
        form = form.text("language", lang);
    }

    if let Some(ref terms) = vocabulary_term_list {
        if !terms.is_empty() {
            let prompt = format_whisper_prompt(terms);
            form = form.text("prompt", prompt);
        }
    }

    // Send request (reuse shared client for connection pooling)
    let mut request_builder = transcription_state.client.post(&url);
    request_builder = if use_bearer {
        request_builder.bearer_auth(&api_key)
    } else {
        request_builder.header("api-key", &api_key)
    };
    let response = request_builder
        .multipart(form)
        .send()
        .await
        .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        return Err(TranscriptionError::ApiError(status, body));
    }

    // Parse response
    let json: WhisperVerboseResponse = response
        .json()
        .await
        .map_err(|e| TranscriptionError::ParseError(e.to_string()))?;

    let raw_text = json.text.trim().to_string();
    // Use MIN: if any segment detects speech (low NSP), trust it — real speech
    // always produces at least one low-NSP segment, while pure noise/hallucination
    // keeps all segments high.
    let no_speech_probability = json
        .segments
        .iter()
        .map(|s| s.no_speech_prob)
        .fold(1.0_f64, f64::min);
    // If no segments, treat as full silence
    let no_speech_probability = if json.segments.is_empty() {
        1.0
    } else {
        no_speech_probability
    };

    let transcription_duration_ms = start_time.elapsed().as_secs_f64() * 1000.0;

    log::info!(
        "[transcription] Response in {transcription_duration_ms:.0}ms: \"{raw_text}\" (noSpeechProb={no_speech_probability:.3})"
    );

    Ok(TranscriptionResult {
        raw_text,
        transcription_duration_ms,
        no_speech_probability,
        // Live path doesn't compute energy here; retranscribe_from_file fills these in.
        peak_energy_level: 0.0,
        rms_energy_level: 0.0,
    })
}

/// Locate the byte offset of the PCM samples (start of the "data" sub-chunk body)
/// in a RIFF/WAVE buffer. Returns None if the buffer is not a recognizable WAV.
fn find_wav_data_offset(wav_data: &[u8]) -> Option<usize> {
    if wav_data.len() < 12 || &wav_data[0..4] != b"RIFF" || &wav_data[8..12] != b"WAVE" {
        return None;
    }
    let mut pos = 12;
    while pos + 8 <= wav_data.len() {
        let chunk_id = &wav_data[pos..pos + 4];
        let chunk_size = u32::from_le_bytes([
            wav_data[pos + 4],
            wav_data[pos + 5],
            wav_data[pos + 6],
            wav_data[pos + 7],
        ]) as usize;
        let body = pos + 8;
        if chunk_id == b"data" {
            return Some(body);
        }
        // Sub-chunks are word-aligned (padded to an even byte count).
        pos = body + chunk_size + (chunk_size & 1);
    }
    None
}

/// Compute peak & RMS energy (0.0..=1.0) from a 16-bit mono PCM WAV byte buffer.
/// Mirrors the live-recording formula in `audio_recorder.rs` so the hallucination
/// detector can run on re-transcribed history recordings.
fn compute_wav_energy(wav_data: &[u8]) -> (f32, f32) {
    let data_offset = find_wav_data_offset(wav_data).unwrap_or(44);
    let pcm = match wav_data.get(data_offset..) {
        Some(slice) => slice,
        None => return (0.0, 0.0),
    };
    let sample_count = pcm.len() / 2;
    if sample_count == 0 {
        return (0.0, 0.0);
    }
    let mut peak = 0.0_f32;
    let mut sum_squares = 0.0_f64;
    for frame in pcm.chunks_exact(2) {
        let s = i16::from_le_bytes([frame[0], frame[1]]);
        let abs_normalized = (s as f32).abs() / i16::MAX as f32;
        peak = peak.max(abs_normalized);
        let norm_f64 = s as f64 / i16::MAX as f64;
        sum_squares += norm_f64 * norm_f64;
    }
    let rms = (sum_squares / sample_count as f64).sqrt() as f32;
    (peak, rms)
}

// ========== Commands ==========

#[command]
#[allow(clippy::too_many_arguments)]
pub async fn transcribe_audio(
    state: State<'_, AudioRecorderState>,
    transcription_state: State<'_, TranscriptionState>,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    model_id: Option<String>,
    language: Option<String>,
    provider: Option<String>,
    endpoint: Option<String>,
    deployment: Option<String>,
    api_version: Option<String>,
    auth_mode: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError> {
    if api_key.trim().is_empty() {
        return Err(TranscriptionError::ApiKeyMissing);
    }

    let azure = build_azure_whisper_config(provider, endpoint, deployment, api_version, auth_mode)?;

    // Take WAV data from shared state (consume it)
    let wav_data = {
        let mut guard = state
            .wav_buffer
            .lock()
            .map_err(|_| TranscriptionError::LockPoisoned)?;
        guard.take().ok_or(TranscriptionError::NoAudioData)?
    };

    send_transcription_request(
        wav_data,
        &transcription_state,
        api_key,
        vocabulary_term_list,
        model_id,
        language,
        azure,
    )
    .await
}

#[command]
#[allow(clippy::too_many_arguments)]
pub async fn retranscribe_from_file(
    transcription_state: State<'_, TranscriptionState>,
    file_path: String,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    model_id: Option<String>,
    language: Option<String>,
    provider: Option<String>,
    endpoint: Option<String>,
    deployment: Option<String>,
    api_version: Option<String>,
    auth_mode: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError> {
    if api_key.trim().is_empty() {
        return Err(TranscriptionError::ApiKeyMissing);
    }

    let azure = build_azure_whisper_config(provider, endpoint, deployment, api_version, auth_mode)?;

    // 注意：std::fs::read 是同步 I/O，但 WAV 檔案通常很小（< 1MB），
    // 在 Tauri command 的 async context 中可接受。
    let wav_data = std::fs::read(&file_path)
        .map_err(|e| TranscriptionError::RequestFailed(format!("Failed to read WAV file: {e}")))?;

    log::info!(
        "[transcription] Retranscribing from file: {} ({} bytes)",
        file_path,
        wav_data.len()
    );

    // Compute energy from the WAV before the bytes are moved into the request,
    // so the frontend hallucination detector can run on this history retry.
    let (peak_energy_level, rms_energy_level) = compute_wav_energy(&wav_data);

    let mut result = send_transcription_request(
        wav_data,
        &transcription_state,
        api_key,
        vocabulary_term_list,
        model_id,
        language,
        azure,
    )
    .await?;
    result.peak_energy_level = peak_energy_level;
    result.rms_energy_level = rms_energy_level;
    Ok(result)
}

#[command]
#[allow(clippy::too_many_arguments)]
pub async fn test_whisper_connection(
    transcription_state: State<'_, TranscriptionState>,
    api_key: String,
    model_id: Option<String>,
    provider: Option<String>,
    endpoint: Option<String>,
    deployment: Option<String>,
    api_version: Option<String>,
    auth_mode: Option<String>,
) -> Result<(), TranscriptionError> {
    if api_key.trim().is_empty() {
        return Err(TranscriptionError::ApiKeyMissing);
    }

    let azure = build_azure_whisper_config(provider, endpoint, deployment, api_version, auth_mode)?;

    // 1 秒 16kHz silence ≈ 32044 bytes，遠超過 MINIMUM_AUDIO_SIZE 的 1000 byte 下限。
    let silence_samples = vec![0i16; 16_000];
    let wav_data = super::audio_recorder::encode_wav(&silence_samples, 16_000)
        .map_err(|e| TranscriptionError::RequestFailed(e.to_string()))?;

    send_transcription_request(
        wav_data,
        &transcription_state,
        api_key,
        None,
        model_id,
        None,
        azure,
    )
    .await
    .map(|_| ())
}

// ========== Tests ==========

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_whisper_prompt_basic() {
        let terms = vec!["Tauri".to_string(), "Rust".to_string(), "Vue".to_string()];
        let result = format_whisper_prompt(&terms);
        assert_eq!(result, "Important Vocabulary: Tauri, Rust, Vue");
    }

    #[test]
    fn test_format_whisper_prompt_empty() {
        let terms: Vec<String> = vec![];
        let result = format_whisper_prompt(&terms);
        assert_eq!(result, "Important Vocabulary: ");
    }

    #[test]
    fn test_format_whisper_prompt_exceeds_max() {
        let terms: Vec<String> = (0..100).map(|i| format!("term{i}")).collect();
        let result = format_whisper_prompt(&terms);
        // Should only include first 30 terms
        let parts: Vec<&str> = result
            .strip_prefix("Important Vocabulary: ")
            .unwrap()
            .split(", ")
            .collect();
        assert_eq!(parts.len(), MAX_WHISPER_PROMPT_TERMS);
        assert_eq!(parts[0], "term0");
        assert_eq!(parts[29], "term29");
    }

    #[test]
    fn test_transcription_result_serialization() {
        let result = TranscriptionResult {
            raw_text: "hello".to_string(),
            transcription_duration_ms: 320.5,
            no_speech_probability: 0.01,
            peak_energy_level: 0.5,
            rms_energy_level: 0.1,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"rawText\""));
        assert!(json.contains("\"transcriptionDurationMs\""));
        assert!(json.contains("\"noSpeechProbability\""));
        assert!(json.contains("\"peakEnergyLevel\""));
        assert!(json.contains("\"rmsEnergyLevel\""));
    }

    /// Build a minimal mono 16-bit PCM WAV around the given samples.
    fn make_test_wav(samples: &[i16]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(b"RIFF");
        v.extend_from_slice(&0u32.to_le_bytes()); // chunk size (ignored by parser)
        v.extend_from_slice(b"WAVE");
        v.extend_from_slice(b"fmt ");
        v.extend_from_slice(&16u32.to_le_bytes());
        v.extend_from_slice(&1u16.to_le_bytes()); // PCM
        v.extend_from_slice(&1u16.to_le_bytes()); // mono
        v.extend_from_slice(&16000u32.to_le_bytes()); // sample rate
        v.extend_from_slice(&32000u32.to_le_bytes()); // byte rate
        v.extend_from_slice(&2u16.to_le_bytes()); // block align
        v.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
        v.extend_from_slice(b"data");
        v.extend_from_slice(&((samples.len() * 2) as u32).to_le_bytes());
        for &s in samples {
            v.extend_from_slice(&s.to_le_bytes());
        }
        v
    }

    #[test]
    fn test_compute_wav_energy() {
        // Silence → (0, 0)
        let (peak, rms) = compute_wav_energy(&make_test_wav(&[0i16; 8]));
        assert!(peak < 1e-6, "peak={peak}");
        assert!(rms < 1e-6, "rms={rms}");

        // Full-scale square wave → peak ≈ 1.0, rms ≈ 1.0
        let (peak, rms) =
            compute_wav_energy(&make_test_wav(&[i16::MAX, -i16::MAX, i16::MAX, -i16::MAX]));
        assert!((peak - 1.0).abs() < 1e-3, "peak={peak}");
        assert!(rms > 0.9, "rms={rms}");

        // Empty data chunk → (0, 0), no panic
        let (peak, rms) = compute_wav_energy(&make_test_wav(&[]));
        assert_eq!(peak, 0.0);
        assert_eq!(rms, 0.0);

        // Non-WAV / too short → (0, 0), no panic
        let (peak, rms) = compute_wav_energy(&[1u8, 2, 3]);
        assert_eq!(peak, 0.0);
        assert_eq!(rms, 0.0);
    }

    #[test]
    fn test_build_azure_whisper_config_non_azure() {
        assert!(build_azure_whisper_config(None, None, None, None, None)
            .unwrap()
            .is_none());
        assert!(
            build_azure_whisper_config(Some("groq".to_string()), None, None, None, None)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn test_build_azure_whisper_config_full() {
        let cfg = build_azure_whisper_config(
            Some("azure".to_string()),
            Some("https://r.openai.azure.com/".to_string()),
            Some("whisper".to_string()),
            Some("2024-10-21".to_string()),
            Some("entra".to_string()),
        )
        .unwrap()
        .expect("expected Some config");
        assert_eq!(cfg.endpoint, "https://r.openai.azure.com/");
        assert_eq!(cfg.deployment, "whisper");
        assert_eq!(cfg.api_version, "2024-10-21");
        assert!(cfg.use_bearer);
    }

    #[test]
    fn test_build_azure_whisper_config_defaults_and_key_mode() {
        let cfg = build_azure_whisper_config(
            Some("azure".to_string()),
            Some("https://r.openai.azure.com".to_string()),
            Some("whisper".to_string()),
            None,
            Some("key".to_string()),
        )
        .unwrap()
        .expect("expected Some config");
        assert_eq!(cfg.api_version, DEFAULT_AZURE_WHISPER_API_VERSION);
        assert!(!cfg.use_bearer);
    }

    #[test]
    fn test_build_azure_whisper_config_missing_fields_err() {
        assert!(build_azure_whisper_config(
            Some("azure".to_string()),
            None,
            Some("whisper".to_string()),
            None,
            Some("key".to_string())
        )
        .is_err());
        assert!(build_azure_whisper_config(
            Some("azure".to_string()),
            Some("https://r.openai.azure.com".to_string()),
            None,
            None,
            Some("key".to_string())
        )
        .is_err());
    }
}
