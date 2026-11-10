// Checks that the away screen closes Extras, alone and with the on-screen keyboard over it: after sleep() and a wake
// with Down, nothing is left open and the deck has its focus back.
// Usage: node tools/test-sleep-extras.mjs   (set CHROME to the Chrome binary; needs Node 22+)
import { createServer } from 'node:http';
import { createReadStream, mkdtempSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const WWW = fileURLToPath(new URL('../app/src/main/assets/www/', import.meta.url));
const CHROME = process.env.CHROME || 'google-chrome';
const PORT = 9337;
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
const dir = mkdtempSync(join(tmpdir(), 'sleep-extras-'));
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

  let fails = 0;
  for (const withKbd of [false, true]) {
    const name = withKbd ? 'kbd-over-extras' : 'extras';
    await send('Page.navigate', { url: base + 'index.html?nosetup' });
    await sleep(2500);
    await run(`openExtras()`); await sleep(400);
    if (withKbd) { await run(`openKbd('test', '')`); await sleep(300); }
    const open = await run(`({ extrasOpen: isOpen('extras'), kbdOpen: isOpen('kbd'), visible: !$('extras').hidden })`);
    await run(`sleep()`); await sleep(250);
    await key('ArrowDown'); await sleep(400);   // a remote key wakes it, as on the TV
    const after = await run(`(() => { const a = cur, x = $('extras');
      return { sleeping, extrasOpen: isOpen('extras'), kbdOpen: isOpen('kbd'), visible: !x.hidden, kbdVisible: !$('kbd').hidden, trapped: popups.length > 0,
        tabs: document.querySelectorAll('.hd-tab[data-f]').length,
        focusOutside: !!a?.hasAttribute?.('data-f') && !x.contains(a) && !$('kbd').contains(a) }; })()`);
    const ok = open.extrasOpen === true && open.visible === true && open.kbdOpen === withKbd && after.sleeping === false &&
      after.extrasOpen === false && after.visible === false && after.kbdOpen === false && after.kbdVisible === false &&
      after.trapped === false && after.tabs === 3 && after.focusOutside === true;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: extrasOpen ${open.extrasOpen}->${after.extrasOpen} hidden=${!after.visible} kbdOpen=${after.kbdOpen} trapped=${after.trapped} tabs=${after.tabs} focusOutside=${after.focusOutside}`);
  }
  code = fails ? 1 : 0;
} catch (e) {
  console.log('FAIL ' + (e?.message || e));
  code = 1;
} finally {
  await close();
}
process.exit(code);
