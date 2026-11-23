# PLAN.md — Meeting Translator with Avatars (hackathon #10)

## Project brief
- **Name:** Meeting Translator with Avatars (repo: `meeting-translator-avatars`)
- **Type:** Real-time-ish meeting tool / web app
- **What it does (1 sentence):** One person speaks in one language and the other person's avatar speaks the same sentence in the other language, with captions.
- **Target user and pain:** People in cross-language meetings who lose the thread because live interpreters are expensive and machine translation apps make you stare at a text box instead of the person you are talking to.
- **Core promise:** A real conversation across languages, in one meeting, with a face to look at — not instant, not perfect, and honest about both.
- **Tone:** Calm, plain, meeting-room practical. No marketing adjectives.
- **Colours:** Berry `#9D174D` (accent, under 10% of any screen), warm off-white paper `#FBF7F4`, ink `#221A1E`, muted `#6E5F66`, hairline `#E7DDE1`. One font: Manrope.
- **Reference sites (design-playbook):** Mobbin (real meeting-app screens — two-pane call layout, caption rail), Linear (dense product UI, small badges, tabular latency numbers), Cal.com (plain meeting copy, no hype).
- **Platforms:** Web, desktop-first, works at 390px mobile.
- **Timeline:** 24–48h demo build.

## Stack (verified 23 Nov 2026)
- Static HTML/CSS/JS, no build step, no server — runs from `file://`, `localhost`, or GitHub Pages. Chosen deliberately: the plan's Next.js + FastAPI + faster-whisper pipeline cannot run on a static demo laptop without a server, a GPU, or keys, and this build must be demoable with zero setup.
- Speech-to-text: **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`) — Chrome/Edge/Safari, no key. Chrome sends audio to Google's service by default; Chrome 139+ also offers on-device mode. Firefox desktop does not ship recognition; typed input is the fallback everywhere.
- Translation: **Gemini API, model `gemini-2.5-flash`** (GA 17 Jun 2025; `$0.30` / `$2.50` per 1M input/output tokens), called directly from the browser with the user's own free key, stored in `localStorage` only, never sent anywhere else. No key in this VM, so no live Gemini call is made by the build.
- Speech output: **Web Speech API `speechSynthesis`** — free, no key, voices from the OS/browser.
- Avatar: custom inline SVG face, drawn in code. Mouth opens/closes from audio amplitude (mic analyser while speaking; a timed envelope while the avatar "speaks" via speechSynthesis, because the synthesis API exposes no audio stream). Blinking and a small head bob. This is **not** phoneme-accurate lip-sync — see Honesty.
- Tests: Node `node:test` + `assert`, pure logic in `logic.js`, exact pass count reported.
- No database. Transcript lives in memory + `localStorage` (export as .txt / .json).

## Honesty — what is real, what is not (shown in the UI, not just here)
- True real-time (<1 s), photorealistic, phoneme-accurate lip-synced translation is **not** achievable in 24h on free tiers. This build is **near-real-time, turn-based**: one sentence at a time, about **~4 s per sentence** (listen → recognise → translate → speak). The latency badge shows the measured average for the session.
- The avatar's mouth is **amplitude-driven**, not viseme/phoneme lip-sync. Real lip-sync (SadTalker etc.) needs a GPU and runs slower than real time; hosted options (HeyGen/D-ID free tiers) are pre-rendered video, not live. No pre-rendered clip is included; nothing is labelled lip-synced.
- **No key, no fake translation.** Without a Gemini key, only the pre-seeded demo sentences translate (their translations are real, written by a human, cached in the app) and typed sentences that match them. Any other sentence without a key shows, plainly: "Add a Gemini API key in Settings to translate this." Nothing is invented.
- Speech recognition needs a secure context and a supported browser (Chrome/Edge/Safari); on `file://` in some Chromium builds it may refuse — typed input always works, and the app says which path it used for each turn.

## Feature set (SaaS level, 24–48h scope)
1. **Two-pane meeting room.** Left: speaker A (Maya, English). Right: speaker B (Arjun, Hindi). Each pane has an SVG avatar, name, language tag, speaking ring, and a mic-level meter.
2. **Turn-based pipeline.** Speak (mic) or type → recognise → translate → avatar speaks the translation → captions appear in both languages with timestamps and measured latency per turn.
3. **Language pairs.** English ↔ Hindi (default), English ↔ Spanish, English ↔ French. Pair switch re-labels both panes and re-seeds the demo script.
4. **Demo script (no key needed).** "Play demo script" runs 3 pre-seeded sentences end to end with cached human translations and browser TTS. The exact scripted lines are labelled "Demo — pre-translated".
5. **Text-first mode.** Type a sentence, pick the direction, get the translation as captions even if audio fails. Captions keep working when the mic or TTS fails.
6. **Latency badge.** Header badge shows the session's measured average seconds per sentence ("~4 s per sentence" until the first turn, then the real average). Each transcript row shows its own latency.
7. **Transcript panel.** Every turn: speaker, original text, translated text, timestamps, latency, source tag (Live Gemini / Demo cache / Typed). Copy, download .txt, download .json, clear. Saved to localStorage.
8. **Settings.** Gemini API key field (password input, localStorage only, "Remove key" button), voice picker (browser voices for the target language), speech rate slider, captions-only toggle, reduce-motion respect (`prefers-reduced-motion` stops the head bob).
9. **Turn-taking indicator.** Only one side speaks at a time; the other pane shows "Listening…". Mute button per side. "Swap direction" button flips who translates to whom.
10. **Error states that say what happened.** Mic denied → plain message + typed input prompt. No key + unseeded sentence → plain message, no fake output. Gemini error → the error text shown, turn kept as failed, not retried silently.
11. **Keyboard-first.** Tab order sane, mic button focusable, Enter sends typed text, Esc stops speaking.

