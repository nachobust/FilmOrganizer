import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION, checkForUpdate, compareVersions, latestVersion, loadUpdateSettings, saveUpdateSettings } from './updates';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const release = (tag: string) =>
  vi.fn(async () => new Response(JSON.stringify({ tag_name: tag }), { status: 200 })) as unknown as typeof fetch;
const NOW = 1_800_000_000_000;

describe('update check', () => {
  beforeEach(() => store.clear());

  it('compares versions numerically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0);
  });

  it('is off by default and then never contacts GitHub', async () => {
    const f = release('99.0.0');
    expect(loadUpdateSettings().enabled).toBe(false);
    expect(await checkForUpdate(NOW, f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('when on, reports a newer release at most once a day', async () => {
    saveUpdateSettings({ enabled: true });
    const f = release('v99.0.0');
    expect(await checkForUpdate(NOW, f)).toBe('99.0.0');
    expect(await checkForUpdate(NOW + 60_000, f)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('ignores the current version, skipped versions and failures', async () => {
    saveUpdateSettings({ enabled: true });
    expect(await checkForUpdate(NOW, release(`v${APP_VERSION}`))).toBeNull();
    saveUpdateSettings({ lastCheck: 0, skip: '99.0.0' });
    expect(await checkForUpdate(NOW, release('v99.0.0'))).toBeNull();
    saveUpdateSettings({ lastCheck: 0 });
    const broken = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await checkForUpdate(NOW, broken)).toBeNull();
  });
});

describe('latest version on GitHub', () => {
  it('asks for a fresh answer and explains failures', async () => {
    const f = release('v1.2.3');
    expect(await latestVersion(f)).toBe('1.2.3');
    expect((f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].cache).toBe('no-store');
    const down = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(latestVersion(down)).rejects.toThrow('GitHub answered with an error (503)');
  });
});
