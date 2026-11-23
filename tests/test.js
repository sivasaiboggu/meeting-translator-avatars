// tests/test.js — node:test suite for Meeting Translator with Avatars.
// Run: node --test tests/test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const MTA = require('../logic.js');

test('demo cache: all three English sentences translate per pair', () => {
  for (const pair of ['en-hi', 'en-es', 'en-fr']) {
    const script = MTA.demoScriptFor(pair);
    assert.equal(script.length, 3, pair + ' should seed exactly 3 sentences');
    for (const line of script) {
      const out = MTA.lookupDemo('en', pair.slice(3), line.from);
      assert.equal(out, line.to, pair + ': ' + line.from);
      assert.ok(out.length > 0);
    }
  }
});

test('demo cache: reverse direction works (Hindi/Spanish/French back to English)', () => {
  assert.equal(MTA.lookupDemo('hi', 'en', 'सुप्रभात, अगले तिमाही के बजट से शुरू करते हैं।'),
    "Good morning, let's start with the budget for next quarter.");
  assert.equal(MTA.lookupDemo('es', 'en', 'Buenos días, empecemos con el presupuesto del próximo trimestre.'),
    "Good morning, let's start with the budget for next quarter.");
  assert.equal(MTA.lookupDemo('fr', 'en', 'Bonjour, commençons par le budget du prochain trimestre.'),
    "Good morning, let's start with the budget for next quarter.");
});

test('demo cache: normalisation tolerates case, extra spaces and trailing punctuation', () => {
  const out = MTA.lookupDemo('en', 'hi', '  THE LAUNCH DATE MOVES TO FRIDAY, AND THE TEAM IS READY... ');
  assert.equal(out, 'लॉन्च की तारीख शुक्रवार हो गई है, और टीम तैयार है।');
});

test('demo cache: unseeded sentences return null — never a fake translation', () => {
  assert.equal(MTA.lookupDemo('en', 'hi', 'The quarterly report is due on Tuesday.'), null);
  assert.equal(MTA.lookupDemo('en', 'es', 'Hello there'), null);
  assert.equal(MTA.lookupDemo('en', 'hi', ''), null);
});

test('latency: format and average', () => {
  assert.equal(MTA.formatLatency(null), '~4 s');
  assert.equal(MTA.formatLatency(4200), '4.2 s');
  assert.equal(MTA.formatLatency(12500), '13 s');
  assert.equal(MTA.averageLatencyMs([]), null);
  assert.equal(MTA.averageLatencyMs([{ latencyMs: 3800 }, { latencyMs: 4200 }]), 4000);
  assert.equal(MTA.latencyBadgeText([]), '~4 s per sentence');
  assert.equal(MTA.latencyBadgeText([{ latencyMs: 5100 }]), '5.1 s per sentence');
});

test('mouth: amplitude mapping rests closed below the noise floor', () => {
  assert.equal(MTA.mouthOpenFromLevel(0), 0);
  assert.equal(MTA.mouthOpenFromLevel(0.05), 0);
  assert.ok(MTA.mouthOpenFromLevel(0.4) > 0.4 && MTA.mouthOpenFromLevel(0.4) < 0.6);
  assert.equal(MTA.mouthOpenFromLevel(1), 1);
  assert.equal(MTA.mouthOpenFromLevel(2), 1);
});

test('mouth: speech envelope is 0 outside the utterance and peaks mid-speech', () => {
  assert.equal(MTA.speechEnvelopeAt(-10, 2000), 0);
  assert.equal(MTA.speechEnvelopeAt(2000, 2000), 0);
  assert.ok(MTA.speechEnvelopeAt(1000, 2000) > 0.3);
  assert.ok(MTA.speechEnvelopeAt(100, 2000) < MTA.speechEnvelopeAt(1000, 2000));
});

test('speech duration estimate scales with words and rate', () => {
  const short = MTA.estimateSpeechMs('Hello there.', 1);
  const long = MTA.estimateSpeechMs('Good morning, let us start with the budget for next quarter and the launch plan.', 1);
  assert.ok(long > short);
  assert.ok(MTA.estimateSpeechMs('Hello there.', 0.5) > short);
  assert.ok(MTA.estimateSpeechMs('', 1) >= 900);
});

test('Gemini request: correct model, endpoint and prompt shape', () => {
  assert.equal(MTA.GEMINI_MODEL, 'gemini-2.5-flash');
  assert.ok(MTA.GEMINI_ENDPOINT.includes('gemini-2.5-flash'));
  const req = MTA.geminiRequest('en', 'hi', 'Hello.');
  assert.ok(req.body.contents[0].parts[0].text.includes('Hindi'));
  assert.ok(req.body.contents[0].parts[0].text.includes('Hello.'));
  assert.ok(req.body.contents[0].parts[0].text.includes('only the translation'));
  assert.equal(req.body.generationConfig.temperature, 0.2);
  const parsed = MTA.parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'नमस्ते।' }] } }] });
  assert.equal(parsed, 'नमस्ते।');
  assert.equal(MTA.parseGeminiResponse({}), null);
  assert.equal(MTA.parseGeminiResponse({ candidates: [] }), null);
});

test('settings validation clamps bad input', () => {
  assert.deepEqual(MTA.validateSettings(null), { geminiKey: '', rate: 1, captionsOnly: false, voiceURI: null });
  const v = MTA.validateSettings({ geminiKey: '  key123 ', rate: 9, captionsOnly: true, voiceURI: 'x' });
  assert.equal(v.geminiKey, 'key123');
  assert.equal(v.rate, 1); // out of range resets to 1
  assert.equal(v.captionsOnly, true);
});

test('transcript builders include both languages, source and latency', () => {
  const turns = [{
    at: Date.parse('2026-11-23T10:00:00+05:30'), fromName: 'Maya', toName: 'Arjun',
    fromLang: 'en', toLang: 'hi', original: 'Hello.', translated: 'नमस्ते।',
    source: 'demo-cache', latencyMs: 4100, status: 'done', error: null
  }];
  const txt = MTA.buildTranscriptText(turns, 'English ↔ Hindi');
  assert.ok(txt.includes('Hello.'));
  assert.ok(txt.includes('नमस्ते।'));
  assert.ok(txt.includes('demo-cache'));
  assert.ok(txt.includes('4.1 s'));
  const json = JSON.parse(MTA.buildTranscriptJson(turns));
  assert.equal(json.app, 'meeting-translator-avatars');
  assert.equal(json.turns.length, 1);
});

test('contrast: berry on paper and white on berry both pass WCAG AA', () => {
  const berryOnPaper = MTA.contrastRatio('#9D174D', '#FBF7F4');
  const whiteOnBerry = MTA.contrastRatio('#FFFFFF', '#9D174D');
  const inkOnPaper = MTA.contrastRatio('#221A1E', '#FBF7F4');
  assert.ok(berryOnPaper >= 4.5, 'berry on paper ' + berryOnPaper.toFixed(2));
  assert.ok(whiteOnBerry >= 4.5, 'white on berry ' + whiteOnBerry.toFixed(2));
  assert.ok(inkOnPaper >= 7, 'ink on paper ' + inkOnPaper.toFixed(2));
});

test('language metadata covers all three pairs', () => {
  assert.deepEqual(Object.keys(MTA.PAIRS).sort(), ['en-es', 'en-fr', 'en-hi']);
  for (const code of ['en', 'hi', 'es', 'fr']) {
    assert.ok(MTA.LANGS[code].bcp47);
    assert.ok(MTA.LANGS[code].label);
  }
});
