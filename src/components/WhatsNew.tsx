// "What's new" popup: shown once to people who already used the app, after an update.
// Nothing is sent anywhere; the last update seen is remembered in this browser / app only.

import { UPDATE_CHECK_NOTE } from './Updates';

/** Change `id` (and the notes) with each release that has news; the popup then shows once more. */
export const WHATS_NEW = {
  id: '0.2.0',
  title: 'New: shot lists and the PDR',
  items: [
    ['Import a shot list', 'Start a project from a shot list (Excel, or a table in Word or text) instead of a script. English and Spanish column names both work.'],
    ['A shot list per shooting day', 'On the stripboard, each day has a “+ Shot list” button: add that day’s shots and go straight to its PDR.'],
    ['PDR tab', 'Each shooting day becomes a timed shooting plan: call, prep, one location at a time, masters first, inserts before lunch, product shots after. Change a shot and the day re-times itself.'],
    ['Export the PDR', 'As an Excel sheet, or straight into your own PDR template. Sheet labels in English or Spanish.'],
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
          <button onClick={props.onTry}>Open the PDR tab</button>
          <button className="primary" autoFocus onClick={props.onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
