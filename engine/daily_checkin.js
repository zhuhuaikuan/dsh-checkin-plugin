// SPDX-License-Identifier: MulanPSL-2.0
// Copyright (c) 2026 zhuhuaikuan

// Daily auto check-in for TRAE CN and WorkBuddy.
//
// Strategy (v2):
//  - If the app is NOT running: launch it with a remote-debugging (CDP) port,
//    perform the check-in inside the app, then close it (script-owned -> close).
//  - If the app IS already running (user-opened, no debug port):
//      * Detect whether it is executing a task (CPU/disk-write busy heuristic).
//      * If idle -> gracefully close it, relaunch with debug port, check in, close.
//      * If busy -> re-check every 10 minutes until it becomes idle (or max wait).
//  - Check-in is done via CDP (works even when the screen is locked).
//
// Usage: node daily_checkin.js [--no-close] [--force]
//   --no-close : never close apps (debug only)
//   --force    : skip idle-wait; if a user-opened app is running, close it immediately
//
// Env overrides:
//   CHECKIN_BUSY_CPU=0.5        busy if CPU cores used >= this (over 8s window)
//   CHECKIN_BUSY_WRITE_MB=5     busy if disk write MB >= this (over 8s window)
//   CHECKIN_MAX_WAIT_HOURS=8    max hours to wait for a busy app to become idle
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const DIR = __dirname;
const LOG = path.join(DIR, 'checkin.log');
const NO_CLOSE = process.argv.includes('--no-close');
const FORCE = process.argv.includes('--force');

// ---- config ----------------------------------------------------------------
const DEFAULTS = {
  time: '08:00', timeZone: 'Asia/Shanghai', closeAfterCheckin: true,
  busy: { cpuCores: 0.35, writeMB: 25, warmupSec: 120 }, maxWaitHours: 8,
  apps: [
    { name: 'TRAE CN', enabled: true, image: 'Trae CN.exe', port: 9333, launchShortcut: 'launch_trae.lnk', pageMatch: 'workbench', kind: 'trae', runningPolicy: 'closeWhenIdle' },
    { name: 'WorkBuddy', enabled: true, image: 'WorkBuddy.exe', port: 9334, launchShortcut: 'launch_wb.lnk', pageMatch: 'index\\.html|WorkBuddy', kind: 'workbuddy', runningPolicy: 'closeWhenIdle' },
  ],
};
function loadConfig() {
  const p = process.env.CHECKIN_CONFIG || path.join(DIR, 'checkin.config.json');
  let raw = {};
  try { if (fs.existsSync(p)) raw = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { try { console.error('config parse error:', e.message); } catch (_) {} }
  const cfg = { ...DEFAULTS, ...raw, busy: { ...DEFAULTS.busy, ...(raw.busy || {}) } };
  const merged = DEFAULTS.apps.map(d => ({ ...d, ...((raw.apps || []).find(a => a.name === d.name) || {}) }));
  for (const a of (raw.apps || [])) if (!merged.find(m => m.name === a.name)) merged.push({ ...a });
  cfg.apps = merged;
  return cfg;
}
const CONFIG = loadConfig();

const BUSY_CPU_CORES = parseFloat(process.env.CHECKIN_BUSY_CPU || String(CONFIG.busy.cpuCores));
const BUSY_WRITE_MB = parseFloat(process.env.CHECKIN_BUSY_WRITE_MB || String(CONFIG.busy.writeMB));
const MAX_WAIT_HOURS = parseFloat(process.env.CHECKIN_MAX_WAIT_HOURS || String(CONFIG.maxWaitHours));
const WARMUP_SEC = parseFloat(process.env.CHECKIN_WARMUP_SEC || String(CONFIG.busy.warmupSec));
const CLOSE_AFTER = !NO_CLOSE && CONFIG.closeAfterCheckin !== false;
const SAMPLE_MS = 8000;
const POLL_MS = 10 * 60 * 1000; // 10 minutes while an app is busy
const WARMUP_POLL_MS = 60 * 1000; // while an app is still warming up after launch

function log(msg) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n', 'utf8'); } catch (e) {}
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- single-instance lock (avoid two concurrent runs, e.g. OS task + DSH plugin) ----
const LOCK = path.join(DIR, 'checkin.lock');
let lockOwned = false;
function acquireLock() {
  try {
    if (fs.existsSync(LOCK)) {
      const [pidStr, tsStr] = String(fs.readFileSync(LOCK, 'utf8')).trim().split('|');
      const pid = parseInt(pidStr, 10);
      const age = Date.now() - (parseInt(tsStr, 10) || 0);
      let alive = false;
      if (pid) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = false; } }
      if (alive && age >= 0 && age < 2 * 3600 * 1000) return { ok: false, pid, age };
    }
  } catch (e) { /* ignore */ }
  try { fs.writeFileSync(LOCK, `${process.pid}|${Date.now()}`, 'utf8'); lockOwned = true; } catch (e) {}
  return { ok: true };
}
function releaseLock() { if (lockOwned) { try { fs.unlinkSync(LOCK); } catch (e) {} lockOwned = false; } }
process.on('exit', releaseLock);

