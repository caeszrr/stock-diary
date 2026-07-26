// Version guard: a user on a phone can keep seeing a frozen service-worker copy
// of the app long after a new version deployed, which makes all the server-side
// monitoring useless. This fetches version.json fresh (no-store, cache-busted)
// and, when the deployed build id differs from the running one, clears caches
// and reloads — so the running copy can't drift from what was deployed.

const RUNNING_BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
const base = import.meta.env.BASE_URL;

async function fetchDeployedBuildId() {
  try {
    const res = await fetch(`${base}version.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return json.buildId || null;
  } catch {
    return null;
  }
}

let reloading = false;
async function hardReload() {
  if (reloading) return;
  reloading = true;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update()));
    }
    if (self.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } finally {
    location.reload();
  }
}

/**
 * Starts the update watcher. `onOutdated` (optional) is called with the deployed
 * id so the UI can show a banner instead of an immediate reload; if it returns a
 * truthy "defer" the reload is left to the user's 重新整理資料 button.
 */
export function startUpdateWatch({ onOutdated } = {}) {
  const check = async () => {
    const deployed = await fetchDeployedBuildId();
    if (deployed && deployed !== RUNNING_BUILD_ID) {
      if (onOutdated && onOutdated(deployed)) return; // UI chose to defer
      await hardReload();
    }
  };
  check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  setInterval(check, 10 * 60 * 1000); // every 10 min while open
}

/** The 重新整理資料 button: force fresh data + pick up any new deploy. */
export async function forceRefresh() {
  await hardReload();
}
