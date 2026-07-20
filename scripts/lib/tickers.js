import fs from 'node:fs';
import path from 'node:path';

const TICKERS_PATH = path.join(process.cwd(), 'config', 'tickers.json');

export function loadTickers() {
  const json = JSON.parse(fs.readFileSync(TICKERS_PATH, 'utf8'));
  return json.tickers;
}

/** Excludes tickers validate-tickers.js has flagged unresolved — they stay in config, just skipped from fetch. */
export function isFetchable(ticker) {
  return ticker.status !== 'unresolved';
}

export function loadTickersConfig() {
  return JSON.parse(fs.readFileSync(TICKERS_PATH, 'utf8'));
}

export function saveTickersConfig(config) {
  fs.writeFileSync(TICKERS_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

export { TICKERS_PATH };