// ---- process helpers -------------------------------------------------------
function isRunning(imageName) {
  try {
    const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/NH'], { encoding: 'latin1' });
    return out.toLowerCase().includes(imageName.toLowerCase());
  } catch (e) { return false; }
}

function killApp(imageName) {
  try { execFileSync('taskkill', ['/F', '/T', '/IM', imageName], { stdio: 'ignore' }); return true; }
  catch (e) { return false; }
}

async function gracefulClose(imageName) {
  const base = imageName.replace(/\.exe$/i, '');
  const cmd = `$ErrorActionPreference='SilentlyContinue';$p=@(Get-Process -Name '${base}');foreach($x in $p){if($x.MainWindowHandle -ne 0){[void]$x.CloseMainWindow()}};'ok'`;
  try { execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', windowsHide: true }); } catch (e) {}
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) { if (!isRunning(imageName)) return true; await sleep(1000); }
  return !isRunning(imageName);
}

function psSample(imageName) {
  // Sum CPU (100ns) and write bytes across all processes of this image, plus the
  // age (seconds) of the oldest process (= app uptime), via CIM.
  const cmd = `$ErrorActionPreference='SilentlyContinue';$p=@(Get-CimInstance Win32_Process -Filter "Name='${imageName}'");$cpu=0.0;$wb=0.0;$age=0.0;if($p.Count -gt 0){$now=Get-Date;$mins=@();foreach($x in $p){$cpu+=[double]$x.UserModeTime+[double]$x.KernelModeTime;$wb+=[double]$x.WriteTransferCount;if($x.CreationDate){$mins+=(($now-$x.CreationDate).TotalSeconds)}};if($mins.Count -gt 0){$age=($mins|Measure-Object -Minimum).Minimum}};'{0}|{1}|{2}|{3}' -f $cpu,$wb,$p.Count,$age`;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', windowsHide: true }).trim();
    const parts = out.split('|');
    return { cpu: parseFloat(parts[0]) || 0, wb: parseFloat(parts[1]) || 0, n: parseInt(parts[2]) || 0, age: parseFloat(parts[3]) || 0 };
  } catch (e) { return { cpu: 0, wb: 0, n: 0, age: 0 }; }
}

async function measureBusy(imageName) {
  const a = psSample(imageName);
  if (a.n === 0) return { running: false, busy: false };
  await sleep(SAMPLE_MS);
  const b = psSample(imageName);
  if (b.n === 0) return { running: false, busy: false };
  const cpuCores = ((b.cpu - a.cpu) / 1e7) / (SAMPLE_MS / 1000);
  const writeMB = (b.wb - a.wb) / 1048576;
  const warming = b.age > 0 && b.age < WARMUP_SEC;
  // CPU is the primary signal of an active agent task; disk write is secondary.
  let busy = cpuCores >= BUSY_CPU_CORES || writeMB >= BUSY_WRITE_MB;
  if (warming) busy = true; // don't judge a just-launched app; short re-check instead
  return { running: true, busy, warming, cpuCores: +cpuCores.toFixed(3), writeMB: +writeMB.toFixed(2), age: Math.round(b.age) };
}

