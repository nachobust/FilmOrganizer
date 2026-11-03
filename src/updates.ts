// Optional update check for the desktop app. Off until the user turns it on: the app otherwise
// sends nothing. When on, it asks GitHub for the latest release's version number at most once a
// day. GitHub sees the request (like any web request) but no project data is ever sent.

export const APP_VERSION = __APP_VERSION__;
export const DOWNLOAD_PAGE = 'https://filmorganizer.vercel.app';
const LATEST_RELEASE = 'https://api.github.com/repos/nachobust/FilmOrganizer/releases/latest';
const KEY = 'filmorganizer.updateCheck';
const DAY = 24 * 60 * 60 * 1000;

interface UpdateSettings {
  enabled: boolean;
  /** When GitHub was last asked (ms since epoch). */
  lastCheck: number;
  /** A version the user chose to skip. */
  skip: string;
}

export function loadUpdateSettings(): UpdateSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      enabled: raw.enabled === true,
      lastCheck: typeof raw.lastCheck === 'number' ? raw.lastCheck : 0,
      skip: typeof raw.skip === 'string' ? raw.skip : '',
    };
  } catch {
    return { enabled: false, lastCheck: 0, skip: '' };
  }
}

export function saveUpdateSettings(patch: Partial<UpdateSettings>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadUpdateSettings(), ...patch }));
  } catch {
    // Storage unavailable: the check just stays off.
  }
}

/** Compares "1.2.10" with "1.2.9" numerically; a leading "v" is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/i, '').split(/[.-]/).map((p) => Number.parseInt(p) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/**
 * The newer version, if the check is on, a day has passed since the last one, and GitHub reports
 * a release newer than this app that the user hasn't skipped. Any failure is silent: no update.
 */
export async function checkForUpdate(now = Date.now(), fetchFn: typeof fetch = fetch): Promise<string | null> {
  const s = loadUpdateSettings();
  if (!s.enabled || now - s.lastCheck < DAY) return null;
  saveUpdateSettings({ lastCheck: now });
  try {
    const tag = await latestVersion(fetchFn);
    if (tag === s.skip) return null;
    return compareVersions(tag, APP_VERSION) > 0 ? tag : null;
  } catch {
    return null;
  }
}

/**
 * The latest release's version as GitHub reports it right now (never a cached answer, so a
 * release published minutes ago is seen). Throws a readable error when GitHub can't be reached.
 */
export async function latestVersion(fetchFn: typeof fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn(LATEST_RELEASE, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  } catch {
    throw new Error('GitHub could not be reached. Check the internet connection.');
  }
  if (!res.ok) throw new Error(`GitHub answered with an error (${res.status}). Try again in a few minutes.`);
  const tag = String((await res.json()).tag_name ?? '').replace(/^v/i, '');
  if (!/^\d+\.\d+/.test(tag)) throw new Error('GitHub did not report a version.');
  return tag;
}
