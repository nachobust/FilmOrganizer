import { useState } from 'react';
import { isDesktop } from '../platform';
import { APP_VERSION, compareVersions, DOWNLOAD_PAGE, latestVersion, saveUpdateSettings } from '../updates';

/** What the check does and does not send, shown wherever it can be turned on. */
export const UPDATE_CHECK_NOTE =
  'Once a day, the app asks GitHub for the latest version number. Nothing about you or your projects is sent.';

export function UpdateSettingsModal(props: {
  enabled: boolean;
  onChange: (on: boolean) => void;
  onFound: (version: string) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState('');
  const checkNow = async () => {
    setStatus('Checking…');
    saveUpdateSettings({ lastCheck: Date.now() });
    try {
      const latest = await latestVersion();
      if (compareVersions(latest, APP_VERSION) > 0) {
        props.onFound(latest);
        props.onClose();
      } else setStatus(`You have the latest version. Latest on GitHub: ${latest} · you have ${APP_VERSION}.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-labelledby="updates-title">
        <h3 id="updates-title">New versions</h3>
        <p className="modal-text">You have FilmOrganizer {APP_VERSION}.</p>
        <label className="check">
          <input type="checkbox" checked={props.enabled} onChange={(e) => props.onChange(e.target.checked)} />
          Tell me when a new version is out
        </label>
        <p className="modal-text small">{UPDATE_CHECK_NOTE} Off by default.</p>
        {status && <p className="modal-text small">{status}</p>}
        <div className="modal-actions">
          <button onClick={checkNow} disabled={!props.enabled}>
            Check now
          </button>
          <span className="spacer" />
          <button className="primary" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Downloads the new version, installs it and restarts the app. The update is checked against the
 * public key built into the app, so only versions signed by FilmOrganizer's release build install.
 */
async function installUpdate(onProgress: (text: string) => void) {
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) throw new Error('The update is not ready to install yet. Try again in a few minutes.');
  let total = 0;
  let done = 0;
  await update.downloadAndInstall((e) => {
    if (e.event === 'Started') total = e.data.contentLength ?? 0;
    else if (e.event === 'Progress') {
      done += e.data.chunkLength;
      onProgress(total ? `Downloading… ${Math.round((done / total) * 100)}%` : 'Downloading…');
    } else onProgress('Installing…');
  });
  // Windows closes the app to run the installer; elsewhere restart into the new version.
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

export function UpdateBanner(props: { version: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState('');
  const [failed, setFailed] = useState('');
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(DOWNLOAD_PAGE);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  // Only the desktop app can update itself; versions built before 0.2.3 have no signed update to fetch.
  const canInstall = isDesktop && !failed;
  return (
    <div className="notice" role="status">
      FilmOrganizer {props.version} is out (you have {APP_VERSION}).{' '}
      {progress ? (
        <b>{progress}</b>
      ) : canInstall ? (
        <>
          Your project is saved.{' '}
          <button
            className="primary"
            onClick={async () => {
              setProgress('Getting the update…');
              try {
                await installUpdate(setProgress);
              } catch (e) {
                setProgress('');
                setFailed(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Update now
          </button>{' '}
        </>
      ) : (
        <>
          {failed && <span className="warn">{failed} </span>}
          Download it from <b>{DOWNLOAD_PAGE.replace('https://', '')}</b>{' '}
          <button onClick={copyLink}>{copied ? 'Link copied' : 'Copy link'}</button>{' '}
        </>
      )}
      {!progress && (
        <>
          <button
            onClick={() => {
              saveUpdateSettings({ skip: props.version });
              props.onClose();
            }}
          >
            Skip this version
          </button>{' '}
          <button className="ghost" onClick={props.onClose} aria-label="Remind me later">
            ✕
          </button>
        </>
      )}
    </div>
  );
}
