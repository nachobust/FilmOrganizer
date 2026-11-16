import { useMemo, useRef, useState, type Dispatch } from 'react';
import { buildCallSheet, scheduleConflicts } from '../callsheet';
import { exportCallSheetPDF, exportCallSheetXLSX } from '../callsheet-export';
import { fromISO, shootDayNumbers, uid, type CrewMember, type Project } from '../model';
import type { Action } from '../store';

const fmtDay = (iso: string) =>
  fromISO(iso).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** The crew most shoots start from; added in one click and edited from there. */
const STANDARD_CREW: [string, string][] = [
  ['Direction', 'Director'],
  ['Direction', '1st AD'],
  ['Direction', '2nd AD'],
  ['Production', 'Producer'],
  ['Production', 'Production manager'],
  ['Production', 'Production assistant'],
  ['Camera', 'Director of photography'],
  ['Camera', '1st AC'],
  ['Electric', 'Gaffer'],
  ['Grip', 'Key grip'],
  ['Sound', 'Sound mixer'],
  ['Art', 'Production designer'],
  ['Wardrobe', 'Costume designer'],
  ['Make-up', 'Make-up and hair'],
  ['Script', 'Script supervisor'],
];

type View = 'sheet' | 'setup';

export default function CallSheetView(props: {
  project: Project;
  date: string | null;
  setDate: (d: string) => void;
  dispatch: Dispatch<Action>;
  onError: (e: unknown) => void;
  onGoToSchedule: () => void;
}) {
  const { project, dispatch } = props;
  const [view, setView] = useState<View>('sheet');
  const dayNumbers = useMemo(() => shootDayNumbers(project.schedule), [project.schedule]);
  const dates = [...dayNumbers.keys()];
  const date = props.date && dayNumbers.has(props.date) ? props.date : (dates[0] ?? null);

  return (
    <div className="callsheet">
      <div className="sched-head">
        <nav className="seg">
          <button className={view === 'sheet' ? 'active' : ''} onClick={() => setView('sheet')}>
            Call sheet
          </button>
          <button className={view === 'setup' ? 'active' : ''} onClick={() => setView('setup')}>
            Cast, crew &amp; locations
          </button>
        </nav>
        {view === 'sheet' && date && (
          <select value={date} onChange={(e) => props.setDate(e.target.value)} aria-label="Shooting day">
            {dates.map((d) => (
              <option key={d} value={d}>
                Day {dayNumbers.get(d)} · {fmtDay(d)}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        {view === 'sheet' && date && <ExportMenu project={project} date={date} onError={props.onError} />}
      </div>
      {view === 'setup' ? (
        <Setup project={project} dispatch={dispatch} />
      ) : date ? (
        <Sheet project={project} date={date} dispatch={dispatch} />
      ) : (
        <div className="empty">
          <h2>No shooting days yet</h2>
          <p>A call sheet is made for each shooting day. Schedule scenes on days first, or import a shot list.</p>
          <div className="empty-actions">
            <button className="primary" onClick={props.onGoToSchedule}>
              Go to Schedule
            </button>
            <button onClick={() => setView('setup')}>Set up cast, crew &amp; locations</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExportMenu(props: { project: Project; date: string; onError: (e: unknown) => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    menu.current?.removeAttribute('open');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      props.onError(e);
    } finally {
      setBusy(false);
    }
  };
  const sheet = () => buildCallSheet(props.project, props.date);
  return (
    <>
      {busy && <span className="muted">Exporting…</span>}
      <details className="menu" ref={menu}>
        <summary>Export call sheet ▾</summary>
        <div className="menu-items">
          <button onClick={() => run(() => exportCallSheetPDF(sheet()))}>
            PDF <span className="muted">.pdf</span>
          </button>
          <button onClick={() => run(() => exportCallSheetXLSX(sheet()))}>
            Excel <span className="muted">.xlsx</span>
          </button>
        </div>
      </details>
    </>
  );
}

/** A text box that saves as you type, used across the call sheet. */
function Field(props: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; wide?: boolean }) {
  return (
    <input
      className={`cs-field ${props.wide ? 'wide' : ''}`}
      type={props.type ?? 'text'}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

function Sheet(props: { project: Project; date: string; dispatch: Dispatch<Action> }) {
  const { project, date, dispatch } = props;
  const cs = useMemo(() => buildCallSheet(project, date), [project, date]);
  const day = (patch: { weather?: string; sunrise?: string; sunset?: string; notes?: string }) =>
    dispatch({ type: 'setCallSheet', date, patch });
  return (
    <div className="cs-page">
      <header className="cs-title">
        <div>
          <h2>{cs.title || 'Untitled'}</h2>
          <div className="muted">Call sheet</div>
        </div>
        <div className="cs-day">
          <b>
            {cs.dayOff ? 'Day off' : `Day ${cs.dayNo} of ${cs.totalDays}`}
          </b>
          <span>{cs.dateText}</span>
        </div>
      </header>

      {cs.conflicts.length > 0 && (
        <div className="cs-conflicts" role="alert">
          {cs.conflicts.map((c) => (
            <div key={c}>⚠ {c}</div>
          ))}
        </div>
      )}

      <section className="cs-grid">
        <div className="cs-box">
          <h4>Key times</h4>
          <dl>
            <dt>Crew call</dt>
            <dd>{cs.times.crewCall}</dd>
            <dt>Shooting</dt>
            <dd>{cs.times.shooting || '—'}</dd>
            <dt>Lunch</dt>
            <dd>{cs.times.lunch || '—'}</dd>
            <dt>Wrap</dt>
            <dd>{cs.times.wrap || '—'}</dd>
          </dl>
          {!cs.times.shooting && <p className="hint">Start this day's shooting plan to fill in the times.</p>}
        </div>
        <div className="cs-box">
          <h4>Conditions</h4>
          <dl>
            <dt>Sunrise</dt>
            <dd>
              <Field type="time" value={cs.sunrise} onChange={(v) => day({ sunrise: v })} />
            </dd>
            <dt>Sunset</dt>
            <dd>
              <Field type="time" value={cs.sunset} onChange={(v) => day({ sunset: v })} />
            </dd>
            <dt>Weather</dt>
            <dd>
              <Field value={cs.weather} placeholder="Sky · max ° · min ° · rain %" onChange={(v) => day({ weather: v })} wide />
            </dd>
          </dl>
        </div>
        <div className="cs-box">
          <h4>Key contacts</h4>
          {cs.contacts.length ? (
            <dl>
              {cs.contacts.map((c) => (
                <span key={c.role} className="cs-contact">
                  <dt>{c.role}</dt>
                  <dd>
                    {c.name}
                    {c.phone && <span className="muted"> · {c.phone}</span>}
                  </dd>
                </span>
              ))}
            </dl>
          ) : (
            <p className="hint">Add the director, producer and production manager under “Cast, crew &amp; locations”.</p>
          )}
        </div>
      </section>

      <section>
        <h4 className="section-title">Locations</h4>
        <table className="cs-table">
          <thead>
            <tr>
              <th>Set</th>
              <th>Address</th>
              <th>Parking</th>
              <th>Nearest hospital</th>
            </tr>
          </thead>
          <tbody>
            {cs.locations.map((l) => (
              <tr key={l.set}>
                <td>
                  <b>{l.set}</b>
                </td>
                {(['address', 'parking', 'hospital'] as const).map((k) => (
                  <td key={k}>
                    <Field value={l[k]} onChange={(v) => dispatch({ type: 'setLocation', set: l.set, patch: { [k]: v } })} wide />
                  </td>
                ))}
              </tr>
            ))}
            {!cs.locations.length && (
              <tr>
                <td colSpan={4} className="muted">
                  No scenes on this day.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h4 className="section-title">Scenes</h4>
        <table className="cs-table">
          <thead>
            <tr>
              <th className="c-narrow">Time</th>
              <th className="c-narrow">Sc</th>
              <th>Set</th>
              <th className="c-narrow">I/E · D/N</th>
              <th>Synopsis</th>
              <th className="c-narrow">Pages</th>
              <th className="c-narrow">Cast</th>
            </tr>
          </thead>
          <tbody>
            {cs.scenes.map((s) => (
              <tr key={s.sheetId}>
                <td>{s.time || '—'}</td>
                <td>
                  <b>{s.scene || '—'}</b>
                </td>
                <td>{s.set}</td>
                <td>{s.ieDn}</td>
                <td>{s.synopsis}</td>
                <td>{s.pages}</td>
                <td>{s.cast}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h4 className="section-title">Cast call</h4>
        <table className="cs-table">
          <thead>
            <tr>
              <th className="c-narrow">ID</th>
              <th>Character</th>
              <th>Actor</th>
              <th className="c-narrow">Pickup</th>
              <th className="c-narrow">Call</th>
              <th className="c-narrow">Make-up</th>
              <th className="c-narrow">On set</th>
            </tr>
          </thead>
          <tbody>
            {cs.cast.map((c) => (
              <tr key={c.elementId} className={c.warning ? 'cs-warn' : ''}>
                <td>{c.id}</td>
                <td>
                  <b>{c.character}</b>
                  {c.warning && <div className="row-warning">⚠ {c.warning}</div>}
                </td>
                <td>
                  {c.actor || <span className="muted">—</span>}
                  {c.phone && <div className="muted">{c.phone}</div>}
                </td>
                {(['pickup', 'call', 'makeup', 'onSet'] as const).map((k) => (
                  <td key={k}>
                    <Field
                      type="time"
                      value={c[k]}
                      onChange={(v) => dispatch({ type: 'setCastTimes', date, elementId: c.elementId, patch: { [k]: v } })}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {!cs.cast.length && (
              <tr>
                <td colSpan={7} className="muted">
                  No cast in today's scenes. Confirm cast in the breakdown to list them here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h4 className="section-title">Crew call</h4>
        {cs.crew.length ? (
          <table className="cs-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Role</th>
                <th>Name</th>
                <th>Phone</th>
                <th className="c-narrow">Call</th>
              </tr>
            </thead>
            <tbody>
              {cs.crew.map((c, i) => (
                <tr key={i}>
                  <td>{c.department}</td>
                  <td>{c.role}</td>
                  <td>{c.name}</td>
                  <td>{c.phone}</td>
                  <td>{c.call}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="hint">Add your crew under “Cast, crew &amp; locations”: it then appears on every call sheet.</p>
        )}
      </section>

      <section>
        <h4 className="section-title">Notes</h4>
        <textarea
          className="cs-notes"
          value={cs.notes}
          rows={3}
          placeholder="Safety, parking, catering, anything the whole crew should know today"
          onChange={(e) => day({ notes: e.target.value })}
        />
      </section>
    </div>
  );
}

function Setup(props: { project: Project; dispatch: Dispatch<Action> }) {
  const { project, dispatch } = props;
  const pr = project.production;
  const cast = project.elements.filter((e) => e.categoryId === 'cast').sort((a, b) => (a.castId ?? 999) - (b.castId ?? 999));
  const sets = [...new Set(project.sheets.map((s) => s.set.trim().toUpperCase()).filter(Boolean))].sort();
  const setCrew = (crew: CrewMember[]) => dispatch({ type: 'setCrew', crew });
  const editCrew = (id: string, patch: Partial<CrewMember>) => setCrew(pr.crew.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const conflicts = useMemo(() => scheduleConflicts(project), [project]);

  return (
    <div className="cs-page">
      <section>
        <h4 className="section-title">Production</h4>
        <div className="cs-form">
          {(
            [
              ['company', 'Production company'],
              ['director', 'Director'],
              ['producer', 'Producer'],
              ['productionManager', 'Production manager'],
              ['contactPhone', 'Production phone'],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              {label}
              <Field value={pr[k]} onChange={(v) => dispatch({ type: 'setProduction', patch: { [k]: v } })} wide />
            </label>
          ))}
        </div>
      </section>

      <section>
        <h4 className="section-title">
          Cast <span className="count">({cast.length})</span>
        </h4>
        <table className="cs-table">
          <thead>
            <tr>
              <th className="c-narrow">ID</th>
              <th>Character</th>
              <th>Actor</th>
              <th>Phone</th>
              <th>Not available on</th>
            </tr>
          </thead>
          <tbody>
            {cast.map((el) => (
              <tr key={el.id}>
                <td>{el.castId ?? ''}</td>
                <td>
                  <b>{el.name}</b>
                  {conflicts
                    .filter((c) => c.elementId === el.id)
                    .map((c) => (
                      <div key={c.date + c.sheetId} className="row-warning">
                        ⚠ {c.text}
                      </div>
                    ))}
                </td>
                <td>
                  <Field value={el.actor ?? ''} placeholder="Actor's name" onChange={(v) => dispatch({ type: 'updateElement', elementId: el.id, patch: { actor: v } })} wide />
                </td>
                <td>
                  <Field value={el.phone ?? ''} onChange={(v) => dispatch({ type: 'updateElement', elementId: el.id, patch: { phone: v } })} wide />
                </td>
                <td>
                  <Unavailable
                    dates={el.unavailable ?? []}
                    onChange={(unavailable) => dispatch({ type: 'updateElement', elementId: el.id, patch: { unavailable } })}
                  />
                </td>
              </tr>
            ))}
            {!cast.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No cast yet. Characters confirmed in the breakdown appear here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h4 className="section-title">
          Crew <span className="count">({pr.crew.length})</span>
        </h4>
        <table className="cs-table">
          <thead>
            <tr>
              <th>Department</th>
              <th>Role</th>
              <th>Name</th>
              <th>Phone</th>
              <th className="c-narrow" title="Leave empty to use the general crew call">
                Own call
              </th>
              <th className="c-del" />
            </tr>
          </thead>
          <tbody>
            {pr.crew.map((c) => (
              <tr key={c.id}>
                {(['department', 'role', 'name', 'phone'] as const).map((k) => (
                  <td key={k}>
                    <Field value={c[k]} onChange={(v) => editCrew(c.id, { [k]: v })} wide />
                  </td>
                ))}
                <td>
                  <Field type="time" value={c.call} onChange={(v) => editCrew(c.id, { call: v })} />
                </td>
                <td className="c-del">
                  <button className="ghost del" onClick={() => setCrew(pr.crew.filter((x) => x.id !== c.id))} aria-label="Remove">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="cs-actions">
          <button onClick={() => setCrew([...pr.crew, { id: uid(), department: '', role: '', name: '', phone: '', call: '' }])}>
            + Add crew member
          </button>
          {!pr.crew.length && (
            <button
              onClick={() =>
                setCrew(STANDARD_CREW.map(([department, role]) => ({ id: uid(), department, role, name: '', phone: '', call: '' })))
              }
            >
              Add a standard crew list
            </button>
          )}
        </div>
      </section>

      <section>
        <h4 className="section-title">
          Locations <span className="count">({sets.length})</span>
        </h4>
        <table className="cs-table">
          <thead>
            <tr>
              <th>Set</th>
              <th>Address</th>
              <th>Parking</th>
              <th>Nearest hospital</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {sets.map((set) => {
              const l = pr.locations[set];
              return (
                <tr key={set}>
                  <td>
                    <b>{set}</b>
                  </td>
                  {(['address', 'parking', 'hospital', 'notes'] as const).map((k) => (
                    <td key={k}>
                      <Field value={l?.[k] ?? ''} onChange={(v) => dispatch({ type: 'setLocation', set, patch: { [k]: v } })} wide />
                    </td>
                  ))}
                </tr>
              );
            })}
            {!sets.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No sets yet. Sets from the breakdown appear here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** Dates an actor can't shoot: chips to remove, a date box to add. */
function Unavailable(props: { dates: string[]; onChange: (dates: string[]) => void }) {
  return (
    <div className="chips">
      {props.dates.map((d) => (
        <span key={d} className="chip unavailable">
          {fromISO(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
          <button className="chip-btn no" onClick={() => props.onChange(props.dates.filter((x) => x !== d))} aria-label="Remove date">
            ×
          </button>
        </span>
      ))}
      <input
        type="date"
        className="cs-field"
        value=""
        onChange={(e) => {
          const d = e.target.value;
          if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !props.dates.includes(d)) props.onChange([...props.dates, d].sort());
        }}
        aria-label="Add a date the actor can't shoot"
        title="Add a date the actor can't shoot"
      />
    </div>
  );
}
