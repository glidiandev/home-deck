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
  'call-over-move:Back': 'a call during move mode: move mode takes the keys first, so Back ends the move and the call stays open',
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
    trapped: popups.length > 0, saved: (popups[0]?.saved ?? []).length, open: [isOpen('jump') && 'jump', isOpen('opts') && 'opts', isOpen('info') && 'info', isOpen('search') && 'search', isOpen('setup') && 'setup', isOpen('kbd') && 'kbd', isOpen('extras') && 'extras', isOpen('call') && 'call', moving && 'move'].filter(Boolean).join(',') || '-', cur: cur ? (cur.dataset.app ?? cur.dataset.port ?? cur.dataset.tab ?? cur.tagName) : null }))()`;
  const STRAY = `(() => { const box = cur && cur.closest('${'%BOX%'}');
    return [...document.querySelectorAll('.stage [data-f]')].filter(el => !box || !box.contains(el)).length; })()`;
  const CUR_IN = `(() => { const box = cur && cur.closest('${'%BOX%'}'); return !!box; })()`;

  const baseline = await run(SNAP);
  // the old trap code is gone: every pop-up keeps its own saved list on the stack
  const gone = await run(`({ trap: typeof trap, untrap: typeof untrap, trapped: typeof trapped, saved: typeof saved, kbdSaved: typeof kbdSaved, kbdBack: typeof kbdBack, ownSave: 'ownSave' in LAYERS.kbd })`);
  report('old-code-gone', Object.entries(gone).every(([k, v]) => k === 'ownSave' ? v === false : v === 'undefined'), Object.entries(gone).map(([k, v]) => `${k}=${v}`).join(' '));
  // the open-state shims are gone: the key handler and every reader ask the stack (isOpen / topPopup)
  const shims = await run(`['jump', 'search', 'kbd', 'opts', 'info', 'setup', 'extras', 'call'].filter(x => (x + 'Open') in globalThis).join(',') || '-'`);
  report('shims-gone', shims === '-', `left=${shims}`);
  // the keyboard over a pop-up: only its keys take the remote, and closing it lands on the control that opened it
  const kbdOnly = async (caseId) => { const n = await run(`[...document.querySelectorAll('.stage [data-f]')].filter(el => !$('kbd').contains(el)).length`); report(caseId, n === 0, `outsideKbd=${n}`); };
  const kbdBackIs = async (caseId) => { const r = await run(`({ same: cur === window.__kb, opener: !!window.__kb, cur: cur?.dataset.jl ?? cur?.dataset.opt ?? cur?.dataset.ex ?? cur?.id ?? null })`); report(caseId, r.same === true && r.opener === true, `cur=${r.cur} sameAsOpener=${r.same}`); };
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
    const info = await run(`(() => ({ trapped: popups.length > 0, f: document.querySelectorAll('.stage [data-f]').length }))()`);
    const ok = stray === 0 && inside === true && info.f >= 1 && info.trapped === true;
    report(caseId + ':open', ok, `stray=${stray} curIn=${inside} f=${info.f} trapped=${info.trapped}${extra}`);
    return ok;
  };


  // ---- the radio card redrawn while a pop-up is open (drawRadio): its play button stays held by the pop-up ----
  await run(`openJump()`); await sleep(400);
  await run(`drawRadio()`); await sleep(150);
  const rh = await run(`({ stack: popups.map(l => l.id).join(',') || '-', play: $('rPlay').hasAttribute('data-f'), held: popups[0]?.saved?.includes($('rPlay')) ?? null })`);
  report('radio-held', rh.stack === 'jump' && rh.play === false, `stack=${rh.stack} play=${rh.play} held=${rh.held}`);
  await run(`closeJump()`);
  await closed('radio-held');

  // ---- Jump To ---------------------------------------------------------------------------------------
  // open via `j` (the key handler's shortcuts) and openJump()
  await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
  await sleep(150);
  await key('j'); await sleep(350);
  const jOpen = await run(`({ jumpOpen: isOpen('jump'), trapped: popups.length > 0 })`);
  const jStack = await run(`({ n: popups.length, top: topPopup()?.id ?? null, is: isOpen('jump'), jo: isOpen('jump') })`);
  report('jump-stack:open', jStack.n === 1 && jStack.top === 'jump' && jStack.is === true && jStack.jo === true, `n=${jStack.n} top=${jStack.top} isOpen=${jStack.is} jumpOpen=${jStack.jo}`);
  await openLayer('jump-J', '.jump', ` jumpOpen=${jOpen.jumpOpen}`);
  await key('Escape'); await sleep(250);
  const jClosedStack = await run(`({ n: popups.length, top: topPopup()?.id ?? null, is: isOpen('jump'), jo: isOpen('jump') })`);
  report('jump-stack:closed', jClosedStack.n === 0 && jClosedStack.top === null && jClosedStack.is === false && jClosedStack.jo === false, `n=${jClosedStack.n} top=${jClosedStack.top} isOpen=${jClosedStack.is} jumpOpen=${jClosedStack.jo}`);
  await closed('jump-J');

  // a long Back opens it: the test holds Back 700 ms, past the escTimer hold in the keydown handler (a short Back is keyup backUp())
  await key('Backspace', 700); await sleep(350);
  const bOpen = await run(`({ jumpOpen: isOpen('jump'), trapped: popups.length > 0 })`);
  await openLayer('jump-Back', '.jump', ` jumpOpen=${bOpen.jumpOpen}`);
  await key('Escape'); await sleep(250);
  await closed('jump-Back');

  // ---- options via long OK on an app tile (keydown holdTimer -> openOpts()) ----------------------------------
  const openOptsOnTile = async () => {
    await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
    await sleep(150);
    await key('Enter', 700); await sleep(300);
    return run(`({ optsOpen: isOpen('opts'), trapped: popups.length > 0, label: cur?.dataset.opt ?? null })`);
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
  o = await run(`({ optsOpen: isOpen('opts'), trapped: popups.length > 0 })`);
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
  const iOpen = await run(`({ infoOpen: isOpen('info'), trapped: popups.length > 0 })`);
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
    const mv = await run(`({ moving: !!moving, trapped: popups.length > 0 })`);
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
  const sOpen = await run(`({ searchOpen: isOpen('search'), trapped: popups.length > 0 })`);
  const sStack = await run(`({ n: popups.length, top: topPopup()?.id ?? null, so: isOpen('search') })`);
  report('search-stack:open', sStack.n === 1 && sStack.top === 'search' && sStack.so === true, `n=${sStack.n} top=${sStack.top} searchOpen=${sStack.so}`);
  await openLayer('search-slash', '#search', ` searchOpen=${sOpen.searchOpen}`);
  await key('Escape'); await sleep(250);
  const sClosedStack = await run(`({ n: popups.length, so: isOpen('search') })`);
  report('search-stack:closed', sClosedStack.n === 0 && sClosedStack.so === false, `n=${sClosedStack.n} searchOpen=${sClosedStack.so}`);
  await closed('search-slash');

  // ---- call via `a` (the key handler's shortcuts -> incoming()) ---------------------------------------------------
  await key('a'); await sleep(350);
  const cOpen = await run(`({ callOpen: !$('call').hidden || $('call').classList.contains('on'), trapped: popups.length > 0 })`);
  await openLayer('call', '.call', ` on=${cOpen.callOpen}`);
  await stackIs('call-stack:open', 'call');
  await key('Backspace'); await sleep(300);
  await stackIs('call-stack:closed', '-');
  await closed('call');

  // ---- call Accept (OK on callGo in the tv:select handler) and Decline (Right then OK on callNo): focus goes back to the tile ----
  for (const [name, keys] of [['call-Accept', ['Enter']], ['call-Decline', ['ArrowRight', 'Enter']]]) {
    await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
    await sleep(150);
    const tileApp = await run(`cur?.dataset.app ?? null`);
    await key('a'); await sleep(350);
    for (const k of keys) { await key(k); await sleep(200); }
    await sleep(300);
    const ce = await run(`({ stack: popups.map(l => l.id).join(',') || '-', co: isOpen('call'), on: $('call').classList.contains('on'), app: cur?.dataset.app ?? null })`);
    report(`${name}:focus`, ce.stack === '-' && ce.co === false && ce.on === false && ce.app === tileApp, `stack=${ce.stack} callOpen=${ce.co} on=${ce.on} cur=${ce.app} (was ${tileApp})`);
    await run(`endLink()`); await sleep(200);   // Accept switches to the input: the link screen times out by itself after 1.8 s
    await closed(name);
  }

  // ---- a call is refused while any pop-up is open (incoming checks the stack); incoming() is what the TV calls ----
  const REFUSE = [
    ['jump', `openJump()`, `closeJump()`],
    ['search', `openSearch()`, `closeSearch()`],
    ['kbd-over-jump', `(openJump(), openKbd('test', ''))`, `(closeKbd(false), closeJump())`],
    ['opts', null, `closeOpts()`],
    ['info', null, `closeInfo()`],
    ['extras', `openExtras()`, `closeExtras()`],
    ['setup', `openSetup()`, `closeSetup(false)`],
  ];
  for (const [name, open, shut] of REFUSE) {
    if (name === 'opts' || name === 'info') {
      await openOptsOnTile();
      if (name === 'info') {
        await run(`(() => { const r = [...oList.querySelectorAll('[data-opt]')].find(e => e.dataset.opt === 'info'); cur = null; TV.focus(r); })()`);
        await sleep(150); await key('Enter');
      }
    } else await run(open);
    await sleep(400);
    const was = await stack();
    await run(`incoming()`); await sleep(250);
    const rf = await run(`({ stack: popups.map(l => l.id).join(',') || '-', co: isOpen('call'), on: $('call').classList.contains('on'), trapped: popups.length > 0 })`);
    report(`call-refused-${name}`, rf.stack === was && was !== '-' && rf.co === false && rf.on === false && rf.trapped === true, `stack ${was}->${rf.stack} callOpen=${rf.co} on=${rf.on} trapped=${rf.trapped}`);
    await run(shut); await sleep(400);
    await closed(`call-refused-${name}`);
  }

  // ---- the away screen closes an open call (sleep() -> closeAll()) --------------------------
  await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
  await sleep(150);
  await key('a'); await sleep(350);
  await run(`sleep()`); await sleep(250);
  await key('ArrowDown'); await sleep(400);
  const cs = await run(`({ stack: popups.map(l => l.id).join(',') || '-', co: isOpen('call'), sleeping })`);
  report('call-sleep:stack', cs.stack === '-' && cs.co === false && cs.sleeping === false, `stack=${cs.stack} callOpen=${cs.co} sleeping=${cs.sleeping}`);
  await closed('call-sleep');

  // ---- incoming() during the away screen still opens the call (only the native port-update caller skips sleeping);
  //      the first key only wakes, then Back declines --------------------------------------------------------
  await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
  await sleep(150);
  await run(`sleep()`); await sleep(250);
  await run(`incoming()`); await sleep(250);
  const ca1 = await run(`({ stack: popups.map(l => l.id).join(',') || '-', sleeping })`);
  await key('ArrowRight'); await sleep(300);
  const ca2 = await run(`({ stack: popups.map(l => l.id).join(',') || '-', sleeping, go: cur === callGo })`);
  await key('Backspace'); await sleep(300);
  const ca3 = await stack();
  report('call-during-away', ca1.stack === 'call' && ca1.sleeping === true && ca2.stack === 'call' && ca2.sleeping === false && ca2.go === true && ca3 === '-',
    `asleep stack=${ca1.stack} | first key: sleeping=${ca2.sleeping} stack=${ca2.stack} curIsCallGo=${ca2.go} | Back: stack=${ca3}`);
  await closed('call-during-away');

  // ---- call during move mode (move mode takes every key first, in the key handler's move branch): characterization, XFAIL ---------------
  await openOptsOnTile();
  await run(`(() => { const r = [...oList.querySelectorAll('[data-opt]')].find(e => e.dataset.opt === 'move'); cur = null; TV.focus(r); })()`);
  await sleep(150); await key('Enter'); await sleep(350);
  await run(`incoming()`); await sleep(250);
  const cm1 = await run(`({ moving: !!moving, co: isOpen('call') })`);
  await key('Backspace'); await sleep(300);
  const cm2 = await run(`({ moving: !!moving, co: isOpen('call'), stack: popups.map(l => l.id).join(',') || '-' })`);
  report('call-over-move:Back', cm1.moving === true && cm1.co === true && cm2.co === false, `moving=${cm1.moving} callOpen=${cm1.co} | after Back: moving=${cm2.moving} callOpen=${cm2.co} stack=${cm2.stack}`);
  if (cm2.co) { await key('Backspace'); await sleep(300); }   // the second Back declines it
  if (await run(`!!moving`)) { await key('Backspace'); await sleep(300); }
  await closed('call-over-move');

  // ---- setup via run('openSetup()'), closed with Back (the key handler's Setup branch -> closeSetup(false)) ---------
  await run(`openSetup()`);
  await sleep(400);
  const suOpen = await run(`({ setupOpen: isOpen('setup'), trapped: popups.length > 0 })`);
  await openLayer('setup-open', '#setup', ` setupOpen=${suOpen.setupOpen}`);
  await stackIs('setup-open:stack', 'setup');
  await key('Backspace'); await sleep(400);
  await stackIs('setup-Back:stack', '-');
  await closed('setup-Back');

  // ---- setup stepped through with Next until Done (#stNext in the tv:select handler -> setupGo() -> closeSetup(true) at step 4) ---
  await run(`openSetup()`);
  await sleep(400);
  for (let n = 0; n < 4; n++) {
    const st = await run(`({ setupOpen: isOpen('setup'), step, label: $('stNext').textContent })`);
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
  const nh = await run(`({ inp: document.querySelectorAll('#inp [data-f]').length, stray: [...document.querySelectorAll('.stage [data-f]')].filter(el => !el.closest('.opts')).length })`);
  report('opts-rename:held', nh.inp === 0 && nh.stray === 0, `inpFocusable=${nh.inp} outsideOpts=${nh.stray}`);
  await key('Backspace'); await sleep(300);
  const nameAfter = await run(`({ stack: popups.map(l => l.id).join(',') || '-', inInp: !!cur?.closest('#inp'), port: cur?.dataset.port ?? null, trapped: popups.length > 0, name: cur?.dataset.port ?? cur?.dataset.name ?? null })`);
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
  await run(`window.__kb = cur`);
  await run(`openKbd('test', '')`);
  await sleep(350);
  await kbdOnly('kbd-over-opts:only-kbd');
  await stackIs('kbd-over-opts:stack-open', 'opts,kbd');
  await key('Escape'); await sleep(300);
  const kOpts = await run(`({ stack: popups.map(l => l.id).join(',') || '-', ko: isOpen('kbd'), oo: isOpen('opts'), inOpts: !!cur?.closest('.opts') })`);
  await kbdBackIs('kbd-over-opts:back');
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
  await run(`window.__kb = cur`);
  await run(`exOk('city')`);
  await sleep(350);
  await stackIs('kbd-over-setup:stack-open', 'setup,kbd');
  await kbdOnly('kbd-over-setup:only-kbd');
  await key('Escape'); await sleep(300);
  await kbdBackIs('kbd-over-setup:back');
  await run(`redrawEx('unit')`);
  await sleep(250);
  const kSetup = await run(`({ stack: popups.map(l => l.id).join(',') || '-', so: isOpen('setup'), inSetup: !!cur?.closest('#setup'), host: exHost?.id ?? null, rows: exHost ? exHost.querySelectorAll('[data-ex]').length : 0 })`);
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
  // drawJump('row1') already focused row1 in tv.js, so the page's cur is still null: step off it and back to get a real opener
  await run(`(() => { const r = jList.querySelector('[data-jl="row1"]'); TV.focus(jList.querySelector('.jl:not([data-jl="row1"])')); TV.focus(r); })()`);
  await run(`window.__kb = cur`);
  await key('Enter'); await sleep(400);
  const kOpen = await run(`({ kbdOpen: isOpen('kbd'), jumpOpen: isOpen('jump'), trapped: popups.length > 0 })`);
  const kStack = await run(`popups.map(l => l.id).join(',') || '-'`);
  report('kbd-over-jump:stack-open', kStack === 'jump,kbd', `stack=${kStack}`);
  await openLayer('kbd-over-jump', '#kbd', ` kbdOpen=${kOpen.kbdOpen} jumpOpen=${kOpen.jumpOpen}`);
  await key('Escape'); await sleep(300);
  const stillJump = await run(`({ jumpOpen: isOpen('jump'), trapped: popups.length > 0, visible: !document.querySelector('.jump')?.classList.contains('on'), stack: popups.map(l => l.id).join(',') })`);
  await kbdBackIs('kbd-over-jump:back');
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
  const kdOpen = await run(`({ kbdOpen: isOpen('kbd'), jumpOpen: isOpen('jump') })`);
  await openLayer('kbd-done:open', '#kbd', ` kbdOpen=${kdOpen.kbdOpen} jumpOpen=${kdOpen.jumpOpen}`);
  await key('x'); await sleep(120);
  await run(`(() => { cur = null; TV.focus($('kDone')); })()`);
  await sleep(120);
  await key('Enter'); await sleep(400);
  const kdAfter = await run(`({ kbdOpen: isOpen('kbd'), jumpOpen: isOpen('jump'), hidden: $('kbd').hidden })`);
  await openLayer('kbd-done:jump-on-top', '.jump', ` kbdOpen=${kdAfter.kbdOpen} kbdHidden=${kdAfter.hidden} jumpOpen=${kdAfter.jumpOpen}`);
  await key('Escape'); await sleep(300);
  await closed('kbd-done');

  // ---- kbd over extras (synthetic openKbd over extras, extras cannot open over jump) ------------------
  await run(`openExtras()`);
  await sleep(400);
  const exOpen = await run(`({ extrasOpen: isOpen('extras'), trapped: popups.length > 0 })`);
  await run(`window.__kb = cur`);
  await run(`openKbd('test', '')`);
  await sleep(350);
  const kOverEx = await run(`({ kbdOpen: isOpen('kbd'), extrasOpen: isOpen('extras'), trapped: popups.length > 0 })`);
  const kExStack = await run(`popups.map(l => l.id).join(',') || '-'`);
  report('kbd-over-extras:stack-open', kExStack === 'extras,kbd', `stack=${kExStack}`);
  await openLayer('kbd-over-extras', '#kbd', ` kbdOpen=${kOverEx.kbdOpen} extrasOpen=${kOverEx.extrasOpen}`);
  await key('Escape'); await sleep(300);
  const kExStackClosed = await run(`({ stack: popups.map(l => l.id).join(',') || '-', ko: isOpen('kbd'), eo: isOpen('extras') })`);
  await kbdBackIs('kbd-over-extras:back');
  report('kbd-over-extras:stack-closed', kExStackClosed.stack === 'extras' && kExStackClosed.ko === false && kExStackClosed.eo === true, `stack=${kExStackClosed.stack} kbdOpen=${kExStackClosed.ko} extrasOpen=${kExStackClosed.eo}`);
  await run(`if (isOpen('extras')) closeExtras()`);
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
    const exJ = await run(`({ extrasOpen: isOpen('extras'), jumpOpen: isOpen('jump'), trapped: popups.length > 0 })`);
    await openLayer('extras-Jump', '#extras', ` extrasOpen=${exJ.extrasOpen} jumpOpen=${exJ.jumpOpen}`);
    await key('Backspace'); await sleep(350);
    await closed('extras-Jump');
  } else {
    report('extras-Jump', false, `no-ext-row ${JSON.stringify(await run(`({ jumpOpen: isOpen('jump'), trapped: popups.length > 0, kbdOpen: isOpen('kbd'), extrasOpen: isOpen('extras'), rows: [...jList.querySelectorAll('.jl')].map(e => e.dataset.jl).join(',') })`))}`);
  }

  // ---- the away screen closes Extras: after sleep()+wake() it is gone and the deck has its focus back ----
  await run(`openExtras()`);
  await sleep(400);
  const exBefore = await run(`({ extrasOpen: isOpen('extras'), trapped: popups.length > 0, f: document.querySelectorAll('.stage [data-f]').length })`);
  await run(`sleep()`);
  await sleep(250);
  await run(`wake()`);
  await sleep(300);
  const exAfter = await run(`(() => { const box = document.querySelector('#extras');
    const stray = [...document.querySelectorAll('.stage [data-f]')].filter(el => !box.contains(el)).length;
    return { extrasOpen: isOpen('extras'), trapped: popups.length > 0, sleeping, f: document.querySelectorAll('.stage [data-f]').length, stray, tabs: document.querySelectorAll('.hd-tab[data-f]').length }; })()`);
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
  const skAfter = await run(`({ stack: popups.map(l => l.id).join(',') || '-', ko: isOpen('kbd'), jo: isOpen('jump'), hidden: $('kbd').hidden })`);
  report('sleep-kbd-over-jump:stack', skBefore === 'jump,kbd' && skAfter.stack === '-' && skAfter.ko === false && skAfter.jo === false && skAfter.hidden === true, `was=${skBefore} now=${skAfter.stack} kbdOpen=${skAfter.ko} jumpOpen=${skAfter.jo} kbdHidden=${skAfter.hidden}`);
  await closed('sleep-kbd-over-jump');

  // ---- sleep() closes whatever is on the stack, even a pop-up it does not name (closeAll) ------------------
  await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
  await sleep(150);
  const anyBefore = await run(`(() => { const el = document.createElement('div'); el.id = 'probe8'; el.innerHTML = '<button data-f>x</button>';
    document.querySelector('.stage').appendChild(el); const f0 = document.querySelectorAll('.stage [data-f]').length;
    LAYERS.probe8 = { el, onOpen: () => TV.focus(el.firstChild), onClose: () => el.remove() };
    openLayer('probe8'); return { f0, stack: popups.map(l => l.id).join(',') }; })()`);
  await run(`sleep()`);
  await sleep(250);
  await run(`wake()`);
  await sleep(300);
  const anyAfter = await run(`({ stack: popups.map(l => l.id).join(',') || '-', gone: !document.getElementById('probe8'),
    f: document.querySelectorAll('.stage [data-f]').length, deck: !!cur?.closest('.section:not(.is-off)') })`);
  report('sleep-any-layer', anyBefore.stack === 'probe8' && anyAfter.stack === '-' && anyAfter.gone && anyAfter.f === anyBefore.f0 - 1 && anyAfter.deck,
    `was=${anyBefore.stack} now=${anyAfter.stack} gone=${anyAfter.gone} f=${anyBefore.f0 - 1}->${anyAfter.f} deck=${anyAfter.deck}`);
  await run(`(() => { if (isOpen('probe8')) closeLayer('probe8'); delete LAYERS.probe8; })()`);
  await sleep(250);
  await closed('sleep-any-layer');

  // ---- ghost keyboard, kept as is (post-refactor list): a mouse click on a key over Jump still closes Jump under it ----
  await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
  await sleep(150);
  await key('j'); await sleep(350);
  await run(`openKbd('ghost', '', () => {})`); await sleep(300);
  const ghBefore = await run(`popups.map(l => l.id).join(',') || '-'`);
  await run(`$('kKeys').querySelector('[data-f]').click()`); await sleep(300);
  const ghAfter = await run(`popups.map(l => l.id).join(',') || '-'`);
  report('ghost-kbd-kept', ghBefore === 'jump,kbd' && ghAfter === 'kbd', `was=${ghBefore} now=${ghAfter}`);
  await run(`closeKbd(false)`); await sleep(300);
  await closed('ghost-kbd-kept');

  code = fail === 0 ? 0 : 1;
  console.log(`SUMMARY pass=${pass} fail=${fail} xfail=${xfail} xpass=${xpass} total=${pass + fail + xfail + xpass}`);
} catch (e) {
  console.log('FAIL harness ' + (e?.message || e));
  code = 1;
} finally {
  await close();
}
process.exit(code);
