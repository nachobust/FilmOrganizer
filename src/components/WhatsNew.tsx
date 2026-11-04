// "What's new" popup: shown once to people who already used the app, after an update.
// Nothing is sent anywhere; the last update seen is remembered in this browser / app only.

import { UPDATE_CHECK_NOTE } from './Updates';

/** Change `id` (and the notes) with each release that has news; the popup then shows once more. */
export const WHATS_NEW = {
  id: '0.2.4',
  title: 'New in 0.2.4: a tidier shooting plan',
  items: [
    ['Cleaner rows', 'Times and the names of resets, company moves and lunch now read as plain text in the row’s colour. Click one to edit it; fixed start times show in blue.'],
    ['Update now', 'From now on, when a new version is out the update bar has an “Update now” button: it downloads, installs and restarts the app for you. Turn it on under “Updates” in the bottom bar.'],
    ['Drag works again', 'In the desktop app you can drag strips on the stripboard and rows in the shooting plan.'],
    ['Every row is editable', 'Move, delete, rename and time resets, company moves and lunch like any shot, or add your own with “+ Add row”. Set a start or an end time on any row.'],
    ['Move several rows at once', 'Tick the rows and drag one of them. Before anything moves, a window shows what changes and warns about a missing company move or overlapping times.'],
    ['Drop a file to open it', 'Drag a project (.json), a shot list (.xlsx) or a script onto the window.'],
  ] as [string, string][],
};

const SEEN_KEY = 'filmorganizer.whatsNewSeen';

/** True when this update's notes should pop up: someone who used the app before and hasn't seen them. */
export function shouldShowWhatsNew(hadProject: boolean): boolean {
  try {
    const seen = localStorage.getItem(SEEN_KEY);
    if (seen === WHATS_NEW.id) return false;
    // New users get the app as it is, without an update notice.
    if (!hadProject && seen === null) {
      markWhatsNewSeen();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function markWhatsNewSeen() {
  try {
    localStorage.setItem(SEEN_KEY, WHATS_NEW.id);
  } catch {
    // Storage unavailable: the popup may show again next time, which is harmless.
  }
}

export default function WhatsNewModal(props: {
  onClose: () => void;
  onTry: () => void;
  /** Desktop app only: the opt-in update check, offered here because this is when people read about updates. */
  updateCheck?: { on: boolean; set: (on: boolean) => void };
}) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal wide" role="dialog" aria-labelledby="whats-new-title">
        <h3 id="whats-new-title">{WHATS_NEW.title}</h3>
        <ul className="whats-new">
          {WHATS_NEW.items.map(([head, text]) => (
            <li key={head}>
              <b>{head}.</b> {text}
            </li>
          ))}
        </ul>
        {props.updateCheck && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={props.updateCheck.on}
                onChange={(e) => props.updateCheck!.set(e.target.checked)}
              />
              Tell me when the next version is out
            </label>
            <p className="modal-text small">{UPDATE_CHECK_NOTE}</p>
          </>
        )}
        <div className="modal-actions">
          <span className="spacer" />
          <button onClick={props.onTry}>Open the shooting plan</button>
          <button className="primary" autoFocus onClick={props.onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
