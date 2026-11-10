// Checks that the away screen closes the on-screen keyboard: with the keyboard open over Jump To, sleep() then wake()
// leaves no keyboard and puts focus back on the deck.
// Usage: node tools/test-sleep-keyboard.mjs   (set CHROME to the Chrome binary; needs Node 22+)
import { createServer } from 'node:http';
import { createReadStream, mkdtempSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const WWW = fileURLToPath(new URL('../app/src/main/assets/www/', import.meta.url));
const CHROME = process.env.CHROME || 'google-chrome';
const PORT = 9335;
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
const dir = mkdtempSync(join(tmpdir(), 'sleep-kbd-'));
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
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...(printable ? { text: k } : {}), key: k, code: k, windowsVirtualKeyCode: k === 'Enter' ? 13 : k === 'ArrowUp' ? 38 : k === 'ArrowDown' ? 40 : 0 });
    if (hold) await sleep(hold);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k });
  };

  await send('Page.navigate', { url: base + 'index.html?nosetup' });
  await sleep(2500);

  await run(`TV.focus([...document.querySelectorAll('.section:not(.is-off) [data-app]')].find(e => e.offsetParent))`);
  await sleep(150);
  await key('j'); await sleep(350);
  // point Row 1 at Custom… the way the Jump To menu stores it, then open it with OK
  await run(`(() => { J.row1.i = J.row1.vals.indexOf('Custom…'); drawJump('row1'); })()`);
  await sleep(200);
  const jumpRow = await run(`(() => { const items = [...jList.querySelectorAll('.jl')]; const i = items.findIndex(e => e.dataset.jl === 'row1');
    cur = null; TV.focus(items[i]); return items[i].dataset.jl; })()`);
  await key('Enter'); await sleep(400);
  const open = await run(`({ kbdOpen, jumpOpen, trapped: popups.length > 0, visible: !$('kbd').hidden })`);
  await run(`sleep()`);
  await sleep(200);
  const slept = await run(`({ sleeping, kbdOpen, visible: !$('kbd').hidden, trapped: popups.length > 0, jumpOpen })`);
  await key('Shift'); await sleep(300);
  await run(`wake()`);
  await sleep(200);
  const after = await run(`(() => { const a = cur, k = $('kbd');
    return { kbdOpen, sleeping: sleeping, visible: !k.hidden, jumpOpen, trapped: popups.length > 0,
      focusF: !!a?.hasAttribute?.('data-f'), focusInKbd: !!(a && k.contains(a)),
      focusOutside: !!a?.hasAttribute?.('data-f') && !k.contains(a) }; })()`);
  const ok = open.kbdOpen === true && open.visible === true && after.kbdOpen === false && after.visible === false &&
    after.focusOutside === true && after.focusInKbd === false;
  code = ok ? 0 : 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} kbdOpen ${open.kbdOpen}->${after.kbdOpen} hidden=${!after.visible} focusOutsideKbd=${after.focusOutside} focusInKbd=${after.focusInKbd} jumpOpen=${after.jumpOpen} trapped=${after.trapped}`);
} catch (e) {
  console.log('FAIL ' + (e?.message || e));
  code = 1;
} finally {
  await close();
}
process.exit(code);