async function waitUntilIdle(app) {
  const start = Date.now();
  const maxMs = MAX_WAIT_HOURS * 3600000;
  while (true) {
    const m = await measureBusy(app.image);
    if (!m.running) { log(`[${app.name}] no longer running.`); return { idle: true, gone: true }; }
    if (!m.busy) { log(`[${app.name}] idle detected (cpu=${m.cpuCores} cores, io=${m.writeMB}MB/${SAMPLE_MS / 1000}s, age=${m.age}s) -> can close.`); return { idle: true }; }
    const poll = m.warming ? WARMUP_POLL_MS : POLL_MS;
    if (m.warming) log(`[${app.name}] still warming up after launch (age=${m.age}s, cpu=${m.cpuCores}, io=${m.writeMB}MB/${SAMPLE_MS / 1000}s); re-check in 60s.`);
    else log(`[${app.name}] executing a task (cpu=${m.cpuCores} cores, io=${m.writeMB}MB/${SAMPLE_MS / 1000}s); re-check in 10 min.`);
    if (Date.now() - start + poll > maxMs) { log(`[${app.name}] still busy after ${MAX_WAIT_HOURS}h; giving up (leaving it open).`); return { idle: false, timeout: true }; }
    await sleep(poll);
  }
}

function launchViaShortcut(lnkPath) {
  execFile('explorer.exe', [lnkPath], { windowsHide: true }, () => {});
}

async function httpJson(url, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await (await fetch(url, { signal: ctrl.signal })).json(); }
  finally { clearTimeout(t); }
}

async function portAlive(port) {
  try { const v = await httpJson(`http://127.0.0.1:${port}/json/version`, 1500); return !!(v && v.webSocketDebuggerUrl); }
  catch (e) { return false; }
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portAlive(port)) return true;
    await sleep(1000);
  }
  return false;
}

async function getTargets(port) {
  try { return await httpJson(`http://127.0.0.1:${port}/json/list`, 3000); } catch (e) { return []; }
}

function pickPage(targets, matchRe) {
  const pages = (targets || []).filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.startsWith('devtools://'));
  return pages.find(t => matchRe.test(t.url) || matchRe.test(t.title || '')) || null;
}

async function evalOnPage(wsUrl, expression, timeoutMs = 15000) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  };
  await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('ws open timeout')), 8000); ws.onopen = () => { clearTimeout(to); res(); }; ws.onerror = () => { clearTimeout(to); rej(new Error('ws error')); }; });
  try {
    await Promise.race([send('Runtime.enable'), sleep(timeoutMs)]);
    const r = await Promise.race([send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }), sleep(timeoutMs)]);
    if (r && r.exceptionDetails) return { ok: false, error: r.exceptionDetails.text };
    return { ok: true, value: r && r.result ? r.result.value : undefined };
  } finally { try { ws.close(); } catch (e) {} }
}

// ---- app-specific check-in payloads ---------------------------------------
const TRAE_PROBE = `(function(){
  var btns=[].slice.call(document.querySelectorAll('button'));
  var sign=btns.filter(function(b){return (b.textContent||'').trim()==='签到';})[0];
  var done=btns.filter(function(b){return (b.textContent||'').trim()==='已签到';})[0];
  var body=document.body?document.body.innerText:'';
  if(sign){ sign.click(); return JSON.stringify({action:'clicked'}); }
  if(done || body.indexOf('已签到')>=0){ return JSON.stringify({action:'already'}); }
  return JSON.stringify({action:'wait', bodyLen: body.length});
})()`;

const TRAE_VERIFY = `(function(){
  var btns=[].slice.call(document.querySelectorAll('button'));
  var done=btns.filter(function(b){return (b.textContent||'').trim()==='已签到';})[0];
  var sign=btns.filter(function(b){return (b.textContent||'').trim()==='签到';})[0];
  var body=document.body?document.body.innerText:'';
  return JSON.stringify({ done: !!done || body.indexOf('已签到')>=0 || (!sign && body.length>0) });
})()`;

