// app.js — Meeting Translator with Avatars (DOM wiring).
// Pipeline per turn: listen/type → translate (demo cache, else Gemini with a
// user key) → speak via speechSynthesis → avatar mouth driven by a timed
// envelope (speechSynthesis exposes no audio stream — see README/PLAN).
(function () {
  'use strict';
  var MTA = window.MTA;
  var $ = function (id) { return document.getElementById(id); };

  var LS_SETTINGS = 'mta.settings.v1';
  var LS_TRANSCRIPT = 'mta.transcript.v1';

  var state = {
    pair: 'en-hi',
    direction: 'AtoB', // AtoB: A speaks, B hears translation. BtoA: reversed.
    settings: MTA.validateSettings(loadJson(LS_SETTINGS)),
    turns: loadJson(LS_TRANSCRIPT) || [],
    speaking: false,
    demoRunning: false,
    recognition: null,
    micStream: null,
    micAnalyser: null,
    micLevel: 0
  };

  var SPEAKERS = {
    A: { name: 'Maya', mouth: $('mouthA'), eyes: $('eyesA'), wrap: $('avatarWrapA'), pane: $('paneA'), status: $('statusA'), dot: $('speakingDotA'), meter: $('meterA'), svg: null },
    B: { name: 'Arjun', mouth: $('mouthB'), eyes: $('eyesB'), wrap: $('avatarWrapB'), pane: $('paneB'), status: $('statusB'), dot: $('speakingDotB'), meter: $('meterB'), svg: null }
  };
  SPEAKERS.A.svg = SPEAKERS.A.wrap.querySelector('.avatar');
  SPEAKERS.B.svg = SPEAKERS.B.wrap.querySelector('.avatar');

  function loadJson(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function saveJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage full/blocked: session still works */ }
  }

  function pairLangs() { return MTA.PAIRS[state.pair]; }
  function speakerLang(side) {
    var p = pairLangs();
    var aLang = state.direction === 'AtoB' ? p.a : p.b;
    var bLang = state.direction === 'AtoB' ? p.b : p.a;
    return side === 'A' ? aLang : bLang;
  }
  function listenerLang(side) { return speakerLang(side === 'A' ? 'B' : 'A'); }

  function refreshLabels() {
    var aLang = speakerLang('A'), bLang = speakerLang('B');
    $('langTagA').textContent = MTA.LANGS[aLang].label;
    $('langTagB').textContent = MTA.LANGS[bLang].label;
    $('directionLine').textContent = 'Maya speaks ' + MTA.LANGS[aLang].label + ' → Arjun hears ' + MTA.LANGS[bLang].label;
    $('arrowLabel').textContent = state.direction === 'AtoB' ? '→' : '←';
    $('typedLabel').textContent = 'Type what Maya says (' + MTA.LANGS[aLang].label + ')';
    $('typedInput').placeholder = 'Type a sentence in ' + MTA.LANGS[aLang].label + ', then press Enter — no mic needed';
    refreshVoiceNote();
  }

  function refreshBadge() {
    $('latencyBadge').textContent = MTA.latencyBadgeText(state.turns);
  }

  function setStatus(side, text) { SPEAKERS[side].status.textContent = text; }
  function setSpeaking(side, on) {
    SPEAKERS[side].pane.classList.toggle('speaking', !!on);
    SPEAKERS[side].dot.hidden = !on;
    if (!on) { setMouth(side, 0); SPEAKERS[side].meter.style.width = '0%'; }
  }

  // --- Avatar animation ---
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setMouth(side, open) {
    var m = SPEAKERS[side].mouth;
    var ry = 2 + open * 11;
    var rx = 14 - open * 3;
    m.setAttribute('ry', ry.toFixed(1));
    m.setAttribute('rx', rx.toFixed(1));
  }
  // Blink loop (skipped under reduce-motion).
  if (!reduceMotion) {
    (function blinkLoop() {
      setTimeout(function () {
        var side = Math.random() < 0.5 ? 'A' : 'B';
        SPEAKERS[side].svg.classList.add('blink');
        setTimeout(function () { SPEAKERS[side].svg.classList.remove('blink'); }, 140);
        blinkLoop();
      }, 2200 + Math.random() * 2600);
    })();
    // Gentle head bob while a side is speaking is handled in speakTranslated.
  }

  // --- Transcript ---
  function renderTranscript() {
    var box = $('turns');
    $('turnCount').textContent = state.turns.length + (state.turns.length === 1 ? ' turn' : ' turns');
    if (!state.turns.length) {
      box.innerHTML = '<p class="empty">Nothing yet. Play the demo script or speak a sentence — every turn lands here with its source and its latency.</p>';
      return;
    }
    box.innerHTML = '';
    state.turns.forEach(function (t) {
      var div = document.createElement('div');
      div.className = 'turn' + (t.status === 'failed' ? ' failed' : '');
      var meta = document.createElement('div');
      meta.className = 'turn-meta';
      var time = new Date(t.at).toLocaleTimeString();
      var tag = document.createElement('span');
      tag.className = 'source-tag' + (t.source === 'gemini' ? ' live' : '');
      tag.textContent = t.source === 'gemini' ? 'Live Gemini' : t.source === 'demo-cache' ? 'Demo cache' : 'Failed';
      meta.appendChild(tag);
      meta.insertAdjacentHTML('beforeend',
        '<span>' + escapeHtml(t.fromName) + ' → ' + escapeHtml(t.toName) + '</span>' +
        '<span>' + time + '</span>' +
        (t.latencyMs != null ? '<span class="lat">Latency ' + MTA.formatLatency(t.latencyMs) + '</span>' : ''));
      var orig = document.createElement('p');
      orig.className = 'orig';
      orig.textContent = t.fromName + ' (' + MTA.LANGS[t.fromLang].label + '): ' + t.original;
      div.appendChild(meta);
      div.appendChild(orig);
      if (t.translated) {
        var tr = document.createElement('p');
        tr.className = 'trans';
        tr.textContent = t.toName + ' (' + MTA.LANGS[t.toLang].label + '): ' + t.translated;
        div.appendChild(tr);
      }
      if (t.error) {
        var er = document.createElement('p');
        er.className = 'error';
        er.textContent = t.error;
        div.appendChild(er);
      }
      box.appendChild(div);
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function addTurn(t) {
    state.turns.push(t);
    saveJson(LS_TRANSCRIPT, state.turns);
    renderTranscript();
    refreshBadge();
  }

  // --- Translation ---
  function translate(fromLang, toLang, text) {
    var cached = MTA.lookupDemo(fromLang, toLang, text);
    if (cached) return Promise.resolve({ text: cached, source: 'demo-cache' });
    var key = state.settings.geminiKey;
    if (!key) {
      return Promise.resolve({ text: null, source: 'none',
        error: 'No translation for this sentence without a key. Add a free Gemini API key in Settings — the three demo sentences are the only ones that translate without one.' });
    }
    var req = MTA.geminiRequest(fromLang, toLang, text);
    if (!req) {
      return Promise.resolve({ text: null, source: 'none',
        error: 'That language pair is not supported — the app translates English with Hindi, Spanish or French.' });
    }
    return fetch(req.url + '?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    }).then(function (res) {
      if (!res.ok) throw new Error('Gemini returned HTTP ' + res.status + '. Check the key, or the free-tier quota for today.');
      return res.json();
    }).then(function (json) {
      var out = MTA.parseGeminiResponse(json);
      if (!out) throw new Error('Gemini returned an empty translation.');
      return { text: out, source: 'gemini' };
    }).catch(function (err) {
      return { text: null, source: 'failed', error: 'Translation failed: ' + err.message };
    });
  }

  // --- Speech output (browser TTS) with amplitude-style mouth envelope ---
  function speakTranslated(side, text, lang) {
    return new Promise(function (resolve) {
      if (state.settings.captionsOnly || !('speechSynthesis' in window)) {
        var ms = MTA.estimateSpeechMs(text, state.settings.rate);
        animateMouthFor(side, ms);
        setTimeout(resolve, Math.min(ms, 2500));
        return;
      }
      var utter = new SpeechSynthesisUtterance(text);
      utter.lang = MTA.LANGS[lang].bcp47;
      utter.rate = state.settings.rate;
      var voice = pickVoice(lang);
      if (voice) utter.voice = voice;
      var dur = MTA.estimateSpeechMs(text, state.settings.rate);
      var started = Date.now();
      var timer = setInterval(function () {
        var open = MTA.speechEnvelopeAt(Date.now() - started, dur);
        setMouth(side, open);
        SPEAKERS[side].meter.style.width = Math.round(open * 100) + '%';
      }, 60);
      var done = false;
      function finish() {
        if (done) return; done = true;
        clearInterval(timer); setMouth(side, 0);
        SPEAKERS[side].meter.style.width = '0%';
        resolve();
      }
      utter.onend = finish;
      utter.onerror = finish;
      window.speechSynthesis.speak(utter);
      setTimeout(finish, dur + 4000); // safety net if onend never fires
    });
  }
  function animateMouthFor(side, ms) {
    var started = Date.now();
    var timer = setInterval(function () {
      var open = MTA.speechEnvelopeAt(Date.now() - started, ms);
      setMouth(side, open);
      SPEAKERS[side].meter.style.width = Math.round(open * 100) + '%';
      if (Date.now() - started >= ms) { clearInterval(timer); setMouth(side, 0); SPEAKERS[side].meter.style.width = '0%'; }
    }, 60);
  }
  function pickVoice(lang) {
    var voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    var want = MTA.LANGS[lang].voiceLangs;
    if (state.settings.voiceURI) {
      var chosen = voices.find(function (v) { return v.voiceURI === state.settings.voiceURI; });
      if (chosen) return chosen;
    }
    for (var i = 0; i < want.length; i++) {
      var v = voices.find(function (vv) { return (vv.lang || '').toLowerCase().indexOf(want[i].toLowerCase()) === 0; });
      if (v) return v;
    }
    return null;
  }
  function refreshVoiceNote() {
    var lang = listenerLang('A');
    var voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    var has = voices.some(function (v) {
      return MTA.LANGS[lang].voiceLangs.some(function (w) { return (v.lang || '').toLowerCase().indexOf(w.toLowerCase()) === 0; });
    });
    $('voiceNote').textContent = has
      ? 'A ' + MTA.LANGS[lang].label + ' voice is available on this device.'
      : 'No ' + MTA.LANGS[lang].label + ' voice is installed on this device — captions will still work, spoken audio may fall back to another voice.';
    var sel = $('voiceSelect');
    var cur = sel.value;
    sel.innerHTML = '<option value="">System default for the language</option>';
    voices.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.voiceURI; o.textContent = v.name + ' (' + v.lang + ')';
      sel.appendChild(o);
    });
    sel.value = state.settings.voiceURI || '';
    if (cur && !sel.value) sel.value = '';
  }

  // --- One turn, end to end ---
  function runTurn(fromSide, originalText) {
    if (state.speaking) return Promise.resolve(null);
    var toSide = fromSide === 'A' ? 'B' : 'A';
    var fromLang = speakerLang(fromSide), toLang = speakerLang(toSide);
    var fromName = SPEAKERS[fromSide].name, toName = SPEAKERS[toSide].name;
    var startedAt = Date.now();
    state.speaking = true;
    $('stopBtn').disabled = false;
    setSpeaking(fromSide, true);
    setStatus(fromSide, 'Speaking…');
    setStatus(toSide, 'Listening…');
    // Brief beat so the speaker's own line is readable before translation starts.
    return wait(500).then(function () {
      setSpeaking(fromSide, false);
      setStatus(toSide, 'Translating…');
      return translate(fromLang, toLang, originalText);
    }).then(function (result) {
      var latencyMs = Date.now() - startedAt;
      if (!result.text) {
        var turn = { id: uid(), at: Date.now(), from: fromSide, fromName: fromName, toName: toName,
          fromLang: fromLang, toLang: toLang, original: originalText, translated: null,
          source: 'failed', latencyMs: latencyMs, status: 'failed', error: result.error };
        addTurn(turn);
        setStatus(toSide, result.error);
        setStatus(fromSide, 'Ready.');
        state.speaking = false; $('stopBtn').disabled = true;
        return turn;
      }
      var turn2 = { id: uid(), at: Date.now(), from: fromSide, fromName: fromName, toName: toName,
        fromLang: fromLang, toLang: toLang, original: originalText, translated: result.text,
        source: result.source, latencyMs: latencyMs, status: 'speaking', error: null };
      addTurn(turn2);
      setSpeaking(toSide, true);
      setStatus(toSide, 'Speaking the translation…');
      return speakTranslated(toSide, result.text, toLang).then(function () {
        setSpeaking(toSide, false);
        setStatus(toSide, 'Listening for ' + fromName + '.');
        setStatus(fromSide, 'Ready.');
        state.speaking = false; $('stopBtn').disabled = true;
        return turn2;
      });
    });
  }
  function uid() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 't-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // --- Microphone: Web Speech API recognition + live level meter ---
  function recognitionSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }
  function startMic(side) {
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setStatus(side, 'Speech recognition is not in this browser. Type the sentence below instead — it works everywhere.');
      $('typedInput').focus();
      return;
    }
    if (state.speaking || state.recognition) return;
    var rec = new Ctor();
    state.recognition = rec;
    var lang = speakerLang(side);
    rec.lang = MTA.LANGS[lang].bcp47;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    var heard = '';
    var micBtn = side === 'A' ? $('micA') : $('micB');
    micBtn.classList.add('listening');
    micBtn.textContent = 'Listening… tap to stop';
    setStatus(side, 'Listening — speak now.');
    startLevelMeter(side);
    rec.onresult = function (e) {
      var finalText = '', interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      if (finalText) heard = finalText.trim();
      else if (interim) setStatus(side, 'Hearing: "' + interim.trim() + '"');
    };
    rec.onerror = function (e) {
      stopLevelMeter();
      micBtn.classList.remove('listening');
      micBtn.textContent = side === 'A' ? 'Speak as Maya' : 'Speak as Arjun';
      state.recognition = null;
      var msg = 'Mic did not work (' + (e.error || 'unknown error') + '). Type the sentence below instead — it works everywhere.';
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') msg = 'Mic access was blocked. Allow the microphone for this page, or type the sentence below instead.';
      if (e.error === 'network') msg = 'Recognition needs a connection (Chrome sends audio to Google by default). Type the sentence below instead.';
      setStatus(side, msg);
    };
    rec.onend = function () {
      stopLevelMeter();
      micBtn.classList.remove('listening');
      micBtn.textContent = side === 'A' ? 'Speak as Maya' : 'Speak as Arjun';
      state.recognition = null;
      if (heard) runTurn(side, heard);
      else if (!state.speaking) setStatus(side, 'Did not catch that. Try again, or type it below.');
    };
    try { rec.start(); } catch (e) {
      state.recognition = null;
      setStatus(side, 'Could not start the mic (' + e.message + '). Type the sentence below instead.');
    }
    micBtn.onclick = function () {
      try { rec.stop(); } catch (e) { /* already stopped */ }
    };
  }
  function startLevelMeter(side) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      state.micStream = stream;
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var src = ctx.createMediaStreamSource(stream);
      var an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      state.micAnalyser = an;
      var buf = new Uint8Array(an.frequencyBinCount);
      (function tick() {
        if (!state.micAnalyser) return;
        an.getByteTimeDomainData(buf);
        var sum = 0;
        for (var i = 0; i < buf.length; i++) { var d = (buf[i] - 128) / 128; sum += d * d; }
        var level = Math.min(1, Math.sqrt(sum / buf.length) * 3);
        SPEAKERS[side].meter.style.width = Math.round(level * 100) + '%';
        setMouth(side, MTA.mouthOpenFromLevel(level));
        requestAnimationFrame(tick);
      })();
    }).catch(function () { /* meter is optional; recognition still works */ });
  }
  function stopLevelMeter() {
    state.micAnalyser = null;
    if (state.micStream) { state.micStream.getTracks().forEach(function (t) { t.stop(); }); state.micStream = null; }
    setMouth('A', 0); setMouth('B', 0);
    SPEAKERS.A.meter.style.width = '0%'; SPEAKERS.B.meter.style.width = '0%';
  }

  // --- Demo script ---
  function playDemo() {
    if (state.demoRunning || state.speaking) return;
    state.demoRunning = true;
    $('demoBtn').disabled = true;
    var script = MTA.demoScriptFor(state.pair);
    var chain = Promise.resolve();
    script.forEach(function (line) {
      chain = chain.then(function () { return runTurn('A', line.from); }).then(function () { return wait(700); });
    });
    chain.then(function () {
      state.demoRunning = false;
      $('demoBtn').disabled = false;
      setStatus('A', 'Demo script done. Speak, or type a sentence to try a live turn.');
    });
  }

  // --- Settings ---
  function refreshKeyStatus() {
    var el = $('keyStatus');
    if (state.settings.geminiKey) {
      el.textContent = 'Key saved (in this browser only). Unseeded sentences now translate live via Gemini ' + MTA.GEMINI_MODEL + '.';
      el.classList.add('ok');
    } else {
      el.textContent = 'No key saved. Without a key, only the three demo sentences translate.';
      el.classList.remove('ok');
    }
  }

  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // --- Wire up ---
  $('settingsBtn').addEventListener('click', function () {
    var panel = $('settingsPanel');
    var open = panel.hidden;
    panel.hidden = !open;
    this.setAttribute('aria-expanded', String(open));
  });
  $('saveKeyBtn').addEventListener('click', function () {
    state.settings.geminiKey = $('geminiKey').value.trim();
    saveJson(LS_SETTINGS, state.settings);
    $('geminiKey').value = '';
    refreshKeyStatus();
  });
  $('removeKeyBtn').addEventListener('click', function () {
    state.settings.geminiKey = '';
    saveJson(LS_SETTINGS, state.settings);
    $('geminiKey').value = '';
    refreshKeyStatus();
  });
  $('rateRange').addEventListener('input', function () {
    state.settings.rate = parseFloat(this.value);
    $('rateValue').textContent = state.settings.rate.toFixed(1) + '×';
    saveJson(LS_SETTINGS, state.settings);
  });
  $('captionsOnly').addEventListener('change', function () {
    state.settings.captionsOnly = this.checked;
    saveJson(LS_SETTINGS, state.settings);
  });
  $('voiceSelect').addEventListener('change', function () {
    state.settings.voiceURI = this.value || null;
    saveJson(LS_SETTINGS, state.settings);
  });
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = refreshVoiceNote;
  }
  $('pairSelect').addEventListener('change', function () {
    state.pair = this.value;
    refreshLabels();
  });
  $('swapBtn').addEventListener('click', function () {
    state.direction = state.direction === 'AtoB' ? 'BtoA' : 'AtoB';
    refreshLabels();
    setStatus('A', 'Ready.');
    setStatus('B', 'Listening.');
  });
  $('stopBtn').addEventListener('click', function () {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (state.recognition) { try { state.recognition.stop(); } catch (e) {} }
    state.speaking = false; state.demoRunning = false;
    $('demoBtn').disabled = false;
    this.disabled = true;
    setSpeaking('A', false); setSpeaking('B', false);
    setStatus('A', 'Stopped. Ready.'); setStatus('B', 'Stopped. Ready.');
  });
  $('demoBtn').addEventListener('click', playDemo);
  $('micA').addEventListener('click', function () { startMic('A'); });
  $('micB').addEventListener('click', function () { startMic('B'); });

  function sendTyped() {
    var text = $('typedInput').value.trim();
    if (!text) return;
    $('typedInput').value = '';
    runTurn('A', text);
  }
  $('sendTypedBtn').addEventListener('click', sendTyped);
  $('typedInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendTyped();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.speaking) $('stopBtn').click();
  });

  $('copyBtn').addEventListener('click', function () {
    var label = 'English ↔ ' + MTA.LANGS[pairLangs().b].label;
    var text = MTA.buildTranscriptText(state.turns, label);
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    this.textContent = 'Copied';
    var btn = this;
    setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
  });
  $('downloadTxtBtn').addEventListener('click', function () {
    var label = 'English ↔ ' + MTA.LANGS[pairLangs().b].label;
    download('meeting-transcript.txt', MTA.buildTranscriptText(state.turns, label));
  });
  $('downloadJsonBtn').addEventListener('click', function () {
    download('meeting-transcript.json', MTA.buildTranscriptJson(state.turns), 'application/json');
  });
  $('clearBtn').addEventListener('click', function () {
    state.turns = [];
    saveJson(LS_TRANSCRIPT, state.turns);
    renderTranscript();
    refreshBadge();
  });

  // Init
  $('pairSelect').value = state.pair;
  $('rateRange').value = String(state.settings.rate);
  $('rateValue').textContent = state.settings.rate.toFixed(1) + '×';
  $('captionsOnly').checked = state.settings.captionsOnly;
  refreshLabels();
  refreshKeyStatus();
  renderTranscript();
  refreshBadge();
  refreshVoiceNote();
  if (!recognitionSupported()) {
    $('composerNote').textContent = 'Speech recognition is not in this browser (it needs Chrome, Edge or Safari). Typed sentences work everywhere — type below and press Enter.';
  }
})();
