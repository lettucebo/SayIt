# SayIt

> Hold to speak, release to paste — a desktop speech-to-writing tool

**English** | [繁體中文](README.zh-TW.md)

SayIt is a cross-platform desktop voice input tool. Hold the hotkey to speak in any application, then release it to transcribe your speech with the Groq Whisper API. Groq LLM automatically turns the spoken words into polished Traditional Chinese and pastes the result at the cursor.

## Features

- **Speech to polished writing** — AI removes filler words, restructures sentences, and fixes punctuation so your words are ready to use
- **Global hotkey** — Trigger it from any application with both Hold and Toggle modes
- **Low latency** — Powered by the Groq inference engine, with end-to-end processing in under 3 seconds, including AI cleanup
- **Custom vocabulary** — Keep proper names and technical terms accurate during transcription
- **History and statistics** — Automatically save every transcription and review usage in the Dashboard
- **Minimal setup** — Configure an API key and start using it

## Installation

### Downloads

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [SayIt-mac-arm64.dmg](https://github.com/lettucebo/SayIt/releases/latest/download/SayIt-mac-arm64.dmg) |
| macOS (Intel) | [SayIt-mac-x64.dmg](https://github.com/lettucebo/SayIt/releases/latest/download/SayIt-mac-x64.dmg) |
| Windows | [SayIt-windows-x64.exe](https://github.com/lettucebo/SayIt/releases/latest/download/SayIt-windows-x64.exe) |

> ⚠️ **The Windows installer is currently unsigned**: SmartScreen may display “Windows protected your PC.” Select **More info → Run anyway**. Each installer is accompanied by a `.sha256` file that you can verify with `Get-FileHash` or `shasum -a 256`.

### Prerequisites

- [Groq API key](https://console.groq.com/keys) (free to create)

### Quick start

1. Download and install SayIt.
2. Open SayIt, go to Settings, and paste your Groq API key.
3. Hold the `Fn` key and speak in any application. Release it to paste the text automatically.

### Using Azure OpenAI / Microsoft Foundry (optional)

In addition to Groq, SayIt can connect to Azure OpenAI / Microsoft Foundry and supports three authentication methods: API key, Entra ID secret (service principal), and **Entra ID sign-in** (using your own company account without a client secret, which is useful when company policy prohibits long-lived shared secrets).

See [Sign in to Azure OpenAI / Foundry with Entra ID](docs/azure-entra-user-sign-in.md) for setup instructions.

## Architecture

```
Tauri v2 (Rust) + Vue 3 + TypeScript

  ┌──────────────────────────────────┐
  │        Tauri Backend (Rust)      │
  │  Global hotkey · Clipboard · Audio│
  │             controls              │
  └───────┬──────────────┬───────────┘
          │ invoke()     │ emit()
  ┌───────▼──┐    ┌──────▼───────────┐
  │   HUD    │    │    Dashboard     │
  │ Status HUD│    │ Settings/History │
  │           │    │ /Statistics      │
  └──────────┘    └──────────────────┘
```

- **Frontend** — Vue 3 + TypeScript + shadcn-vue + Tailwind CSS
- **Backend** — Rust (Tauri v2)
- **AI** — Groq Whisper (speech-to-text) + Groq LLM (text polishing)
- **Storage** — SQLite (history) + tauri-plugin-store (settings)

## Development

### Requirements

- Node.js 24+
- pnpm 10+
- Rust stable
- Xcode Command Line Tools (macOS)

### Commands

```bash
# Install dependencies
pnpm install

# Development mode
pnpm tauri dev

# Build
pnpm tauri build

# Tests
pnpm test

# Type checking
npx vue-tsc --noEmit
```

### Release

```powershell
.\scripts\release.ps1 1.1.0
```

```bash
./scripts/release.sh 1.1.0
```

Both commands:

```text
# → Update the version, commit, tag, and push automatically
# → Build macOS and Windows installers with GitHub Actions
# → Publish a GitHub Release after the release workflow completes
```

## License

[MIT](LICENSE)