const WB_PROBE = `(async function(){
  try{
    if(!(window.wb && window.wb.http && window.wb.http.post)) return JSON.stringify({action:'wait'});
    var st = await window.wb.http.post('/billing/meter/checkin-activity-status',{});
    var d = st && st.data;
    if(d && d.today_checked_in) return JSON.stringify({action:'already', streak:d.streak_days, total:d.total_credits});
    var r = await window.wb.http.post('/billing/meter/daily-checkin',{});
    return JSON.stringify({action:'clicked', code:r&&r.code, credit:(r&&r.data&&r.data.credit)||0, streak:(r&&r.data&&r.data.streak_days)||0, msg:r&&r.msg});
  }catch(e){ return JSON.stringify({action:'error', error:String(e)}); }
})()`;

const APPS = CONFIG.apps.filter(a => a.enabled !== false).map(a => ({
  name: a.name,
  image: a.image,
  port: a.port,
  lnk: path.isAbsolute(a.launchShortcut) ? a.launchShortcut : path.join(DIR, a.launchShortcut),
  match: new RegExp(a.pageMatch, 'i'),
  kind: a.kind,
  delayMs: a.delayMs || 3000,
  runningPolicy: process.env.CHECKIN_POLICY || a.runningPolicy || 'closeWhenIdle',
}));

async function processApp(app) {
  log(`=== [${app.name}] start ===`);
  let portUp = await portAlive(app.port);
  let running = isRunning(app.image);

  if (!running) log(`[${app.name}] not running.`);
  else if (portUp) log(`[${app.name}] running with debug port ${app.port} (script-owned instance).`);
  else log(`[${app.name}] already running (user-opened, no debug port).`);

  // Case: user-opened app -> behavior per app.runningPolicy
  if (running && !portUp) {
    const policy = FORCE ? 'forceClose' : app.runningPolicy;
    if (policy === 'skip') {
      log(`[${app.name}] already open; runningPolicy=skip -> leaving it untouched (no check-in).`);
      return { name: app.name, status: 'skipped-open' };
    }
    if (policy === 'keepOpen') {
      log(`[${app.name}] already open but no debug port; cannot check in without closing. Enable debug-launch (enable_debug_launch.ps1) to use keepOpen; leaving untouched.`);
      return { name: app.name, status: 'skipped-open-no-port' };
    }
    if (policy === 'forceClose') {
      log(`[${app.name}] already open; ${FORCE ? '--force' : 'runningPolicy=forceClose'} -> closing immediately.`);
      killApp(app.image);
      await sleep(3000);
    } else { // closeWhenIdle (default)
      const w = await waitUntilIdle(app);
      if (!w.idle) return { name: app.name, status: w.timeout ? 'busy-timeout' : 'gone' };
      if (!w.gone) {
        log(`[${app.name}] closing idle app to perform check-in ...`);
        const ok = await gracefulClose(app.image);
        if (!ok) { log(`[${app.name}] graceful close timed out; forcing.`); killApp(app.image); }
        await sleep(3000);
      }
    }
    running = isRunning(app.image);
  }

  // keepOpen: if already running WITH a debug port, check in but do NOT close.
  let keepOpen = false;
  if (running && portUp && app.runningPolicy === 'keepOpen') {
    keepOpen = true;
    log(`[${app.name}] running with debug port; runningPolicy=keepOpen -> check in WITHOUT closing.`);
  }

  // Owned instance?
  let owned = portUp && running;
  if (!owned) {
    log(`[${app.name}] launching ${path.basename(app.lnk)} ...`);
    launchViaShortcut(app.lnk);
    if (!(await waitForPort(app.port, 90000))) { log(`[${app.name}] debug port did not come up.`); return { name: app.name, status: 'launch-failed' }; }
    owned = true;
    log(`[${app.name}] debug port ${app.port} ready.`);
  }

  // Wait for the right page target
  let page = null;
  for (let i = 0; i < 30; i++) { page = pickPage(await getTargets(app.port), app.match); if (page) break; await sleep(1000); }
  if (!page) { log(`[${app.name}] no matching page target found.`); if (owned && CLOSE_AFTER && !keepOpen) killApp(app.image); return { name: app.name, status: 'no-page' }; }
  log(`[${app.name}] page target: ${page.title || ''} | ${page.url}`);

  await sleep(app.delayMs);

  // Retry check-in
  let result = { action: 'timeout' };
  for (let i = 0; i < 24; i++) {
    const expr = app.kind === 'trae' ? TRAE_PROBE : WB_PROBE;
    const r = await evalOnPage(page.webSocketDebuggerUrl, expr).catch(e => ({ ok: false, error: String(e) }));
    if (r.ok && r.value) { try { result = JSON.parse(r.value); } catch (e) { result = { action: 'parse-error', raw: r.value }; } }
    else result = { action: 'eval-error', error: r.error };
    if (result.action === 'clicked' || result.action === 'already') break;
    if (i % 5 === 0) page = pickPage(await getTargets(app.port), app.match) || page;
    await sleep(3000);
  }

  let status = 'unknown';
  if (app.kind === 'trae') {
    if (result.action === 'clicked') {
      let verified = false;
      for (let k = 0; k < 6; k++) {
        await sleep(1500);
        const v = await evalOnPage(page.webSocketDebuggerUrl, TRAE_VERIFY).catch(() => ({ ok: false }));
        if (v.ok && v.value) { try { if (JSON.parse(v.value).done) { verified = true; break; } } catch (e) {} }
      }
      status = verified ? 'checked-in' : 'clicked-unverified';
      log(`[${app.name}] check-in ${verified ? 'SUCCESS (已签到)' : 'clicked but not verified'}.`);
    } else if (result.action === 'already') { status = 'already'; log(`[${app.name}] already checked in today (已签到), skip.`); }
    else { status = 'not-found'; log(`[${app.name}] check-in button not found (${JSON.stringify(result)}).`); }
  } else {
    if (result.action === 'clicked') {
      if (result.code === 0) { status = 'checked-in'; log(`[${app.name}] check-in SUCCESS: +${result.credit} credits, streak ${result.streak}.`); }
      else { status = 'claim-failed'; log(`[${app.name}] claim failed: code=${result.code} msg=${result.msg}`); }
    } else if (result.action === 'already') { status = 'already'; log(`[${app.name}] already checked in today (streak ${result.streak}, total ${result.total}).`); }
    else { status = 'not-found'; log(`[${app.name}] check-in not performed (${JSON.stringify(result)}).`); }
  }

  if (owned && CLOSE_AFTER && !keepOpen) {
    log(`[${app.name}] closing app ...`);
    killApp(app.image);
    await sleep(1500);
    log(`[${app.name}] closed.`);
  } else if (NO_CLOSE) {
    log(`[${app.name}] --no-close set; leaving app running.`);
  }
  log(`=== [${app.name}] done: ${status} ===`);
  return { name: app.name, status };
}

