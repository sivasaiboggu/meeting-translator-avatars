// logic.js — pure, DOM-free logic for Meeting Translator with Avatars.
// Shared by index.html (via <script>) and tests/test.js (via require/module.exports).
(function (root) {
  'use strict';

  var LANGS = {
    en: { code: 'en', bcp47: 'en-US', label: 'English', voiceLangs: ['en-US', 'en-GB', 'en'] },
    hi: { code: 'hi', bcp47: 'hi-IN', label: 'Hindi', voiceLangs: ['hi-IN', 'hi'] },
    es: { code: 'es', bcp47: 'es-ES', label: 'Spanish', voiceLangs: ['es-ES', 'es-MX', 'es-US', 'es'] },
    fr: { code: 'fr', bcp47: 'fr-FR', label: 'French', voiceLangs: ['fr-FR', 'fr-CA', 'fr'] }
  };

  var PAIRS = {
    'en-hi': { a: 'en', b: 'hi' },
    'en-es': { a: 'en', b: 'es' },
    'en-fr': { a: 'en', b: 'fr' }
  };

  // Human-written translations, cached in the app. These are the ONLY
  // translations available without a Gemini API key. Nothing else is faked.
  var DEMO_SENTENCES = {
    'en-hi': [
      { from: "Good morning, let's start with the budget for next quarter.", to: 'सुप्रभात, अगले तिमाही के बजट से शुरू करते हैं।' },
      { from: 'The launch date moves to Friday, and the team is ready.', to: 'लॉन्च की तारीख शुक्रवार हो गई है, और टीम तैयार है।' },
      { from: 'Can we keep the demo short and leave ten minutes for questions?', to: 'क्या हम डेमो छोटा रख सकते हैं और सवालों के लिए दस मिनट छोड़ सकते हैं?' }
    ],
    'en-es': [
      { from: "Good morning, let's start with the budget for next quarter.", to: 'Buenos días, empecemos con el presupuesto del próximo trimestre.' },
      { from: 'The launch date moves to Friday, and the team is ready.', to: 'La fecha de lanzamiento pasa al viernes y el equipo está listo.' },
      { from: 'Can we keep the demo short and leave ten minutes for questions?', to: '¿Podemos hacer la demostración breve y dejar diez minutos para preguntas?' }
    ],
    'en-fr': [
      { from: "Good morning, let's start with the budget for next quarter.", to: 'Bonjour, commençons par le budget du prochain trimestre.' },
      { from: 'The launch date moves to Friday, and the team is ready.', to: "La date de lancement est reportée à vendredi, et l'équipe est prête." },
      { from: 'Can we keep the demo short and leave ten minutes for questions?', to: 'Pouvons-nous garder la démo courte et laisser dix minutes pour les questions ?' }
    ]
  };

  var GEMINI_MODEL = 'gemini-2.5-flash';
  var GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';

  function normalizeText(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').toLowerCase();
  }

  // Exact (normalised) match against the demo cache, either direction.
  // Demo sentences only exist for English paired with one other language:
  // a pair with no English side (e.g. Hindi -> Spanish) has no cache and
  // must return null instead of borrowing another pair's translations.
  function lookupDemo(fromLang, toLang, text) {
    if (fromLang !== 'en' && toLang !== 'en') return null;
    var pairKey = 'en-' + (fromLang === 'en' ? toLang : fromLang);
    var list = DEMO_SENTENCES[pairKey];
    if (!list) return null;
    var norm = normalizeText(text);
    for (var i = 0; i < list.length; i++) {
      if (fromLang === 'en' && normalizeText(list[i].from) === norm) return list[i].to;
      if (fromLang !== 'en' && normalizeText(list[i].to) === norm) return list[i].from;
    }
    return null;
  }

  function demoScriptFor(pairKey) {
    return (DEMO_SENTENCES[pairKey] || []).map(function (s) { return { from: s.from, to: s.to }; });
  }

  function formatLatency(ms) {
    if (ms == null || isNaN(ms)) return '~4 s';
    var s = ms / 1000;
    return (s < 10 ? s.toFixed(1) : Math.round(s) + '') + ' s';
  }

  function averageLatencyMs(turns) {
    var vals = turns.filter(function (t) { return typeof t.latencyMs === 'number'; })
      .map(function (t) { return t.latencyMs; });
    if (!vals.length) return null;
    var sum = vals.reduce(function (a, b) { return a + b; }, 0);
    return Math.round(sum / vals.length);
  }

  function latencyBadgeText(turns) {
    var avg = averageLatencyMs(turns);
    return avg == null ? '~4 s per sentence' : formatLatency(avg) + ' per sentence';
  }

  // Mouth opening (0..1) from an audio level (0..1). Amplitude-driven only:
  // never claims phoneme accuracy. Smooths with a floor so the mouth rests closed.
  function mouthOpenFromLevel(level) {
    var l = Math.max(0, Math.min(1, level || 0));
    if (l < 0.08) return 0;
    return Math.min(1, (l - 0.08) / 0.6);
  }

  // Timed envelope for speechSynthesis output (no audio stream is exposed):
  // syllable-ish pulses while speaking, 0 when silent.
  function speechEnvelopeAt(elapsedMs, durationMs) {
    if (elapsedMs < 0 || elapsedMs >= durationMs) return 0;
    var t = elapsedMs / 1000;
    var pulse = 0.55 + 0.45 * Math.sin(t * 2 * Math.PI * 3.2);
    var attack = Math.min(1, elapsedMs / 180);
    var release = Math.min(1, (durationMs - elapsedMs) / 250);
    return Math.max(0, pulse * attack * release);
  }

  function estimateSpeechMs(text, rate) {
    var words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
    var r = rate || 1;
    return Math.max(900, Math.round((words / 2.6) * 1000 / r));
  }

  function geminiRequest(fromLang, toLang, text) {
    // Unknown language codes used to throw (LANGS[code].label on undefined).
    // Return null so the caller can say plainly it cannot translate this pair.
    if (!LANGS[fromLang] || !LANGS[toLang]) return null;
    var fromName = LANGS[fromLang].label, toName = LANGS[toLang].label;
    return {
      url: GEMINI_ENDPOINT,
      body: {
        contents: [{ parts: [{ text:
          'Translate this ' + fromName + ' sentence into ' + toName +
          '. Reply with only the translation, no explanation, no quotes.\n\n' + text }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 256 }
      }
    };
  }

  function parseGeminiResponse(json) {
    try {
      var t = json.candidates[0].content.parts.map(function (p) { return p.text; }).join('').trim();
      return t || null;
    } catch (e) { return null; }
  }

  function validateSettings(s) {
    var out = { geminiKey: '', rate: 1, captionsOnly: false, voiceURI: null };
    if (!s || typeof s !== 'object') return out;
    if (typeof s.geminiKey === 'string') out.geminiKey = s.geminiKey.trim();
    if (typeof s.rate === 'number' && s.rate >= 0.5 && s.rate <= 1.5) out.rate = s.rate;
    if (s.captionsOnly === true) out.captionsOnly = true;
    if (typeof s.voiceURI === 'string') out.voiceURI = s.voiceURI;
    return out;
  }

  function buildTranscriptText(turns, pairLabel) {
    var lines = ['Meeting Translator with Avatars — transcript', 'Pair: ' + pairLabel, ''];
    turns.forEach(function (t, i) {
      var time = new Date(t.at).toLocaleTimeString();
      lines.push((i + 1) + '. [' + time + '] ' + t.fromName + ' (' + LANGS[t.fromLang].label + '): ' + t.original);
      lines.push('   → ' + t.toName + ' (' + LANGS[t.toLang].label + '): ' + (t.translated || '(no translation — ' + (t.error || 'needs a Gemini API key') + ')'));
      lines.push('   Source: ' + t.source + (t.latencyMs != null ? ' · ' + formatLatency(t.latencyMs) : ''));
    });
    return lines.join('\n');
  }

  function buildTranscriptJson(turns) {
    return JSON.stringify({ app: 'meeting-translator-avatars', exportedAt: new Date().toISOString(), turns: turns }, null, 2);
  }

  // --- contrast helpers (WCAG relative luminance) ---
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function luminance(rgb) {
    function f(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  function contrastRatio(hexA, hexB) {
    var l1 = luminance(hexToRgb(hexA)), l2 = luminance(hexToRgb(hexB));
    var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  var api = {
    LANGS: LANGS, PAIRS: PAIRS, DEMO_SENTENCES: DEMO_SENTENCES,
    GEMINI_MODEL: GEMINI_MODEL, GEMINI_ENDPOINT: GEMINI_ENDPOINT,
    normalizeText: normalizeText, lookupDemo: lookupDemo, demoScriptFor: demoScriptFor,
    formatLatency: formatLatency, averageLatencyMs: averageLatencyMs,
    latencyBadgeText: latencyBadgeText, mouthOpenFromLevel: mouthOpenFromLevel,
    speechEnvelopeAt: speechEnvelopeAt, estimateSpeechMs: estimateSpeechMs,
    geminiRequest: geminiRequest, parseGeminiResponse: parseGeminiResponse,
    validateSettings: validateSettings, buildTranscriptText: buildTranscriptText,
    buildTranscriptJson: buildTranscriptJson, contrastRatio: contrastRatio
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MTA = api;
})(typeof window !== 'undefined' ? window : globalThis);
