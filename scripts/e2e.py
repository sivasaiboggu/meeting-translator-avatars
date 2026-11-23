#!/usr/bin/env python3
"""End-to-end smoke test: typed demo sentence -> translated turn in transcript.
Uses CDP (same Chrome setup as scripts/shot.py). Captions-only mode so no TTS
is needed in headless Chrome."""
import base64, hashlib, json, os, subprocess, sys, time, urllib.request
import websocket

CHROME = "/opt/meta-chromium/chrome"
HERE = os.path.dirname(os.path.abspath(__file__))
POLICY = os.path.join(HERE, "webgl-policy.txt")
URL = "file:///home/hatch/workspace/projects/hackathon/meeting-translator-avatars/index.html"

def sha256(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

port = 9381
proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
    "--user-data-dir=/tmp/cdp-profile-mta-e2e", "--remote-debugging-port=%d" % port,
    "--hatch-webgl-allowed-domains-file=" + POLICY,
    "--hatch-webgl-allowed-domains-sha256=" + sha256(POLICY),
    "--hide-scrollbars", "about:blank"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    ws_url = None
    for _ in range(60):
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/json/list" % port, timeout=2) as r:
                targets = json.load(r)
            page = next(t for t in targets if t.get("type") == "page")
            ws_url = page["webSocketDebuggerUrl"]
            break
        except Exception:
            time.sleep(0.5)
    assert ws_url, "DevTools endpoint never came up"
    ws = [None]
    mid = [0]
    def connect():
        ws[0] = websocket.create_connection(ws_url, timeout=30)
        mid[0] = 0
    connect()
    def send(method, params=None):
        for attempt in range(3):
            try:
                mid[0] += 1
                ws[0].send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
                while True:
                    msg = json.loads(ws[0].recv())
                    if msg.get("id") == mid[0]:
                        if "error" in msg: raise SystemExit("CDP error %s: %s" % (method, msg["error"]))
                        return msg.get("result", {})
            except SystemExit:
                raise
            except Exception as e:
                print("ws dropped during %s, reconnecting (%s)" % (method, e))
                time.sleep(1)
                connect()
        raise SystemExit("ws kept dropping during " + method)
    def ev(expr):
        r = send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        if "exceptionDetails" in r: raise SystemExit("JS error: %s" % r["exceptionDetails"])
        return r["result"]["value"]
    print("step: settings")
    send("Page.enable"); send("Runtime.enable")
    send("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
    send("Page.navigate", {"url": URL})
    time.sleep(3)
    # captions-only so the turn completes without TTS in headless Chrome;
    # set settings, then re-navigate via CDP (a JS reload drops the websocket)
    ev("localStorage.setItem('mta.settings.v1', JSON.stringify({geminiKey:'', rate:1, captionsOnly:true, voiceURI:null})); 'saved'")
    send("Page.navigate", {"url": URL})
    time.sleep(3)
    # 1) typed demo sentence (in cache) -> turn appears, Hindi translation present
    ev("document.getElementById('typedInput').value = \"Good morning, let's start with the budget for next quarter.\"; document.getElementById('sendTypedBtn').click(); 'sent'")
    time.sleep(6)
    turns = ev("document.querySelectorAll('.turn').length")
    body = ev("document.getElementById('turns').textContent")
    badge = ev("document.getElementById('latencyBadge').innerText")
    print("turns after demo sentence:", turns)
    print("badge:", badge)
    assert turns == 1, "expected 1 turn, got %s" % turns
    assert "सुप्रभात" in body, "Hindi translation missing from transcript"
    assert "Demo cache" in body, "source tag missing"
    # 2) unseeded sentence with no key -> honest failure, no fake translation
    ev("document.getElementById('typedInput').value = 'The quarterly report is due on Tuesday.'; document.getElementById('sendTypedBtn').click(); 'sent'")
    time.sleep(4)
    turns2 = ev("document.querySelectorAll('.turn').length")
    body2 = ev("document.getElementById('turns').textContent")
    print("turns after unseeded sentence:", turns2)
    assert turns2 == 2, "expected 2 turns, got %s" % turns2
    assert "No translation for this sentence without a key" in body2, "honest no-key message missing"
    # 3) swap direction + pair switch relabels panes
    ev("document.getElementById('swapBtn').click(); document.getElementById('pairSelect').value='en-es'; document.getElementById('pairSelect').dispatchEvent(new Event('change')); 'swapped'")
    time.sleep(0.5)
    direction = ev("document.getElementById('directionLine').innerText")
    print("direction after swap+pair change:", direction)
    assert "Spanish" in direction, "pair switch did not relabel: %s" % direction
    shot = send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
    open("/home/hatch/workspace/projects/hackathon/meeting-translator-avatars/screenshots/desktop-after-turns.png", "wb").write(base64.b64decode(shot["data"]))
    print("E2E OK: typed demo turn translated, unseeded sentence refused honestly, swap/pair work")
    ws[0].close()
finally:
    proc.terminate()
    try: proc.wait(timeout=10)
    except Exception: proc.kill()
