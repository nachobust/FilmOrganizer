import { useState } from 'react';
import { APP_VERSION, checkForUpdate, DOWNLOAD_PAGE, saveUpdateSettings } from '../updates';

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
    saveUpdateSettings({ lastCheck: 0 });
    const found = await checkForUpdate();
    if (found) {
      props.onFound(found);
      props.onClose();
    } else setStatus(`You have the latest version (${APP_VERSION}), or GitHub could not be reached.`);
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

export function UpdateBanner(props: { version: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="notice" role="status">
      FilmOrganizer {props.version} is out (you have {APP_VERSION}). Download it from{' '}
      <b>{DOWNLOAD_PAGE.replace('https://', '')}</b>{' '}
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(DOWNLOAD_PAGE);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Link copied' : 'Copy link'}
      </button>{' '}
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
    </div>
  );
}
