// Synthetic check: load the DEPLOYED site headlessly and assert what a human sees.
//
// Why this exists. The data watchdog checks completeness of the JSON on disk and
// nothing else. On 2026-08-03 — the app's first month rollover — it reported
// green while the user could not see August at all: the 8月 tab rendered
// disabled because the month-tab list was built from data alone, so a month with
// no data yet did not exist as far as the UI was concerned. Completeness
// monitoring is structurally unable to catch that class of failure. This check
// closes the gap by asserting the rendered page, not the data behind it.
//
// Exit code 0 = every assertion passed (the workflow then does nothing at all:
// no issue, no commit, no email). Exit code 1 = at least one failed; the report
// at public/data/synthetic-report.json names them for the escalation step.
//
// Env:
//   SITE_URL              base URL to check (default: the live GitHub Pages site)
//   SYNTHETIC_GRACE_HOURS how long after a session's publish cutoff before its
//                         absence counts as a failure (default 6, see below)
//   SYNTHETIC_OUT         directory for screenshots (default: synthetic-artifacts)

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { expectedSessionDate, previousTradingDate, loadHolidays } from './lib/coverage.js';

const SITE_URL = (process.env.SITE_URL || 'https://caeszrr.github.io/stock-diary/').replace(/\/?$/, '/');
const GRACE_HOURS = Number(process.env.SYNTHETIC_GRACE_HOURS ?? 6);
const OUT_DIR = process.env.SYNTHETIC_OUT || 'synthetic-artifacts';

const VIEWPORTS = [
  { name: 'desktop', width: 1400, height: 900 },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
];

/** The bellwethers a human would notice immediately if they went blank. */
const BELLWETHERS = [
  { symbol: '2330', label: '台積電' },
  { symbol: 'TAIEX', label: '加權指數' },
];

function taipeiParts(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const m = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return { year: m.year, month: m.month, iso: `${m.year}-${m.month}-${m.day}` };
}

/**
 * Freshness has to tolerate late delivery without going blind. GitHub's
 * scheduler routinely runs this repo's crons hours behind (the 2026-08-03 TW
 * fetch landed ~9h late), so demanding the very latest session the moment its
 * publish cutoff passes would alarm on a merely-late-but-working pipeline.
 *
 * So: `required` is the session that must be on screen (derived from the
 * calendar as of GRACE_HOURS ago), and `latest` is the newest session that could
 * be there. Showing `latest` is ideal; showing `required` passes with a note;
 * anything older fails.
 */
function freshnessTargets(now = new Date()) {
  const holidays = loadHolidays();
  const latest = expectedSessionDate('tw', { now, holidays });
  const required = expectedSessionDate('tw', {
    now: new Date(now.getTime() - GRACE_HOURS * 3600 * 1000),
    holidays,
  });
  return { latest, required, previous: previousTradingDate(latest, 'tw', holidays) };
}

