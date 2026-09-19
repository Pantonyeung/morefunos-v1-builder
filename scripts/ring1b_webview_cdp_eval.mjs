#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function adb(args) {
  return execFileSync('adb', args, { encoding: 'utf8' }).trim();
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const packageId = arg('--package') || 'com.morefunos.smt';
const scriptPath = arg('--script');
const exprPath = arg('--expr-file');
if (!scriptPath && !exprPath) throw new Error('R1B_CDP_EXPRESSION_REQUIRED');

const pidRaw = adb(['shell', 'pidof', packageId]);
const pid = pidRaw.split(/\s+/).filter(Boolean)[0];
if (!pid) throw new Error('R1B_CDP_APP_PID_MISSING');

const port = Number(arg('--port') || '9223');
try { adb(['forward', '--remove', `tcp:${port}`]); } catch { /* no prior listener is expected on a fresh emulator */ }
adb(['forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`]);

let pages = null;
let lastError = null;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json`);
    if (response.ok) {
      pages = await response.json();
      if (Array.isArray(pages) && pages.length) break;
    }
  } catch (error) {
    lastError = error;
  }
  await new Promise(resolve => setTimeout(resolve, 250));
}
if (!Array.isArray(pages) || !pages.length) {
  throw new Error(`R1B_CDP_PAGE_MISSING:${lastError ?? 'no page'}`);
}
const page = pages.find(item => typeof item.url === 'string' && item.url.includes('appassets.androidplatform.net')) || pages[0];
if (!page?.webSocketDebuggerUrl) throw new Error('R1B_CDP_WEBSOCKET_MISSING');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('R1B_CDP_WEBSOCKET_OPEN_TIMEOUT')), 5000);
  ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  ws.addEventListener('error', event => { clearTimeout(timer); reject(new Error(`R1B_CDP_WEBSOCKET_OPEN_FAILED:${String(event?.message || '')}`)); }, { once: true });
});

let sequence = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  let message;
  try { message = JSON.parse(String(event.data)); } catch { return; }
  if (!message.id || !pending.has(message.id)) return;
  const entry = pending.get(message.id);
  pending.delete(message.id);
  clearTimeout(entry.timer);
  if (message.error) entry.reject(new Error(`R1B_CDP_PROTOCOL_ERROR:${JSON.stringify(message.error)}`));
  else entry.resolve(message.result);
});

function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`R1B_CDP_COMMAND_TIMEOUT:${method}`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Runtime.enable');
let expression;
if (scriptPath) {
  expression = fs.readFileSync(scriptPath, 'utf8') + '\n;true;';
} else {
  expression = fs.readFileSync(exprPath, 'utf8');
}
const result = await send('Runtime.evaluate', {
  expression,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,
});
ws.close();
if (result?.exceptionDetails) {
  throw new Error(`R1B_CDP_RUNTIME_EXCEPTION:${JSON.stringify(result.exceptionDetails)}`);
}
const remote = result?.result || {};
if (Object.prototype.hasOwnProperty.call(remote, 'value')) {
  process.stdout.write(JSON.stringify(remote.value) + '\n');
} else if (remote.description) {
  process.stdout.write(JSON.stringify({ description: remote.description, type: remote.type }) + '\n');
} else {
  process.stdout.write(JSON.stringify(remote) + '\n');
}
