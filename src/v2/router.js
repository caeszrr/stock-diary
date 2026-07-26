/**
 * v2 hash 路由:
 *   #/v2              → 導向今日交易日
 *   #/v2/day/YYYY-MM-DD
 *   #/v2/vault
 *   #/v2/settings
 */
import { taipeiTodayIso, isValidIsoDate } from './lib/dates.js';

export function parseRoute() {
  const parts = location.hash.replace(/^#\//, '').split('/'); // ['v2', page, param]
  const page = parts[1] || '';
  const param = parts[2] || '';
  if (page === 'day') {
    return { page: 'day', date: isValidIsoDate(param) ? param : taipeiTodayIso() };
  }
  if (page === 'vault') return { page: 'vault' };
  if (page === 'settings') return { page: 'settings' };
  return { page: 'day', date: taipeiTodayIso() };
}

export function navigate(path) {
  location.hash = path;
}

export function onRouteChange(fn) {
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#/v2')) fn(parseRoute());
    // 離開 #/v2 的情況由 src/main.js 的接線處理(整頁重載回 v1)
  });
}
