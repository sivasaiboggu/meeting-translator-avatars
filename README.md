# Meeting Translator with Avatars

Speak one language. The other person's avatar answers in theirs.

One person speaks English into a laptop; seconds later, an avatar on the
other side speaks the same sentence in Hindi (or Spanish, or French), with
its mouth moving — and captions in both languages land in a transcript.

## Honest about the limits

- **Turn-based, not instant.** One sentence at a time, a few seconds from
  speech to translated speech (about four with live audio). The latency
  badge in the header shows the real measured average for the session.
- **The mouth moves with the sound, not with phonemes.** It opens and
  closes with audio loudness. It is not phoneme-accurate lip-sync — that
  needs a GPU and runs slower than real time, and no hosted free tier does
  it live.
- **No key, no invented translation.** Without a Gemini API key, only the
  three demo sentences translate (their translations are real, written by
  a human, and cached in the app). Any other sentence without a key says
  so plainly instead of guessing.

## How it works

Static HTML/CSS/JS — no build step, no server. Open `index.html` from
`file://`, `localhost`, or GitHub Pages.

- **Speech-to-text:** Web Speech API (`SpeechRecognition`) — Chrome, Edge,
  Safari, no key. Needs a secure page (https or localhost) and mic
  permission. Firefox desktop does not ship recognition; typed input is
  the fallback everywhere.
- **Translation:** Gemini API, model `gemini-2.5-flash`, called directly
  from the browser with a key the user pastes in Settings (stored in
  `localStorage` only, never sent anywhere else). Get a free key at
  <https://aistudio.google.com/apikey>.
- **Speech output:** Web Speech API `speechSynthesis` — free, no key,
  voices from the OS/browser.
- **Avatar:** custom inline SVG face. Mouth opens/closes from audio
  amplitude (mic analyser while speaking; a timed envelope while the
  avatar "speaks", because `speechSynthesis` exposes no audio stream).
  Blinking and a speaking ring. `prefers-reduced-motion` is respected.

## Use it

1. Press **Play demo script** — three seeded sentences run end to end with
   no key and no mic.
2. Or press a **Speak as…** mic button, or type a sentence and press Enter.
3. **Swap direction** flips who translates to whom; the pair picker
   switches English ↔ Hindi / Spanish / French.
4. Settings: Gemini key, voice picker, speech rate, captions-only mode.
5. **Download .txt / .json** exports the transcript (also saved in
   `localStorage` across reloads).

## Tests

```sh
node --test tests/test.js   # 13 tests, 0 failures
python3 scripts/e2e.py     # headless-Chrome end-to-end: typed demo turn
                            # translates, unseeded sentence is refused
                            # honestly, swap + pair switch relabel
```

Screenshots are taken with headless Chromium via `scripts/shot.py`
(CDP; the WebGL domain policy file it needs is `scripts/webgl-policy.txt`).
Desktop 1280px and mobile 390px, zero horizontal overflow on both.

## Design

Berry `#9D174D` + Manrope, warm paper background, hairline borders.
References: Mobbin (meeting-app screens), Linear (dense product UI,
latency badges), Cal.com (plain meeting copy). Contrast: berry on paper
7.0:1, white on berry 7.0:1, ink on paper 14.5:1 (WCAG AA, checked in
tests).

## Files

- `index.html` — the app
- `styles.css` — design system (berry/Manrope)
- `app.js` — DOM wiring, mic, TTS, avatar animation
- `logic.js` — pure logic (demo cache, latency, mouth envelope, Gemini
  request/response, transcript builders); shared by the app and the tests
- `tests/test.js` — Node test suite
- `scripts/shot.py`, `scripts/e2e.py` — screenshot + end-to-end tooling
- `PLAN.md` — the deepened SaaS-level plan
- `screenshots/` — desktop, mobile, and after-turns renders

## License

MIT — see `LICENSE`. Built by Sivasai Boggu, 2026.
