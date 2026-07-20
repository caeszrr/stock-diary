import fs from 'node:fs';
import path from 'node:path';
import { isoYear, isoMonth } from './dates.js';

const DATA_ROOT = path.join(process.cwd(), 'public', 'data');

function monthFilePath(market, year, month) {
  return path.join(DATA_ROOT, market, year, `${month}.json`);
}

export function readMonthFile(market, year, month) {
  const file = monthFilePath(market, year, month);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse existing data file ${file}: ${err.message}`);
  }
}

export function writeMonthFile(market, year, month, data, { pretty = false } = {}) {
  const file = monthFilePath(market, year, month);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  fs.writeFileSync(file, json);
  return file;
}

/**
 * Merges an array of { symbol, date: 'YYYY-MM-DD', ...fields } records into an
 * existing month-file object, in place. Only the touched symbol+date cells are
 * written; every other symbol/date already present is left untouched. Fields
 * with undefined value are dropped (never fabricate/overwrite with blanks).
 */
export function mergeRecordsIntoMonth(existing, records) {
  for (const rec of records) {
    const { symbol, date, ...fields } = rec;
    if (!existing[symbol]) existing[symbol] = {};
    const clean = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null) clean[k] = v;
    }
    existing[symbol][date] = { ...existing[symbol][date], ...clean };
  }
  return existing;
}

/** Splits a flat list of { symbol, date, ...fields } records by the record's year/month. */
export function groupRecordsByMonth(records) {
  const buckets = new Map();
  for (const rec of records) {
    const key = `${isoYear(rec.date)}/${isoMonth(rec.date)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(rec);
  }
  return buckets;
}

/**
 * Reads-merges-writes a flat list of records, grouping them by month file automatically.
 * Returns the list of files written.
 */
export function upsertRecords(market, records, opts) {
  const written = [];
  for (const [key, monthRecords] of groupRecordsByMonth(records)) {
    const [year, month] = key.split('/');
    const existing = readMonthFile(market, year, month);
    mergeRecordsIntoMonth(existing, monthRecords);
    written.push(writeMonthFile(market, year, month, existing, opts));
  }
  return written;
}

export function writeJson(relativePath, data, { pretty = true } = {}) {
  const file = path.join(DATA_ROOT, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
  return file;
}

export function readJson(relativePath, fallback = {}) {
  const file = path.join(DATA_ROOT, relativePath);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Merges a per-market patch into data/status.json (never clobbers other markets' entries). */
export function updateStatus(market, patch) {
  const status = readJson('status.json', {});
  status[market] = { ...status[market], ...patch };
  return writeJson('status.json', status, { pretty: true });
}

/**
 * Scans public/data/{tw,us,idx} on disk and writes manifest.json: the union of
 * {year: [months]} that have a data file in any of those markets. Drives the
 * frontend's year/month tabs so it never has to probe with failed fetches.
 */
export function regenerateManifest() {
  const monthsByYear = {};
  for (const market of ['tw', 'us', 'idx']) {
    const marketDir = path.join(DATA_ROOT, market);
    if (!fs.existsSync(marketDir)) continue;
    for (const year of fs.readdirSync(marketDir)) {
      const yearDir = path.join(marketDir, year);
      if (!fs.statSync(yearDir).isDirectory()) continue;
      const months = fs
        .readdirSync(yearDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''));
      if (!monthsByYear[year]) monthsByYear[year] = new Set();
      months.forEach((m) => monthsByYear[year].add(m));
    }
  }
  const years = Object.keys(monthsByYear).sort();
  const manifest = {
    years,
    monthsByYear: Object.fromEntries(years.map((y) => [y, [...monthsByYear[y]].sort()])),
  };
  writeJson('manifest.json', manifest, { pretty: true });
  return manifest;
}

export { DATA_ROOT };
