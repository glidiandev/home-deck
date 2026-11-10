// Characterization tests for the overlay focus layers: after every close path the deck's baseline focus set is
// back (invariant a), and while a pop-up is open only the top layer is focusable (invariant b).
// Usage: node tools/test-focus-layers.mjs   (set CHROME to the Chrome binary; needs Node 22+)
//
// Preview-mode limits (the test runs index.html?nosetup, so NATIVE is undefined):
//   - voice()  shows the canned "coming later" message instead of listening (see voice())
//   - the `del` options row only toasts, nothing is uninstalled (runOpt's `del` branch)
//   - incoming() is driven by the `a` key as a stand-in for a real HDMI signal event
//   - NATIVE.on(...) callbacks (resume/home/inputs, the NATIVE.on block after the key handlers) never fire, so no external input changes happen
import { createServer } from 'node:http';
import { createReadStream, mkdtempSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const WWW = fileURLToPath(new URL('../app/src/main/assets/www/', import.meta.url));
const CHROME = process.env.CHROME || 'google-chrome';
const PORT = 9336;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = createServer((req, res) => {
  const p = normalize(join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!p.startsWith(WWW)) { res.writeHead(403).end(); return; }
  stat(p).then(s => { if (!s.isFile()) throw 0; res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); createReadStream(p).pipe(res); },
    () => res.writeHead(404).end());
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const dir = mkdtempSync(join(tmpdir(), 'focus-layers-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
let ws, code = 1;
const close = async () => {
  try { ws?.close(); } catch {}
  chrome.kill('SIGKILL');
  await new Promise(r => server.close(r));
};

// known quirks on main: printed as XFAIL and not counted as failures; XPASS means the quirk went away, so look
const XFAIL = {
  'extras-Jump:open': 'one-row Extras: Up/Down sets cur = null and TV.focus no-ops on the same row (index.html:1994)',
};
let pass = 0, fail = 0, xfail = 0, xpass = 0;
// one line per case; detail is a compact key/value string
const report = (id, ok, detail) => {
  const why = XFAIL[id];
  if (why) { if (ok) xpass++; else xfail++; console.log(`${ok ? 'XPASS' : 'XFAIL'} ${id} ${detail} (known quirk: ${why})`); return; }
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`);
};

try {
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(p => p.type === 'page'); } catch {}
    if (!page) await sleep(150);
  }
  if (!page) throw new Error('Chrome did not come up');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const run = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const key = async (k, hold = 0) => {
    const printable = k.length === 1;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...(printable ? { text: k } : {}), key: k, code: k, windowsVirtualKeyCode: k === 'Enter' ? 13 : k === 'ArrowUp' ? 38 : k === 'ArrowDown' ? 40 : k === 'ArrowRight' ? 39 : k === 'ArrowLeft' ? 37 : 0 });
    if (hold) await sleep(hold);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k });
  };

  await send('Page.navigate', { url: base + 'index.html?nosetup' });
  await sleep(2500);

  // ---- helpers evaluated in the page ----------------------------------------------------------------
  const SNAP = `(() => ({ tabs: document.querySelectorAll('.hd-tab[data-f]').length,
    help: $('helpBtn').hasAttribute('data-f'), jump: $('jumpBtn').hasAttribute('data-f'), play: $('rPlay').hasAttribute('data-f'),
    live: $('live').hasAttribute('data-f'),
    tiles: document.querySelectorAll('.section:not(.is-off) [data-fi][data-f]').length,
    trapped, saved: saved.length, open: [jumpOpen && 'jump', optsOpen && 'opts', infoOpen && 'info', searchOpen && 'search', setupOpen && 'setup', kbdOpen && 'kbd', extrasOpen && 'extras', callOpen && 'call', moving && 'move'].filter(Boolean).join(',') || '-', cur: cur ? (cur.dataset.app ?? cur.dataset.port ?? cur.dataset.tab ?? cur.tagName) : null }))()`;
  const STRAY = `(() => { const box = cur && cur.closest('${'%BOX%'}');
    return [...document.querySelectorAll('.stage [data-f]')].filter(el => !box || !box.contains(el)).length; })()`;
  const CUR_IN = `(() => { const box = cur && cur.closest('${'%BOX%'}'); return !!box; })()`;

  const baseline = await run(SNAP);
  // the overlay stack, as ids: '' when nothing is open
  const stack = () => run(`popups.map(l => l.id).join(',') || '-'`);
  const stackIs = async (id, want) => { const got = await stack(); report(id, got === want, `stack=${got}`); };

  // the D-pad still reaches the deck: Right from the Home tab lands on the Apps tab (the key handler falls through to edgeMove/vertMove)
  const dpad = async () => {
    await run(`TV.focus(document.querySelector('[data-tab="0"]'))`);
    await sleep(120);
    await key('ArrowRight'); await sleep(200);
    const tab = await run(`cur?.dataset.tab ?? null`);
    // go back to the Home tab so the next case starts from the same section as the baseline
    await key('ArrowLeft'); await sleep(200);
    return tab;
  };

  // invariant (a): the deck baseline is back after a close path
  const closed = async (caseId) => {
    await sleep(300);
    const s = await run(SNAP);
    const tab = await dpad();
    const ok = s.open === '-' && s.trapped === false && s.saved === 0 && s.tabs === baseline.tabs && s.tiles === baseline.tiles &&
      s.help === baseline.help && s.jump === baseline.jump && s.play === baseline.play && s.live === baseline.live && tab === '1';
    report(caseId + ':closed', ok, `open=${s.open} trapped=${s.trapped} saved=${s.saved} tabs ${s.tabs}/${baseline.tabs} tiles ${s.tiles}/${baseline.tiles} help=${s.help} jump=${s.jump} play=${s.play} live=${s.live} right->${tab}`);
    return ok;
  };

  // invariant (b): every [data-f] in the stage is inside the top pop-up, and arrows/Enter keep cur inside it
  const openLayer = async (caseId, boxSelector, extra = '') => {
    await sleep(300);
    const stray = await run(STRAY.replace('%BOX%', boxSelector));
    await key('ArrowDown'); await sleep(120);
    await key('ArrowUp'); await sleep(120);
    await key('ArrowRight'); await sleep(120);
    const inside = await run(CUR_IN.replace('%BOX%', boxSelector));
    const info = await run(`(() => ({ trapped, f: document.querySelectorAll('.stage [data-f]').length }))()`);
    const ok = stray === 0 && inside === true && info.f >= 1 && info.trapped === true;
    report(caseId + ':open', ok, `stray=${stray} curIn=${inside} f=${info.f} trapped=${info.trapped}${extra}`);
    return ok;
  };


  // ---- Jump To ---------------------------------------------------------------------------------------
  // open via `j` (the key handler's shortcuts) and openJump()
  await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
  await sleep(150);
  await key('j'); await sleep(350);
  const jOpen = await run(`({ jumpOpen, trapped })`);
  const jStack = await run(`({ n: popups.length, top: topPopup()?.id ?? null, is: isOpen('jump'), jo: jumpOpen })`);
  report('jump-stack:open', jStack.n === 1 && jStack.top === 'jump' && jStack.is === true && jStack.jo === true, `n=${jStack.n} top=${jStack.top} isOpen=${jStack.is} jumpOpen=${jStack.jo}`);
  await openLayer('jump-J', '.jump', ` jumpOpen=${jOpen.jumpOpen}`);
  await key('Escape'); await sleep(250);
  const jClosedStack = await run(`({ n: popups.length, top: topPopup()?.id ?? null, is: isOpen('jump'), jo: jumpOpen })`);
  report('jump-stack:closed', jClosedStack.n === 0 && jClosedStack.top === null && jClosedStack.is === false && jClosedStack.jo === false, `n=${jClosedStack.n} top=${jClosedStack.top} isOpen=${jClosedStack.is} jumpOpen=${jClosedStack.jo}`);
  await closed('jump-J');

  // a long Back opens it: the test holds Back 700 ms, past the escTimer hold in the keydown handler (a short Back is keyup backUp())
  await key('Backspace', 700); await sleep(350);
  const bOpen = await run(`({ jumpOpen, trapped })`);
  await openLayer('jump-Back', '.jump', ` jumpOpen=${bOpen.jumpOpen}`);
  await key('Escape'); await sleep(250);
  await closed('jump-Back');

  // ---- options via long OK on an app tile (keydown holdTimer -> openOpts()) ----------------------------------
  const openOptsOnTile = async () => {
    await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
    await sleep(150);
    await key('Enter', 700); await sleep(300);
    return run(`({ optsOpen, trapped, label: cur?.dataset.opt ?? null })`);
  };

  let o = await openOptsOnTile();
  const optsLayerOk = await openLayer('opts-longOK', '.opts', ` optsOpen=${o.optsOpen}`);
  // outside click closes it (the stage click handler)
  await run(`(() => { const ev = new MouseEvent('click', { bubbles: true }); document.querySelector('.stage').dispatchEvent(ev); })()`);
  await closed('opts-longOK');

  // `o` key (the key handler's shortcuts) plus Back (its Options branch)
  await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
  await sleep(150);
  await key('o'); await sleep(300);
  o = await run(`({ optsOpen, trapped })`);
  await openLayer('opts-o-key', '.opts', ` optsOpen=${o.optsOpen}`);
  await stackIs('opts-o-key:stack-open', 'opts');
  await key('Backspace'); await sleep(250);
  await stackIs('opts-o-key:stack-closed', '-');
  await closed('opts-o-key');

  // ---- opts -> info (nested) -------------------------------------------------------------------------
  await openOptsOnTile();
  await run(`(() => { const items = [...oList.querySelectorAll('[data-opt]')]; const i = items.findIndex(e => e.dataset.opt === 'info');
    if (i >= 0) { cur = null; TV.focus(items[i]); } return i; })()`);
  await sleep(150);
  await key('Enter'); await sleep(350);
  const iOpen = await run(`({ infoOpen, trapped })`);
  await openLayer('info-after-opts', '#info', ` infoOpen=${iOpen.infoOpen}`);
  await stackIs('info-after-opts:stack-open', 'info');
  await key('Backspace'); await sleep(300);
  await stackIs('info-after-opts:stack-closed', '-');
  await closed('info-after-opts');

  // ---- pin (BUG A is fixed on main: runOpt's pin/move branch restores the baseline manually) ---------
  await openOptsOnTile();
  const pinStep = await run(`(() => { const items = [...oList.querySelectorAll('[data-opt]')]; const i = items.findIndex(e => e.dataset.opt === 'pin');
    if (i >= 0) { cur = null; TV.focus(items[i]); } return i; })()`);
  await sleep(150);
  // favs is a fixed list of slots: Pin fills a null slot with the app, Unpin sets its slot back to null
  const pinApp = await run(`optsFor?.app ?? null`);
  const favsBefore = await run(`favs.includes(${pinApp})`);
  await key('Enter'); await sleep(400);
  const favsAfter = await run(`favs.includes(${pinApp})`);
  report('opts-pin:pinned', pinStep >= 0 && pinApp != null && favsAfter !== favsBefore, `row=${pinStep} app=${pinApp} pinned ${favsBefore}->${favsAfter}`);
  await stackIs('opts-pin:stack', '-');
  await closed('opts-pin');

  // ---- move mode: all keys are intercepted while moving (the key handler's move branch) -------------------------------
  await openOptsOnTile();
  const moveStep = await run(`(() => { const items = [...oList.querySelectorAll('[data-opt]')]; const i = items.findIndex(e => e.dataset.opt === 'move');
    if (i >= 0) { cur = null; TV.focus(items[i]); } return i; })()`);
  await sleep(150);
  if (moveStep >= 0) {
    await key('Enter'); await sleep(350);
    const mv = await run(`({ moving: !!moving, trapped })`);
    report('move-mode:open', mv.moving === true, `moving=${mv.moving} trapped=${mv.trapped}`);
    await key('Backspace'); await sleep(300);
    await closed('move-mode');
  } else {
    report('move-mode:open', false, 'no move row in Options');
  }

  // ---- search via `/` (the key handler's shortcuts) ------------------------------------------------
  await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
  await sleep(150);
  await key('/'); await sleep(350);
  const sOpen = await run(`({ searchOpen, trapped })`);
  const sStack = await run(`({ n: popups.length, top: topPopup()?.id ?? null, so: searchOpen })`);
  report('search-stack:open', sStack.n === 1 && sStack.top === 'search' && sStack.so === true, `n=${sStack.n} top=${sStack.top} searchOpen=${sStack.so}`);
  await openLayer('search-slash', '#search', ` searchOpen=${sOpen.searchOpen}`);
  await key('Escape'); await sleep(250);
  const sClosedStack = await run(`({ n: popups.length, so: searchOpen })`);
  report('search-stack:closed', sClosedStack.n === 0 && sClosedStack.so === false, `n=${sClosedStack.n} searchOpen=${sClosedStack.so}`);
  await closed('search-slash');

  // ---- call via `a` (the key handler's shortcuts -> incoming()) ---------------------------------------------------
  await key('a'); await sleep(350);
  const cOpen = await run(`({ callOpen: !$('call').hidden || $('call').classList.contains('on'), trapped })`);
  await openLayer('call', '.call', ` on=${cOpen.callOpen}`);
  await key('Backspace'); await sleep(300);
  await closed('call');

  // ---- setup via run('openSetup()'), closed with Back (the key handler's Setup branch -> closeSetup(false)) ---------
  await run(`openSetup()`);
  await sleep(400);
  const suOpen = await run(`({ setupOpen, trapped })`);
  await openLayer('setup-open', '#setup', ` setupOpen=${suOpen.setupOpen}`);
  await stackIs('setup-open:stack', 'setup');
  await key('Backspace'); await sleep(400);
  await stackIs('setup-Back:stack', '-');
  await closed('setup-Back');

  // ---- setup stepped through with Next until Done (#stNext in the tv:select handler -> setupGo() -> closeSetup(true) at step 4) ---
  await run(`openSetup()`);
  await sleep(400);
  for (let n = 0; n < 4; n++) {
    const st = await run(`({ setupOpen, step, label: $('stNext').textContent })`);
    await openLayer(`setup-step${n}`, '#setup', ` step=${st.step} next=${st.label}`);
    await run(`(() => { cur = null; TV.focus($('stNext')); })()`);
    await sleep(120);
    await key('Enter'); await sleep(400);
  }
  await stackIs('setup-Done:stack', '-');
  await closed('setup-Done');

  // ---- Options name step: a re-render replaces the tile, Back still lands inside #inp on the same port ----
  await run(`TV.focus(document.querySelector('[data-tab="2"]'))`);
  await sleep(300);
  const nameBack = await run(`(() => {
    const tiles = [...document.querySelectorAll('#inp [data-port]')];
    for (const t of tiles) {
      cur = null; TV.focus(t);
      const ev = new KeyboardEvent('keydown', { key: 'o', bubbles: true });
      t.dispatchEvent(ev);
      const o = document.querySelector('#opts');
      if (o && o.classList.contains('on')) {
        const row = oList.querySelector('[data-opt="rename"]');
        if (row) { cur = null; TV.focus(row); return { found: true, port: t.dataset.port, tile: true }; }
        cur = null; TV.focus(t);
        t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      }
    }
    return { found: false, port: null, tile: false };
  })()`);
  await run(`window.__t = document.querySelector('#inp [data-port="${nameBack.port}"]');`);
  await sleep(150);
  await key('ArrowRight'); await sleep(250);
  await key('ArrowLeft'); await sleep(250);
  const nameReRendered = await run(`!window.__t.isConnected`);
  await key('Backspace'); await sleep(300);
  const nameAfter = await run(`({ stack: popups.map(l => l.id).join(',') || '-', inInp: !!cur?.closest('#inp'), port: cur?.dataset.port ?? null, trapped, name: cur?.dataset.port ?? cur?.dataset.name ?? null })`);
  report('opts-name-Back:focus', nameBack.found === true && nameReRendered === true && nameAfter.stack === '-' && nameAfter.inInp === true && nameAfter.port === nameBack.port && nameAfter.trapped === false, `found=${nameBack.found} rerendered=${nameReRendered} stack=${nameAfter.stack} inInp=${nameAfter.inInp} port=${nameAfter.port}/${nameBack.port} trapped=${nameAfter.trapped}`);
  await run(`TV.focus(document.querySelector('[data-tab="0"]'))`);
  await sleep(300);
  await closed('opts-name-Back');

  // ---- setup opened from the Jump button: Back lands on the favorites row (post-renderAll back target) ------
  await run(`cur = null; TV.focus($('jumpBtn')); openSetup();`);
  await sleep(400);
  await key('Backspace'); await sleep(400);
  const suJump = await run(`({ stack: popups.map(l => l.id).join(',') || '-', fav: cur === $('fav').querySelector('[data-fi]') })`);
  report('setup-from-jumpBtn:focus', suJump.stack === '-' && suJump.fav === true, `stack=${suJump.stack} favFocus=${suJump.fav}`);
  await closed('setup-from-jumpBtn');

  // ---- kbd over Options (rename): Escape leaves Options on top with focus inside .opts --------------------
  await openOptsOnTile();
  await run(`openKbd('test', '')`);
  await sleep(350);
  await stackIs('kbd-over-opts:stack-open', 'opts,kbd');
  await key('Escape'); await sleep(300);
  const kOpts = await run(`({ stack: popups.map(l => l.id).join(',') || '-', ko: kbdOpen, oo: optsOpen, inOpts: !!cur?.closest('.opts') })`);
  report('kbd-over-opts:stack-closed', kOpts.stack === 'opts' && kOpts.ko === false && kOpts.oo === true && kOpts.inOpts === true, `stack=${kOpts.stack} kbdOpen=${kOpts.ko} optsOpen=${kOpts.oo} curInOpts=${kOpts.inOpts}`);
  await key('Backspace'); await sleep(300);
  await closed('kbd-over-opts');

  // ---- Extras -> Setup hand-off (extras on the stack, setup step 3 hosts the extras rows) ----------------
  await run(`openExtras()`);
  await sleep(400);
  await stackIs('handoff-extras:stack', 'extras');
  await key('Escape'); await sleep(300);
  await closed('handoff-extras');
  await run(`openSetup()`);
  await sleep(400);
  for (let n = 0; n < 3; n++) {
    await run(`(() => { cur = null; TV.focus($('stNext')); })()`);
    await sleep(120);
    await key('Enter'); await sleep(400);
  }
  const hoStep = await run(`({ step, rows: document.querySelectorAll('#exSetup [data-ex]').length, host: exHost?.id ?? null })`);
  report('handoff-setup-step3', hoStep.step === 3 && hoStep.rows > 0 && hoStep.host === 'exSetup', `step=${hoStep.step} rows=${hoStep.rows} exHost=${hoStep.host}`);
  await run(`(() => { const row = document.querySelector('#exSetup [data-ex="city"]'); if (row) { cur = null; TV.focus(row); } return !!row; })()`);
  await sleep(150);
  await run(`exOk('city')`);
  await sleep(350);
  await stackIs('kbd-over-setup:stack-open', 'setup,kbd');
  await key('Escape'); await sleep(300);
  await run(`redrawEx('unit')`);
  await sleep(250);
  const kSetup = await run(`({ stack: popups.map(l => l.id).join(',') || '-', so: setupOpen, inSetup: !!cur?.closest('#setup'), host: exHost?.id ?? null, rows: exHost ? exHost.querySelectorAll('[data-ex]').length : 0 })`);
  report('kbd-over-setup:stack-closed', kSetup.stack === 'setup' && kSetup.so === true && kSetup.inSetup === true && kSetup.host === 'exSetup' && kSetup.rows > 0, `stack=${kSetup.stack} setupOpen=${kSetup.so} curInSetup=${kSetup.inSetup} exHost=${kSetup.host} rows=${kSetup.rows}`);
  await key('Backspace'); await sleep(400);
  await stackIs('handoff-setup-Back:stack', '-');
  await closed('handoff-setup-Back');

  // ---- kbd over jump (test-sleep-keyboard's recipe) ---------------------------------------------------
  await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
  await sleep(150);
  await key('j'); await sleep(350);
  await run(`(() => { J.row1.i = J.row1.vals.indexOf('Custom…'); drawJump('row1'); })()`);
  await sleep(200);
  await run(`(() => { const items = [...jList.querySelectorAll('.jl')]; const i = items.findIndex(e => e.dataset.jl === 'row1');
    cur = null; TV.focus(items[i]); })()`);
  await key('Enter'); await sleep(400);
  const kOpen = await run(`({ kbdOpen, jumpOpen, trapped })`);
  const kStack = await run(`popups.map(l => l.id).join(',') || '-'`);
  report('kbd-over-jump:stack-open', kStack === 'jump,kbd', `stack=${kStack}`);
  await openLayer('kbd-over-jump', '#kbd', ` kbdOpen=${kOpen.kbdOpen} jumpOpen=${kOpen.jumpOpen}`);
  await key('Escape'); await sleep(300);
  const stillJump = await run(`({ jumpOpen, trapped, visible: !document.querySelector('.jump')?.classList.contains('on'), stack: popups.map(l => l.id).join(',') })`);
  const jumpBackOk = stillJump.jumpOpen === true && stillJump.visible === false;
  report('kbd-over-jump:stack', stillJump.stack === 'jump', `stack=${stillJump.stack || '-'}`);
  await key('Escape'); await sleep(300);
  const closedOk = await closed('kbd-over-jump');
  if (closedOk && !jumpBackOk) report('kbd-over-jump-still-open', false, `jumpOpen=${stillJump.jumpOpen}`);

  // ---- kbd over jump closed with its Done button (#kDone in the tv:select handler -> closeKbd(true)): Jump is the top layer again ----
  await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
  await sleep(150);
  await key('j'); await sleep(350);
  await run(`(() => { J.row1.i = J.row1.vals.indexOf('Custom…'); drawJump('row1'); })()`);
  await sleep(200);
  await run(`(() => { const items = [...jList.querySelectorAll('.jl')]; const i = items.findIndex(e => e.dataset.jl === 'row1');
    cur = null; TV.focus(items[i]); })()`);
  await key('Enter'); await sleep(400);
  const kdOpen = await run(`({ kbdOpen, jumpOpen })`);
  await openLayer('kbd-done:open', '#kbd', ` kbdOpen=${kdOpen.kbdOpen} jumpOpen=${kdOpen.jumpOpen}`);
  await key('x'); await sleep(120);
  await run(`(() => { cur = null; TV.focus($('kDone')); })()`);
  await sleep(120);
  await key('Enter'); await sleep(400);
  const kdAfter = await run(`({ kbdOpen, jumpOpen, hidden: $('kbd').hidden })`);
  await openLayer('kbd-done:jump-on-top', '.jump', ` kbdOpen=${kdAfter.kbdOpen} kbdHidden=${kdAfter.hidden} jumpOpen=${kdAfter.jumpOpen}`);
  await key('Escape'); await sleep(300);
  await closed('kbd-done');

  // ---- kbd over extras (synthetic openKbd over extras, extras cannot open over jump) ------------------
  await run(`openExtras()`);
  await sleep(400);
  const exOpen = await run(`({ extrasOpen, trapped })`);
  await run(`openKbd('test', '')`);
  await sleep(350);
  const kOverEx = await run(`({ kbdOpen, extrasOpen, trapped })`);
  const kExStack = await run(`popups.map(l => l.id).join(',') || '-'`);
  report('kbd-over-extras:stack-open', kExStack === 'extras,kbd', `stack=${kExStack}`);
  await openLayer('kbd-over-extras', '#kbd', ` kbdOpen=${kOverEx.kbdOpen} extrasOpen=${kOverEx.extrasOpen}`);
  await key('Escape'); await sleep(300);
  const kExStackClosed = await run(`({ stack: popups.map(l => l.id).join(',') || '-', ko: kbdOpen, eo: extrasOpen })`);
  report('kbd-over-extras:stack-closed', kExStackClosed.stack === 'extras' && kExStackClosed.ko === false && kExStackClosed.eo === true, `stack=${kExStackClosed.stack} kbdOpen=${kExStackClosed.ko} extrasOpen=${kExStackClosed.eo}`);
  await run(`if (extrasOpen) closeExtras()`);
  await closed('kbd-over-extras');

  // ---- extras via the Jump `ext` row (stepJump: closeJump then setTimeout(openExtras)) -----------------
  await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
  await sleep(150);
  await key('j'); await sleep(350);
  const exRow = await run(`(() => { const items = [...jList.querySelectorAll('.jl')]; const i = items.findIndex(e => e.dataset.jl === 'ext');
    if (i >= 0) { cur = null; TV.focus(items[i]); } return i; })()`);
  await sleep(150);
  if (exRow >= 0) {
    await key('Enter'); await sleep(600);
    const exJ = await run(`({ extrasOpen, jumpOpen, trapped })`);
    await openLayer('extras-Jump', '#extras', ` extrasOpen=${exJ.extrasOpen} jumpOpen=${exJ.jumpOpen}`);
    await key('Backspace'); await sleep(350);
    await closed('extras-Jump');
  } else {
    report('extras-Jump', false, `no-ext-row ${JSON.stringify(await run(`({ jumpOpen, trapped, kbdOpen, extrasOpen, rows: [...jList.querySelectorAll('.jl')].map(e => e.dataset.jl).join(',') })`))}`);
  }

  // ---- the away screen closes Extras: after sleep()+wake() it is gone and the deck has its focus back ----
  await run(`openExtras()`);
  await sleep(400);
  const exBefore = await run(`({ extrasOpen, trapped, f: document.querySelectorAll('.stage [data-f]').length })`);
  await run(`sleep()`);
  await sleep(250);
  await run(`wake()`);
  await sleep(300);
  const exAfter = await run(`(() => { const box = document.querySelector('#extras');
    const stray = [...document.querySelectorAll('.stage [data-f]')].filter(el => !box.contains(el)).length;
    return { extrasOpen, trapped, sleeping, f: document.querySelectorAll('.stage [data-f]').length, stray, tabs: document.querySelectorAll('.hd-tab[data-f]').length }; })()`);
  const surviveOk = exBefore.extrasOpen === true && exAfter.extrasOpen === false && exAfter.trapped === false &&
    exAfter.sleeping === false && exAfter.tabs === 3;
  report('sleep-everything', surviveOk, `extrasOpen ${exBefore.extrasOpen}->${exAfter.extrasOpen} trapped=${exAfter.trapped} f=${exAfter.f} stray=${exAfter.stray} tabs=${exAfter.tabs} sleeping=${exAfter.sleeping}`);
  // tidy up so the next run of the harness starts from the deck
  await run(`if (!document.querySelector('#extras').hidden) closeExtras()`);
  await sleep(250);
  await closed('sleep-everything-close');

  // ---- sleep() with kbd over jump: closeAll() closes the keyboard first (top of the stack), then Jump --------------
  await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
  await sleep(150);
  await key('j'); await sleep(350);
  await run(`(() => { J.row1.i = J.row1.vals.indexOf('Custom…'); drawJump('row1'); })()`);
  await sleep(200);
  await run(`(() => { const items = [...jList.querySelectorAll('.jl')]; const i = items.findIndex(e => e.dataset.jl === 'row1');
    cur = null; TV.focus(items[i]); })()`);
  await key('Enter'); await sleep(400);
  const skBefore = await run(`popups.map(l => l.id).join(',') || '-'`);
  await run(`sleep()`);
  await sleep(250);
  await run(`wake()`);
  await sleep(300);
  const skAfter = await run(`({ stack: popups.map(l => l.id).join(',') || '-', ko: kbdOpen, jo: jumpOpen, hidden: $('kbd').hidden })`);
  report('sleep-kbd-over-jump:stack', skBefore === 'jump,kbd' && skAfter.stack === '-' && skAfter.ko === false && skAfter.jo === false && skAfter.hidden === true, `was=${skBefore} now=${skAfter.stack} kbdOpen=${skAfter.ko} jumpOpen=${skAfter.jo} kbdHidden=${skAfter.hidden}`);
  await closed('sleep-kbd-over-jump');

  code = fail === 0 ? 0 : 1;
  console.log(`SUMMARY pass=${pass} fail=${fail} xfail=${xfail} xpass=${xpass} total=${pass + fail + xfail + xpass}`);
} catch (e) {
  console.log('FAIL harness ' + (e?.message || e));
  code = 1;
} finally {
  await close();
}
process.exit(code);
