import { useMemo, useState, type CSSProperties, type Dispatch, type DragEvent } from 'react';
import {
  addDays,
  formatEighths,
  fromISO,
  parseEighths,
  shootDayNumbers,
  STRIP_KINDS,
  stripKind,
  toISO,
  weekStart,
  type BreakdownElement,
  type Project,
  type Sheet,
} from '../model';
import type { Action } from '../store';
import { askConfirm } from '../platform';

export interface ScheduleNav {
  mode: 'month' | 'week';
  /** Any date inside the month or week being shown. */
  date: string;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString('en-US', { month: 'long' }));
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const fmtShort = (d: Date) => d.toLocaleString('en-US', { day: 'numeric', month: 'short' });
const pagesLabel = (eighths: number) => `${formatEighths(eighths) || '0'} pgs`;

function castIds(sheet: Sheet, elMap: Map<string, BreakdownElement>): number[] {
  return sheet.tags
    .filter((t) => t.state === 'confirmed')
    .map((t) => elMap.get(t.elementId)?.castId)
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b);
}

function Legend() {
  return (
    <div className="legend">
      {STRIP_KINDS.map((k) => (
        <span key={k.key} className="legend-item">
          <span className="swatch" style={{ background: k.bg }} />
          {k.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Scene editor

interface Draft {
  id: string | null;
  scenes: string;
  set: string;
  intExt: string;
  dayNight: string;
  pages: string;
}

function SceneModal(props: {
  draft: Draft;
  onClose: () => void;
  dispatch: Dispatch<Action>;
  onOpenInBreakdown: (id: string) => void;
}) {
  const { onClose, dispatch, onOpenInBreakdown } = props;
  const [d, setD] = useState(props.draft);
  const [error, setError] = useState('');
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const save = () => {
    const pages = parseEighths(d.pages);
    if (!d.scenes.trim()) return setError('Scene # is required.');
    if (pages === null) return setError('Length not recognized — try "1 3/8", "4/8" or "2".');
    const patch = {
      scenes: d.scenes.trim(),
      set: d.set.trim().toUpperCase(),
      intExt: d.intExt,
      dayNight: d.dayNight.trim().toUpperCase(),
      pages,
    };
    if (d.id) dispatch({ type: 'updateSheet', id: d.id, patch });
    else dispatch({ type: 'addSheet', patch });
    onClose();
  };
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h3>{d.id ? 'Edit scene' : 'Add scene'}</h3>
        <label>
          Scene #
          <input autoFocus value={d.scenes} onChange={(e) => set({ scenes: e.target.value })} placeholder="e.g. 12" />
        </label>
        <label>
          Set
          <input value={d.set} onChange={(e) => set({ set: e.target.value })} placeholder="e.g. BAR" />
        </label>
        <div className="field-row">
          <label>
            Int / Ext
            <select value={d.intExt} onChange={(e) => set({ intExt: e.target.value })}>
              <option value="INT">INT</option>
              <option value="EXT">EXT</option>
              <option value="INT/EXT">INT/EXT</option>
            </select>
          </label>
          <label>
            Day / Night
            <input value={d.dayNight} list="dl-daynight" onChange={(e) => set({ dayNight: e.target.value })} />
          </label>
        </div>
        <label>
          Length (eighths, e.g. 1 3/8)
          <input value={d.pages} onChange={(e) => set({ pages: e.target.value })} placeholder="e.g. 1 3/8" />
        </label>
        <div className="form-error">{error}</div>
        <div className="modal-actions">
          {d.id && (
            <>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  if (await askConfirm(`Delete scene ${d.scenes}? This also removes its breakdown.`)) {
                    dispatch({ type: 'deleteSheet', id: d.id! });
                    onClose();
                  }
                }}
              >
                Delete
              </button>
              <button type="button" onClick={() => onOpenInBreakdown(d.id!)}>
                Open breakdown
              </button>
            </>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- Month view

function MonthView(props: {
  project: Project;
  nav: ScheduleNav;
  setNav: (n: ScheduleNav) => void;
}) {
  const { project, nav, setNav } = props;
  const focus = fromISO(nav.date);
  const year = focus.getFullYear();
  const month = focus.getMonth();
  const sheets = useMemo(() => new Map(project.sheets.map((s) => [s.id, s])), [project.sheets]);
  const dayNumbers = useMemo(() => shootDayNumbers(project.schedule), [project.schedule]);
  const todayISO = toISO(new Date());

  const first = weekStart(new Date(year, month, 1));
  const weeks = Math.ceil(((new Date(year, month + 1, 0).getDate() + ((new Date(year, month, 1).getDay() + 6) % 7)) / 7));
  const years = useMemo(() => {
    const ys = Object.keys(project.schedule.byDate).map((d) => Number(d.slice(0, 4)));
    const now = new Date().getFullYear();
    const lo = Math.min(now - 2, year, ...ys);
    const hi = Math.max(now + 5, year, ...ys);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [project.schedule.byDate, year]);
  const goMonth = (y: number, m: number) => setNav({ mode: 'month', date: toISO(new Date(y, m, 1)) });

  return (
    <div className="month">
      <div className="sched-head">
        <button onClick={() => goMonth(year, month - 1)} aria-label="Previous month">
          ‹
        </button>
        <select value={month} onChange={(e) => goMonth(year, Number(e.target.value))} aria-label="Month">
          {MONTHS.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
        <select value={year} onChange={(e) => goMonth(Number(e.target.value), month)} aria-label="Year">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button onClick={() => goMonth(year, month + 1)} aria-label="Next month">
          ›
        </button>
        <button onClick={() => setNav({ mode: 'month', date: todayISO })}>Today</button>
        <span className="spacer" />
        <Legend />
      </div>
      <div className="month-grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="month-dow">
            {w}
          </div>
        ))}
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const date = addDays(first, i);
          const iso = toISO(date);
          const strips = (project.schedule.byDate[iso] ?? []).map((id) => sheets.get(id)).filter((s): s is Sheet => !!s);
          const eighths = strips.reduce((n, s) => n + s.pages, 0);
          const dayNo = dayNumbers.get(iso);
          return (
            <button
              key={iso}
              className={`month-cell ${date.getMonth() !== month ? 'outside' : ''} ${iso === todayISO ? 'today' : ''} ${dayNo ? 'shoot' : ''}`}
              onClick={() => setNav({ mode: 'week', date: iso })}
              title="Open this week's stripboard"
            >
              <span className="mc-top">
                <span className="mc-date">{date.getDate()}</span>
                {dayNo && <span className="mc-day">Day {dayNo}</span>}
              </span>
              {strips.slice(0, 4).map((s) => {
                const k = stripKind(s);
                return (
                  <span key={s.id} className="mc-strip" style={{ background: k.bg, color: k.ink }}>
                    <b>{s.scenes || '—'}</b> {s.set}
                  </span>
                );
              })}
              {strips.length > 4 && <span className="mc-more">+{strips.length - 4} more</span>}
              {strips.length > 0 && (
                <span className="mc-total">
                  {pagesLabel(eighths)} · {strips.length} sc
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="hint">Click any day to open that week's stripboard.</p>
    </div>
  );
}

// ---------------------------------------------------------------- Week stripboard

function WeekBoard(props: {
  project: Project;
  nav: ScheduleNav;
  setNav: (n: ScheduleNav) => void;
  dispatch: Dispatch<Action>;
  elMap: Map<string, BreakdownElement>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (draft: Draft) => void;
  onOpenPdr: (date: string) => void;
}) {
  const { project, nav, setNav, dispatch, elMap, selectedId, onSelect, onEdit, onOpenPdr } = props;
  const shotsPerSheet = useMemo(() => {
    const n = new Map<string, number>();
    for (const s of project.shots) n.set(s.sheetId, (n.get(s.sheetId) ?? 0) + 1);
    return n;
  }, [project.shots]);
  const monday = weekStart(fromISO(nav.date));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const sheets = useMemo(() => new Map(project.sheets.map((s) => [s.id, s])), [project.sheets]);
  const dayNumbers = useMemo(() => shootDayNumbers(project.schedule), [project.schedule]);
  const scheduled = useMemo(() => new Set(Object.values(project.schedule.byDate).flat()), [project.schedule]);
  const pool = project.sheets.filter((s) => !scheduled.has(s.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<{ id: string; before: boolean } | null>(null);
  const [overZone, setOverZone] = useState<string | null>(null);

  const endDrag = () => {
    setDragId(null);
    setIndicator(null);
    setOverZone(null);
  };
  const draggedId = (e: DragEvent) => e.dataTransfer.getData('text/plain') || dragId;
  const isBefore = (e: DragEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY - r.top < r.height / 2;
  };

  /** Drop on a card: insert before/after it in its day (pool order follows the script). */
  const dropOnCard = (e: DragEvent<HTMLElement>, target: Sheet, date: string | null, list: string[]) => {
    e.preventDefault();
    e.stopPropagation();
    const id = draggedId(e);
    endDrag();
    if (!id || id === target.id) return;
    if (date === null) return dispatch({ type: 'moveStrip', sheetId: id, date: null });
    const rest = list.filter((x) => x !== id);
    const at = rest.indexOf(target.id) + (isBefore(e) ? 0 : 1);
    dispatch({ type: 'moveStrip', sheetId: id, date, beforeId: rest[at] ?? null });
  };
  const zone = (key: string, date: string | null) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOverZone(key);
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverZone((z) => (z === key ? null : z));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const id = draggedId(e);
      endDrag();
      if (id) dispatch({ type: 'moveStrip', sheetId: id, date });
    },
  });

  const card = (s: Sheet, date: string | null, list: string[]) => {
    const k = stripKind(s);
    const cast = castIds(s, elMap);
    const ind = indicator?.id === s.id ? (indicator.before ? 'insert-before' : 'insert-after') : '';
    return (
      <div
        key={s.id}
        className={`card ${ind} ${dragId === s.id ? 'dragging' : ''} ${selectedId === s.id ? 'selected' : ''}`}
        style={{ background: k.bg, color: k.ink } as CSSProperties}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', s.id);
          e.dataTransfer.effectAllowed = 'move';
          setDragId(s.id);
        }}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIndicator({ id: s.id, before: isBefore(e) });
        }}
        onDrop={(e) => dropOnCard(e, s, date, list)}
        onClick={() => onSelect(s.id)}
        onDoubleClick={() =>
          onEdit({
            id: s.id,
            scenes: s.scenes,
            set: s.set,
            intExt: s.intExt || 'INT',
            dayNight: s.dayNight,
            pages: formatEighths(s.pages),
          })
        }
        title="Drag to schedule · double-click to edit"
      >
        <div className="card-row">
          <span className="card-scn">#{s.scenes || '—'}</span>
          <span className="card-len">{formatEighths(s.pages) || '—'}</span>
        </div>
        <div className="card-set">{s.set || 'Untitled set'}</div>
        <div className="card-row">
          <span className="card-tag">{k.label}</span>
          {cast.length > 0 && <span className="card-cast">Cast {cast.join(', ')}</span>}
        </div>
      </div>
    );
  };

  const sunday = days[6];
  return (
    <div className="week">
      <div className="sched-head">
        <button onClick={() => setNav({ mode: 'month', date: nav.date })}>← Month</button>
        <button onClick={() => setNav({ mode: 'week', date: toISO(addDays(monday, -7)) })} aria-label="Previous week">
          ‹
        </button>
        <h3 className="week-title">
          {fmtShort(monday)} – {fmtShort(sunday)} {sunday.getFullYear()}
        </h3>
        <button onClick={() => setNav({ mode: 'week', date: toISO(addDays(monday, 7)) })} aria-label="Next week">
          ›
        </button>
        <span className="spacer" />
        <Legend />
        <button
          className="primary"
          onClick={() => onEdit({ id: null, scenes: '', set: '', intExt: 'INT', dayNight: 'DAY', pages: '' })}
        >
          + Add scene
        </button>
        <button
          className="danger"
          disabled={scheduled.size === 0}
          onClick={async () =>
            (await askConfirm(
              'Move every scheduled scene back to Unscheduled? This clears the whole schedule, not just this week.',
            )) && dispatch({ type: 'clearSchedule' })
          }
        >
          Reset board
        </button>
      </div>

      <section>
        <h4 className="section-title">
          Unscheduled <span className="count">({pool.length})</span>
        </h4>
        <div className={`pool ${overZone === 'pool' ? 'drag-over' : ''}`} {...zone('pool', null)}>
          {pool.map((s) => card(s, null, []))}
          {pool.length === 0 && <span className="drop-hint">— drop scenes here —</span>}
        </div>
      </section>

      <section>
        <h4 className="section-title">Shooting days</h4>
        <div className="days-row">
          {days.map((date, i) => {
            const iso = toISO(date);
            const ids = project.schedule.byDate[iso] ?? [];
            const strips = ids.map((id) => sheets.get(id)).filter((s): s is Sheet => !!s);
            const eighths = strips.reduce((n, s) => n + s.pages, 0);
            const dayNo = dayNumbers.get(iso);
            const shots = strips.reduce((n, s) => n + (shotsPerSheet.get(s.id) ?? 0), 0);
            return (
              <div key={iso} className={`day-col ${iso === toISO(new Date()) ? 'today' : ''}`}>
                <div className="day-head">
                  <span className="dname">{WEEKDAYS[i]}</span>
                  <span className="ddate">{fmtShort(date)}</span>
                  {dayNo && <span className="dno">Day {dayNo}</span>}
                  <button
                    className={`pdr-btn ${dayNo ? '' : 'idle'}`}
                    onClick={() => onOpenPdr(iso)}
                    title={
                      shots
                        ? `Open this day's shooting plan (${shots} shot${shots === 1 ? '' : 's'})`
                        : "Add this day's shot list and open its shooting plan"
                    }
                  >
                    {shots ? 'Shooting plan' : '+ Shot list'}
                  </button>
                </div>
                <div className={`day-body ${overZone === iso ? 'drag-over' : ''}`} {...zone(iso, iso)}>
                  {strips.map((s) => card(s, iso, ids))}
                  {strips.length === 0 && <span className="drop-hint">— drop scenes here —</span>}
                </div>
                <div className="day-foot">
                  <span>Total</span>
                  <span className="sum">
                    {pagesLabel(eighths)} · {strips.length} sc{shots ? ` · ${shots} shots` : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <p className="hint">
        Drag cards between Unscheduled and a day, or between days. Drop on the top or bottom half of a card to insert
        before or after it. Double-click a card to edit it.
      </p>
    </div>
  );
}

export default function ScheduleView(props: {
  project: Project;
  nav: ScheduleNav;
  setNav: (n: ScheduleNav) => void;
  dispatch: Dispatch<Action>;
  elMap: Map<string, BreakdownElement>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenInBreakdown: (id: string) => void;
  onOpenPdr: (date: string) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  return (
    <div className="schedule">
      {props.nav.mode === 'month' ? (
        <MonthView project={props.project} nav={props.nav} setNav={props.setNav} />
      ) : (
        <WeekBoard {...props} onEdit={setDraft} />
      )}
      {draft && (
        <SceneModal
          draft={draft}
          onClose={() => setDraft(null)}
          dispatch={props.dispatch}
          onOpenInBreakdown={(id) => {
            setDraft(null);
            props.onOpenInBreakdown(id);
          }}
        />
      )}
    </div>
  );
}
