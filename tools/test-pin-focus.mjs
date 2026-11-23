// Checks that Pin / Unpin in the Options menu gives the deck's focusables back: the tabs, Help, Jump To and radio
// play keep data-f, and Right from the Home tab lands on the Apps tab.
// Usage: node tools/test-pin-focus.mjs   (set CHROME to the Chrome binary; needs Node 22+)
import { createServer } from 'node:http';
import { createReadStream, mkdtempSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const WWW = fileURLToPath(new URL('../app/src/main/assets/www/', import.meta.url));
const CHROME = process.env.CHROME || 'google-chrome';
const PORT = 9334;
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
const dir = mkdtempSync(join(tmpdir(), 'pin-focus-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
let ws, code = 1;
const close = async () => {
  try { ws?.close(); } catch {}
  chrome.kill('SIGKILL');
  await new Promise(r => server.close(r));
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
    await send('Input.dispatchKeyEvent', { type: printable ? 'keyDown' : 'keyDown', ...(printable ? { text: k } : {}), key: k, code: k, windowsVirtualKeyCode: k === 'Enter' ? 13 : k === 'ArrowUp' ? 38 : k === 'ArrowDown' ? 40 : k === 'ArrowRight' ? 39 : k === 'ArrowLeft' ? 37 : 0 });
    if (hold) await sleep(hold);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k });
  };

  await send('Page.navigate', { url: base + 'index.html?nosetup' });
  await sleep(2500);

  const before = await run(`({ n: document.querySelectorAll('.stage [data-f]').length,
    tabs: document.querySelectorAll('.hd-tab[data-f]').length })`);
  // put focus on an app tile that is not pinned, so the menu offers Pin
  await run(`(() => { const el = [...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent); TV.focus(el); })()`);
  await sleep(150);
  const pinned = await run(`favs.includes(+cur.dataset.app)`);
  await key('Enter', 700); await sleep(250);
  const opts = await run(`({ trapped: popups.length > 0, optsOpen: isOpen('opts'), label: cur?.dataset.opt })`);
  // step to the pin row
  const steps = await run(`(() => { const items = [...oList.querySelectorAll('[data-opt]')]; const i = items.findIndex(e => e.dataset.opt === 'pin'); return i - items.findIndex(e => e === cur); })()`);
  for (let i = 0; i < Math.abs(steps); i++) { await key(steps > 0 ? 'ArrowDown' : 'ArrowUp'); await sleep(120); }
  await key('Enter'); await sleep(400);
  const after = await run(`({ trapped: popups.length > 0, optsOpen: isOpen('opts'), tabs: document.querySelectorAll('.hd-tab[data-f]').length,
    help: $('helpBtn').hasAttribute('data-f'), jump: $('jumpBtn').hasAttribute('data-f'), play: $('rPlay').hasAttribute('data-f'),
    saved: (popups[0]?.saved ?? []).length, curApp: cur?.dataset.app ?? null })`);
  // Up to the Home tab, then Right: the Apps tab must take focus
  await key('ArrowUp'); await sleep(150);
  await run(`TV.focus(document.querySelector('[data-tab="0"]'))`);
  await sleep(120);
  await key('ArrowRight'); await sleep(200);
  const tab = await run(`cur?.dataset.tab ?? null`);
  const ok = after.trapped === false && after.optsOpen === false && after.saved === 0 && before.tabs > 0 &&
    after.tabs === before.tabs && after.help && after.jump && after.play && after.curApp != null && tab === '1';
  code = ok ? 0 : 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} pin(${pinned}) tabs ${after.tabs}/${before.tabs} help=${after.help} jump=${after.jump} play=${after.play} saved=${after.saved} trapped=${after.trapped} right->${tab}`);
} catch (e) {
  console.log('FAIL ' + (e?.message || e));
  code = 1;
} finally {
  await close();
}
process.exit(code);