(async () => {
  const lock = acquireLock();
  if (!lock.ok) {
    log(`##### another check-in run already in progress (pid=${lock.pid}, age=${Math.round(lock.age / 1000)}s); exiting #####`);
    process.exit(0);
  }
  if (process.argv.includes('--dry-run') || process.env.CHECKIN_DRYRUN === '1') {
    log('##### DRY-RUN: no app will be launched or closed #####');
    const rows = [];
    for (const app of APPS) {
      const running = isRunning(app.image);
      const portUp = await portAlive(app.port);
      rows.push({ name: app.name, running, portUp, policy: app.runningPolicy });
      log(`[dry-run] ${app.name}: running=${running} port=${portUp} policy=${app.runningPolicy}`);
    }
    log('##### dry-run summary: ' + JSON.stringify(rows) + ' #####');
    releaseLock();
    process.exit(0);
  }
  log('##### daily check-in run begin #####');
  const results = [];
  for (const app of APPS) {
    try { results.push(await processApp(app)); }
    catch (e) { log(`[${app.name}] EXCEPTION: ${e && e.stack || e}`); results.push({ name: app.name, status: 'exception', error: String(e) }); }
  }
  log('##### summary: ' + JSON.stringify(results) + ' #####');
  releaseLock();
  process.exit(0);
})();
