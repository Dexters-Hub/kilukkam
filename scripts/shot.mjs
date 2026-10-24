// Phone-sized browser driver over the Chrome DevTools Protocol, no npm deps.
//   node scripts/shot.mjs <script.json>
// script: { width?, height?, dark?, steps: [{goto}|{wait}|{eval, save?}|{shot, full?}|{tab}] }
// {eval, save: 'code'} stores the result; later steps can use ${code} in goto/eval/shot.
// {tab: n} switches to (or opens) page n, so several phones can share one browser.
// Prints {out, logs}: eval results plus any console errors or page exceptions.
// Uses $CHROME, else the newest Playwright headless shell in the local cache.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const findChrome = () => {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort() : [];
  for (const dir of shells.reverse()) {
    for (const sub of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64']) {
      const bin = join(cache, dir, sub, 'chrome-headless-shell');
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error('No headless Chrome found: set CHROME or run `npx playwright install chromium-headless-shell`');
};
const CHROME = findChrome();
const script = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, '--headless', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${join(tmpdir(), `kilukkam-shot-${port}`)}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let version;
for (let i = 0; i < 50; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(100); }
}
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (m.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const msg = { id: ++id, method, params, ...(sessionId ? { sessionId } : {}) };
  pending.set(msg.id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify(msg));
});

const tabs = [];
const openTab = async () => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  for (const d of ['Page', 'Runtime']) await send(`${d}.enable`, {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: script.width ?? 390, height: script.height ?? 844, deviceScaleFactor: 2, mobile: true }, sessionId);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: script.dark ? 'dark' : 'light' }] }, sessionId);
  return sessionId;
};
let s = await openTab();
tabs.push(s);
const out = [];
const vars = {};
const fill = (v) => (typeof v === 'string' ? v.replace(/\$\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : v);
for (const raw of script.steps) {
  const step = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, fill(v)]));
  if ('tab' in step) { while (tabs.length <= step.tab) tabs.push(await openTab()); s = tabs[step.tab]; }
  if (step.goto) { await send('Page.navigate', { url: step.goto }, s); await sleep(1200); }
  if (step.wait) await sleep(step.wait);
  if (step.eval) {
    const r = await send('Runtime.evaluate', { expression: step.eval, awaitPromise: true, returnByValue: true, userGesture: true }, s);
    const value = r.result?.value ?? r.exceptionDetails?.exception?.description;
    if (step.save) vars[step.save] = value;
    out.push({ eval: step.eval.slice(0, 60), value });
  }
  if (step.shot) {
    const full = step.full ? await send('Page.getLayoutMetrics', {}, s) : null;
    const clip = full ? { x: 0, y: 0, width: script.width ?? 390, height: Math.min(full.cssContentSize.height, 4000), scale: 1 } : undefined;
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) }, s);
    writeFileSync(step.shot, Buffer.from(data, 'base64'));
    out.push({ shot: step.shot });
  }
}
console.log(JSON.stringify({ out, logs }, null, 1));
ws.close();
proc.kill();