## Data model
```js
Turn = {
  id: string,            // crypto.randomUUID()
  at: number,            // epoch ms
  from: 'A' | 'B',       // who spoke
  fromLang: 'en'|'hi'|'es'|'fr',
  toLang: 'en'|'hi'|'es'|'fr',
  original: string,
  translated: string | null,
  source: 'demo-cache' | 'gemini' | 'failed',
  latencyMs: number | null, // recognise+translate+speak-start
  status: 'listening'|'translating'|'speaking'|'done'|'failed',
  error: string | null
}
Settings = { geminiKey: string, rate: number (0.5–1.5), voiceURI: string | null, captionsOnly: boolean }
Session = { pair: 'en-hi'|'en-es'|'en-fr', turns: Turn[], startedAt: number }
```
Persistence: `localStorage` keys `mta.settings.v1`, `mta.transcript.v1`. No server, no account, no analytics.

## User flow end to end
1. Open `index.html`. Two avatars face each other; header shows the latency badge ("~4 s per sentence"), the pair picker (English ↔ Hindi), and Settings.
2. (No key) Press **Play demo script**. Maya's avatar "speaks" sentence 1 in English (browser TTS), the caption appears, then Arjun's avatar speaks the Hindi translation with his mouth moving; the turn lands in the transcript with source "Demo cache" and its measured latency. Repeats for sentences 2–3. Total ~40 s.
3. Press the mic on Maya's pane and speak, or type in the box and press Enter. The app recognises the text (or takes the typed text), checks the demo cache, then — if a key is saved — calls Gemini `gemini-2.5-flash` and shows "Translating…" for the real round-trip time.
4. The translated caption appears and Arjun's avatar speaks it (or, with captions-only on, only the caption appears). The turn is saved with its latency.
5. Press **Swap direction**; now Arjun speaks Hindi (or Spanish/French) and Maya answers in English. Same flow, mirrored.
6. Open Settings, paste a free Gemini key (link to AI Studio in the panel), save. The key status shows "Key saved (in this browser only)". Unseeded sentences now translate live; the source tag reads "Live Gemini".
7. End of meeting: **Download transcript** (.txt or .json), or **Clear**. The transcript survives a reload via localStorage.

## 2-minute demo script
- **0:00–0:15** — Two avatars on screen. "I speak English, Arjun hears Hindi. This is turn-based, not instant — about four seconds a sentence — and the mouth moves with the sound, it is not phoneme-perfect."
- **0:15–0:50** — Play demo script: three short sentences, English text, then Hindi text, then the avatar speaks each one. Point at the latency badge as it updates with real numbers.
- **0:50–1:20** — Unscripted sentence from a judge, typed or spoken. If a key is saved, it translates live; if not, say so on stage and use a seeded line instead. Show the transcript row with its latency and source tag.
- **1:20–1:50** — Swap direction and switch the pair to English ↔ Spanish; show the transcript history and the download button.
- **1:50–2:00** — Close: "Not instant, not perfect — but a real conversation across languages, in one meeting."

## Biggest risk + fallback
- **Risk:** Mic noise, recognition failure, or a Gemini quota error mid-demo turns the live pipeline into silence.
- **Fallback:** Pre-seeded demo script + cached translations run with no key and no mic; text-first captions keep working even if audio fails; typed input replaces the mic entirely. Never debug a model live on stage.

## Design identity
- Berry `#9D174D` accent, Manrope only, warm paper background, 1px hairlines, 10px radii, flat solid buttons. No gradients, no glows, no emoji icons. Signature idea: the **two avatar stage cards** with a thin berry speaking ring and a live latency badge — repeated on every screen.
- Contrast: ink on paper 14.5:1, berry on paper 7.0:1, white on berry 7.0:1 (AA, verified by ratio calc in tests).

## Launch checklist
- [x] Tests pass, 0 failures; screenshots 1280px + 390px, zero overflow, read and fixed.
- [ ] Open on the demo laptop in Chrome; allow mic; play demo script once; paste key and translate one unseeded sentence; download transcript.
- [ ] Record a 60-second backup screen recording of the demo script.

## v2 ideas
1. Faster-whisper local STT via a small FastAPI service for offline rooms. 2. Real viseme lip-sync from a phoneme map per language. 3. More pairs + auto-detect source language. 4. Meeting invite link / two-browser room over WebSocket. 5. Speaker diarisation for 3+ people. 6. Export transcript as .srt captions. 7. Per-speaker voice cloning consent flow. 8. Offline Piper/Kokoro TTS option. 9. Latency budget graph per turn. 10. Interpreter handoff: human takes over mid-sentence.