/** One assertion result. `ok:false` entries drive the GitHub Issue. */
const results = [];
function assert(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function checkViewport(browser, viewport, targets, deployedBuildId) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    serviceWorkers: 'allow',
  });
  // The real user onboarded weeks ago; a fresh browser context would otherwise
  // land on the first-run welcome screen and never render the tabs at all. Seed
  // the same localStorage key userData.js uses so we check the returning-user
  // view — the one that was broken.
  await context.addInitScript(() => {
    try {
      const KEY = 'stock-diary:userdata';
      if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify({ startMode: 'full' }));
    } catch { /* storage disabled — the welcome screen assertion below will catch it */ }
  });

  const page = await context.newPage();

  // Both channels — a pageerror never shows up as a console 'error' event.
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  const v = viewport.name;
  await page.goto(SITE_URL, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForSelector('.tabs-month .month-btn', { timeout: 30_000 });

  const { month: curMonth, year: curYear } = taipeiParts();
  const curLabel = `${Number(curMonth)}月`;

  // ---- 1. The current month tab exists, is enabled, and is selected by default.
  const tab = page.locator('.tabs-month .month-btn', { hasText: new RegExp(`^${curLabel}$`) }).first();
  const tabCount = await tab.count();
  assert(`[${v}] 本月分頁存在（${curLabel}）`, tabCount > 0, tabCount ? undefined : '找不到本月分頁按鈕');
  if (tabCount) {
    const disabled = await tab.isDisabled();
    assert(`[${v}] 本月分頁可點擊（${curLabel}）`, !disabled, disabled ? '分頁為 disabled，使用者無法進入本月' : undefined);
    const cls = (await tab.getAttribute('class')) || '';
    assert(`[${v}] 預設選取本月（${curLabel}）`, cls.includes('active'), cls.includes('active') ? undefined : `預設選取的不是本月，class="${cls}"`);
    const yearTab = page.locator('.tabs-year .tab-btn', { hasText: `${curYear}年` }).first();
    assert(`[${v}] 本年分頁存在且可點擊（${curYear}年）`, (await yearTab.count()) > 0 && !(await yearTab.isDisabled()));
    if (!disabled) await tab.click();
    await page.waitForTimeout(1200);
  }

  // ---- 2. Real values for the latest expected session, for the bellwethers.
  for (const { symbol, label } of BELLWETHERS) {
    const read = async (date) => {
      const cell = page.locator(`td.cell[data-symbol="${symbol}"][data-date="${date}"] .cell-close`);
      if (!(await cell.count())) return null;
      const text = (await cell.first().innerText()).trim();
      return text && text !== '—' ? text : null;
    };
    const onLatest = await read(targets.latest);
    const onRequired = onLatest ? null : await read(targets.required);
    if (onLatest) {
      assert(`[${v}] ${label} ${symbol} 有 ${targets.latest} 收盤值`, true, `收盤 ${onLatest}`);
    } else if (onRequired) {
      assert(`[${v}] ${label} ${symbol} 有 ${targets.required} 收盤值`, true,
        `收盤 ${onRequired}（${targets.latest} 尚未到，仍在 ${GRACE_HOURS} 小時寬限內）`);
    } else {
      assert(`[${v}] ${label} ${symbol} 有 ${targets.required} 收盤值`, false,
        `本月分頁中找不到 ${symbol} 在 ${targets.required}（或 ${targets.latest}）的收盤值`);
    }
  }

  // ---- 3. The service worker is serving the current deployed build, not a
  // frozen copy. Reload once first: a SW only takes control of a page on the
  // second load, so this is the load that actually goes through the SW.
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForSelector('.tabs-month .month-btn', { timeout: 30_000 });
  const sw = await page.evaluate(async () => ({
    controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    running: window.__STOCK_DIARY_BUILD__ ?? null,
  }));
  assert(`[${v}] Service Worker 已接管頁面`, sw.controlled, sw.controlled ? undefined : '重新載入後仍無 SW controller');
  assert(`[${v}] 頁面執行的是目前部署的版本`,
    deployedBuildId !== null && sw.running === deployedBuildId,
    `頁面執行 ${sw.running ?? '(無)'}，實際部署 ${deployedBuildId ?? '(無)'}`);

  // ---- 4. Zero console errors.
  assert(`[${v}] 無 console 錯誤`, consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const shot = path.join(OUT_DIR, `${v}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  await context.close();
  return shot;
}

async function main() {
  const targets = freshnessTargets();
  console.log(`[synthetic] ${SITE_URL}`);
  console.log(`[synthetic] 本月 ${taipeiParts().year}-${taipeiParts().month}；最新交易日 ${targets.latest}，寬限後必須顯示 ${targets.required}`);

  // The version actually deployed right now, fetched outside the browser so a
  // service-worker cache cannot mask a frozen copy.
  let deployedBuildId = null;
  try {
    const res = await fetch(`${SITE_URL}version.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) deployedBuildId = (await res.json()).buildId ?? null;
  } catch (err) {
    console.error(`[synthetic] could not read deployed version.json: ${err.message}`);
  }

  const browser = await chromium.launch();
  const screenshots = [];
  try {
    for (const viewport of VIEWPORTS) {
      screenshots.push(await checkViewport(browser, viewport, targets, deployedBuildId));
    }
  } finally {
    await browser.close();
  }

  const failures = results.filter((r) => !r.ok);
  const report = {
    checkedAt: new Date().toISOString(),
    siteUrl: SITE_URL,
    targets,
    graceHours: GRACE_HOURS,
    deployedBuildId,
    results,
    failures,
    ok: failures.length === 0,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'synthetic-report.json'), JSON.stringify(report, null, 2));

  console.log(`[synthetic] ${results.length - failures.length}/${results.length} 通過`);
  console.log(`[synthetic] screenshots: ${screenshots.join(', ')}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[synthetic] FAILED:', err);
  // An infrastructure failure is still a failure a human should hear about.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, 'synthetic-report.json'),
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      siteUrl: SITE_URL,
      ok: false,
      results,
      failures: [...results.filter((r) => !r.ok), { name: '合成檢查本身失敗', ok: false, detail: err.message }],
    }, null, 2)
  );
  process.exitCode = 1;
});
