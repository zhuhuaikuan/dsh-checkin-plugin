// SPDX-License-Identifier: MulanPSL-2.0
// Copyright (c) 2026 zhuhuaikuan

// DSH Check-in Plugin (Cordis host plugin)
// Daily auto check-in for TRAE CN / WorkBuddy, with a user slash command `/checkin`.
//
// - Daily schedule via plain setTimeout (no ctx service dependency) -> always mounts.
// - Registers `/checkin [run|status|config|time HH:MM]`.
// - Reuses engine/daily_checkin.js + engine/checkin.config.json.
// - NEVER throws from apply(); optional services are guarded.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const name = 'dsh-checkin';
export const inject = [];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const ENGINE_DIR = path.join(PKG_ROOT, 'engine');

// ---- timezone helpers ------------------------------------------------------
function tzParts(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const o = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10);
  return o;
}
function tzOffsetMs(date, tz) {
  const p = tzParts(date, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}
export function msUntilNext(timeStr, tz = 'Asia/Shanghai') {
  const seg = String(timeStr || '08:00').split(':');
  const h = parseInt(seg[0] || '0', 10);
  const m = parseInt(seg[1] || '0', 10);
  const s = parseInt(seg[2] || '0', 10);
  const now = new Date();
  const p = tzParts(now, tz);
  const targetUtc = Date.UTC(p.year, p.month - 1, p.day, h, m, s) - tzOffsetMs(now, tz);
  let delta = targetUtc - now.getTime();
  if (delta <= 1000) delta += 24 * 3600 * 1000;
  return delta;
}

export function apply(ctx, config = {}) {
  const cfg = config || {};
  const scriptPath = cfg.scriptPath || path.join(ENGINE_DIR, 'daily_checkin.js');
  const configPath = cfg.configPath || path.join(ENGINE_DIR, 'checkin.config.json');
  const nodePath = cfg.nodePath || process.execPath;
  const dirOfConfig = path.dirname(configPath);
  const append = (fileName, text) => {
    try { fs.appendFileSync(path.join(dirOfConfig, fileName), text.endsWith('\n') ? text : text + '\n', 'utf8'); } catch (e) {}
  };
  const log = (...a) => {
    let msg;
    try { msg = a.map(x => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch (_) { return String(x); } })())).join(' '); }
    catch (_) { msg = 'log'; }
    try {
      const lg = ctx && ctx.logger;
      if (lg && typeof lg.info === 'function') lg.info(msg);
      else console.log(msg);
    } catch (e) { try { console.log(msg); } catch (_) {} }
  };

  try {
    append('plugin-loaded.txt', `${new Date().toISOString()} pid=${process.pid} stage=apply-start`);

    if (cfg.enabled === false) { log('[dsh-checkin] disabled by config'); return; }

    let time = cfg.time;
    let tz = cfg.timeZone || 'Asia/Shanghai';
    let configObj = null;
    try {
      if (configPath && fs.existsSync(configPath)) {
        configObj = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!time && configObj.time) time = configObj.time;
        if (configObj.timeZone) tz = configObj.timeZone;
      }
    } catch (e) { log('[dsh-checkin] read config failed: ' + String(e && e.message || e)); }
    if (!time) time = '08:00';

    let timerId = null;
    let nextRunAt = 0;

    const runOnce = () => new Promise((resolve) => {
      const lines = [];
      const collect = (s) => { lines.push(s); log(s); };
      try {
        if (!scriptPath || !fs.existsSync(scriptPath)) { collect('[dsh-checkin] script not found: ' + scriptPath); return resolve({ code: 'no-script', summary: 'script not found: ' + scriptPath }); }
        const env = { ...process.env };
        if (configPath) env.CHECKIN_CONFIG = configPath;
        const child = spawn(nodePath, [scriptPath], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        if (child.stdout) child.stdout.on('data', d => { String(d).split(/\r?\n/).forEach(l => { l = l.trim(); if (l) collect(l); }); });
        if (child.stderr) child.stderr.on('data', d => { String(d).split(/\r?\n/).forEach(l => { l = l.trim(); if (l) collect('[err] ' + l); }); });
        child.on('error', e => { collect('[dsh-checkin] process error: ' + String(e && e.message || e)); resolve({ code: 'error', summary: String(e && e.message || e) }); });
        child.on('exit', code => {
          const summary = [...lines].reverse().find(l => l.includes('summary:')) || [...lines].reverse().find(l => l.includes('#####') || l.includes('done:')) || ('exit ' + code);
          resolve({ code, summary });
        });
      } catch (e) { collect('[dsh-checkin] runOnce threw: ' + String(e && e.message || e)); resolve({ code: 'threw', summary: String(e && e.message || e) }); }
    });

    const scheduleNext = () => {
      try {
        const delay = msUntilNext(time, tz);
        nextRunAt = Date.now() + delay;
        log(`[dsh-checkin] next run at ${time} (${tz}); in ${(delay / 3600000).toFixed(2)} h`);
        append('plugin-loaded.txt', `${new Date().toISOString()} pid=${process.pid} stage=scheduled nextInMs=${Math.round(delay)} time=${time}`);
        if (timerId) clearTimeout(timerId);
        timerId = setTimeout(async () => {
          try { await runOnce(); } catch (e) { log('[dsh-checkin] run error: ' + String(e && e.message || e)); }
          finally { scheduleNext(); }
        }, Math.min(delay, 2147483647));
      } catch (e) { log('[dsh-checkin] scheduleNext threw: ' + String(e && e.message || e)); }
    };

    const fmtEta = () => {
      const ms = nextRunAt - Date.now();
      if (ms <= 0) return '即将运行';
      return (ms / 3600000).toFixed(2) + ' 小时';
    };
    const logTail = (n) => {
      try {
        const p = path.join(dirOfConfig, 'checkin.log');
        if (fs.existsSync(p)) { const arr = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/); return arr.slice(-n).join('\n'); }
      } catch (e) {}
      return '(无日志)';
    };

    const registerCommand = () => {
      try {
        const doRegister = (holder) => {
          try {
            const service = holder && holder.commands;
            if (!service || typeof service.register !== 'function') return;
            service.register({
              name: 'checkin',
              description: 'TRAE/WorkBuddy 每日签到：立即执行 / 查看状态 / 看配置 / 设置时间',
              input: { hint: '[run | status | config | time HH:MM]' },
              handler: async ({ rawInput }) => {
                const arg = (rawInput || '').trim();
                try {
                  if (!arg || arg === 'run' || arg === 'now') {
                    const r = await runOnce();
                    return { kind: r.code === 0 ? 'success' : 'error', text: '已执行签到：\n' + r.summary };
                  }
                  if (arg === 'status') {
                    return {
                      kind: 'success', text: [
                        '启用时间：每天 ' + time + '（' + tz + '）',
                        '下次运行：约 ' + fmtEta() + ' 后',
                        '最近日志：\n' + logTail(8),
                      ].join('\n')
                    };
                  }
                  if (arg === 'config') {
                    return {
                      kind: 'success', text: JSON.stringify({
                        time, timeZone: tz,
                        closeAfterCheckin: configObj ? configObj.closeAfterCheckin : undefined,
                        busy: configObj ? configObj.busy : undefined,
                        maxWaitHours: configObj ? configObj.maxWaitHours : undefined,
                        apps: configObj ? configObj.apps : undefined,
                      }, null, 2)
                    };
                  }
                  const m = arg.match(/^time\s+(\d{1,2}):(\d{2})$/);
                  if (m) {
                    const hh = Number(m[1]), mm = Number(m[2]);
                    if (hh > 23 || mm > 59) return { kind: 'error', text: '时间格式应为 HH:MM（00:00–23:59）' };
                    const nt = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
                    if (configPath && fs.existsSync(configPath)) {
                      try {
                        const j = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                        j.time = nt;
                        fs.writeFileSync(configPath, JSON.stringify(j, null, 2), 'utf8');
                      } catch (e) { return { kind: 'error', text: '写入配置失败：' + String(e && e.message || e) }; }
                    }
                    time = nt;
                    scheduleNext();
                    return { kind: 'success', text: '已把插件运行时间设为每天 ' + nt + '（' + tz + '），已重新排程，下次约 ' + fmtEta() + ' 后。\n注意：Windows 计划任务时间需另用 engine/install_task.ps1 同步。' };
                  }
                  return { kind: 'error', text: '用法：/checkin [run | status | config | time HH:MM]' };
                } catch (e) { return { kind: 'error', text: '执行出错：' + String(e && e.message || e) }; }
              }
            });
            log('[dsh-checkin] slash command /checkin registered');
          } catch (e) { log('[dsh-checkin] command register inner failed: ' + String(e && e.message || e)); }
        };
        if (ctx && typeof ctx.inject === 'function') ctx.inject(['commands'], doRegister);
        else doRegister(ctx);
      } catch (e) { log('[dsh-checkin] register command failed: ' + String(e && e.message || e)); }
    };

    scheduleNext();
    registerCommand();
    if (cfg.runOnStart) setTimeout(() => { runOnce(); }, 5000);
    log(`[dsh-checkin] plugin loaded (script=${scriptPath}, time=${time} ${tz})`);
  } catch (e) {
    const msg = '[dsh-checkin] APPLY FAILED: ' + String(e && e.stack || e);
    try { console.log(msg); } catch (_) {}
    try { append('plugin-error.txt', `${new Date().toISOString()} ${msg}`); } catch (_) {}
  }
}

export default apply;
