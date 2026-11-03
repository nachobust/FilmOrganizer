import { useMemo, useRef, useState, type Dispatch, type DragEvent } from 'react';
import {
  fromISO,
  SHOT_CATEGORIES,
  SHOT_TYPES,
  shootDayNumbers,
  type PdrSettings,
  type Project,
  type Shot,
  type ShotCategory,
  type ShotType,
} from '../model';
import { fmtClock, pdrShots, sequencePdr, toMinutes, type PdrRow, type PdrShot } from '../pdr';
import { exportPdrIntoTemplate, exportPdrXLSX, pdrLabels, rowLabel, timeText } from '../pdr-export';
import { askConfirm } from '../platform';
import { SHOT_LIST_ACCEPT } from '../shots';
import type { Action } from '../store';

/** A shooting date, or every shooting day at once. */
export type PdrDay = string | 'all';

const fmtDay = (iso: string) =>
  fromISO(iso).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const NUMBER_SETTINGS: [keyof PdrSettings, string][] = [
  ['prepMinutes', 'Prep'],
  ['lunchMinutes', 'Lunch length'],
  ['resetMinutes', 'Reset'],
  ['moveMinutes', 'Company move'],
  ['wrapMinutes', 'Wrap'],
  ['shotMinutes', 'Default shot'],
];

/** Enough rows for the text, so long descriptions are not cut off and short ones stay short. */
const textRows = (text: string, perLine: number) =>
  Math.max(1, text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0));

export default function PdrView(props: {
  project: Project;
  day: PdrDay | null;
  setDay: (d: PdrDay) => void;
  dispatch: Dispatch<Action>;
  /** Opens the file picker for this day's shot list. */
  onUploadForDay: (date: string) => void;
  onError: (e: unknown) => void;
  onGoToSchedule: () => void;
  onImportShotList: () => void;
}) {
  const { project, dispatch, onError } = props;
  const dayNumbers = useMemo(() => shootDayNumbers(project.schedule), [project.schedule]);
  const dates = [...dayNumbers.keys()];
  const day: PdrDay | null = props.day === 'all' || (props.day && dayNumbers.has(props.day)) ? props.day : (dates[0] ?? null);
  const selected = day === 'all' ? dates : day ? [day] : [];
  const single = day !== null && day !== 'all' ? day : null;

  const shots = useMemo(() => pdrShots(project, selected), [project, selected.join()]);
  const orders = useMemo(
    () =>
      new Map(
        selected.filter((d) => project.pdrOrder[d]).map((d) => [dayNumbers.get(d)!, project.pdrOrder[d]] as const),
      ),
    [project.pdrOrder, selected.join(), dayNumbers],
  );
  const rows = useMemo(() => sequencePdr(shots, project.pdr, orders), [shots, project.pdr, orders]);
  const labels = pdrLabels(project.pdr.sheetLanguage);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; before: boolean } | null>(null);
  const templateInput = useRef<HTMLInputElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);

  if (!dates.length)
    return (
      <div className="empty">
        <h2>No shooting days yet</h2>
        <p>
          The shooting plan is built per shooting day. Drag scenes onto days in Schedule, then open a day's shooting plan
          from its column. You can also start from a shot list.
        </p>
        <div className="empty-actions">
          <button className="primary" onClick={props.onGoToSchedule}>
            Go to Schedule
          </button>
          <button onClick={props.onImportShotList}>Import shot list</button>
        </div>
      </div>
    );

  const info = () =>
    day === 'all'
      ? { subtitle: `${dates.length} shooting days · ${fmtDay(dates[0])} – ${fmtDay(dates[dates.length - 1])}`, fileTag: '' }
      : { subtitle: `${labels.shootDay(dayNumbers.get(day!)!)} · ${fmtDay(day!)}`, fileTag: ` day ${dayNumbers.get(day!)}` };

  const runExport = async (fn: () => Promise<unknown>) => {
    exportMenu.current?.removeAttribute('open');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const shotCount = shots.filter((s) => !s.placeholder).length;
  const withoutList = [...new Set(shots.filter((s) => s.placeholder).map((s) => s.number || '—'))];
  const last = rows[rows.length - 1];
  const showTalent = shots.some((s) => s.talent.length);
  const columns = showTalent ? 9 : 8;
  const set = (patch: Partial<PdrSettings>) => dispatch({ type: 'setPdr', patch });

  /** Moves a row before or after another one; from then on this day keeps the user's order. */
  const reorder = (id: string, targetId: string, before: boolean) => {
    if (!single || id === targetId) return;
    const ids = rows.filter((r) => r.kind === 'shot').map((r) => r.shot!.id).filter((x) => x !== id);
    ids.splice(ids.indexOf(targetId) + (before ? 0 : 1), 0, id);
    dispatch({ type: 'setPdrOrder', date: single, ids });
  };

  const remove = async (s: PdrShot) => {
    if (!s.placeholder) return dispatch({ type: 'deleteShot', id: s.id });
    const date = selected.find((d) => (project.schedule.byDate[d] ?? []).includes(s.sheetId));
    if (date && (await askConfirm(`Take scene ${s.number || '—'} off this shooting day? It goes back to Unscheduled.`)))
      dispatch({ type: 'moveStrip', sheetId: s.sheetId, date: null });
  };

  return (
    <div className="pdr">
      <div className="sched-head">
        <select value={day ?? ''} onChange={(e) => props.setDay(e.target.value)} aria-label="Shooting day">
          {dates.map((d) => (
            <option key={d} value={d}>
              Day {dayNumbers.get(d)} · {fmtDay(d)}
            </option>
          ))}
          <option value="all">All shooting days</option>
        </select>
        {single && (
          <label className="shoot-date" title="Moves this whole shooting day to another date">
            Shoot date
            <input
              type="date"
              value={single}
              onChange={async (e) => {
                const to = e.target.value;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to === single) return;
                if (project.schedule.byDate[to]?.length && !(await askConfirm(`${fmtDay(to)} already has scenes. Add this day's scenes after them?`)))
                  return;
                dispatch({ type: 'moveDay', from: single, to });
                props.setDay(to);
              }}
            />
          </label>
        )}
        {single && (
          <button onClick={() => props.onUploadForDay(single)} title={`Accepts ${SHOT_LIST_ACCEPT.replace(/,/g, ', ')}`}>
            Upload shot list for this day…
          </button>
        )}
        {single && project.pdrOrder[single] && (
          <button
            onClick={() => dispatch({ type: 'setPdrOrder', date: single, ids: null })}
            title="Forget the order you set and let the app order the shots again"
          >
            Back to automatic order
          </button>
        )}
        <span className="muted">
          {shotCount} shot{shotCount === 1 ? '' : 's'}
          {last?.start !== undefined && ` · wraps ${timeText(last).replace(/.* /, '')}`}
        </span>
        <span className="spacer" />
        {busy && <span className="muted">Exporting…</span>}
        <details className="menu" ref={exportMenu}>
          <summary>Export shooting plan ▾</summary>
          <div className="menu-items">
            <button onClick={() => runExport(() => exportPdrXLSX(project, rows, info()))}>
              Excel <span className="muted">.xlsx</span>
            </button>
            <button
              onClick={() => {
                exportMenu.current?.removeAttribute('open');
                templateInput.current?.click();
              }}
              title="Keeps your template's header and call sheet and fills in the schedule below its column headers"
            >
              Into my own template… <span className="muted">.xlsx</span>
            </button>
          </div>
        </details>
        <input
          ref={templateInput}
          type="file"
          accept=".xlsx"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void runExport(() => exportPdrIntoTemplate(project, rows, info(), f));
          }}
        />
      </div>

      <div className="pdr-settings">
        <label>
          Call
          <input type="time" value={project.pdr.callTime} onChange={(e) => e.target.value && set({ callTime: e.target.value })} />
        </label>
        <label>
          Lunch at
          <input type="time" value={project.pdr.lunchAt} onChange={(e) => e.target.value && set({ lunchAt: e.target.value })} />
        </label>
        {NUMBER_SETTINGS.map(([key, label]) => (
          <label key={key}>
            {label}
            <span className="with-unit">
              <input
                type="number"
                min={0}
                step={5}
                value={project.pdr[key] as number}
                onChange={(e) => set({ [key]: Math.max(0, Number(e.target.value) || 0) })}
              />
              min
            </span>
          </label>
        ))}
        <label>
          Sheet labels
          <select
            value={project.pdr.sheetLanguage}
            onChange={(e) => set({ sheetLanguage: e.target.value as PdrSettings['sheetLanguage'] })}
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
      </div>

      {withoutList.length > 0 && (
        <p className="hint">
          {withoutList.length === 1 ? 'Scene' : 'Scenes'} {withoutList.join(', ')} {withoutList.length === 1 ? 'has' : 'have'} no
          shot list, so {withoutList.length === 1 ? 'it shows' : 'each shows'} as one row timed at about an hour per page.
          {single && ' Upload a shot list for this day to break them into shots.'}
        </p>
      )}

      <table className="pdr-table">
        <thead>
          <tr>
            <th className="c-drag" aria-label="Order" />
            <th className="c-time">Time</th>
            <th className="c-scene">Shot</th>
            <th className="c-desc">Description</th>
            {showTalent && <th className="c-talent">Talent</th>}
            <th className="c-type">Size</th>
            <th className="c-cat">Category</th>
            <th className="c-notes">Production notes</th>
            <th className="c-del" aria-label="Delete" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            if (r.kind !== 'shot') return <StructuralRow key={i} row={r} labels={labels} columns={columns} dispatch={dispatch} />;
            const s = r.shot!;
            const drop = dropAt?.id === s.id ? (dropAt.before ? 'drop-before' : 'drop-after') : '';
            return (
              <tr
                key={s.id}
                className={`pdr-shot ${s.keyShot ? 'key' : ''} ${s.placeholder ? 'placeholder' : ''} ${drop} ${dragId === s.id ? 'dragging' : ''}`}
                onDragOver={(e: DragEvent<HTMLTableRowElement>) => {
                  if (!dragId) return;
                  e.preventDefault();
                  const box = e.currentTarget.getBoundingClientRect();
                  setDropAt({ id: s.id, before: e.clientY - box.top < box.height / 2 });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dropAt) reorder(dragId, s.id, dropAt.before);
                  setDragId(null);
                  setDropAt(null);
                }}
              >
                <td className="c-drag">
                  {single && (
                    <span
                      className="drag-handle"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', s.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragId(s.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropAt(null);
                      }}
                      title="Drag to change the order"
                    >
                      ⋮⋮
                    </span>
                  )}
                </td>
                <ShotCells row={r} shot={s} showTalent={showTalent} dispatch={dispatch} defaultMinutes={project.pdr.shotMinutes} />
                <td className="c-del">
                  <button
                    className="ghost del"
                    onClick={() => void remove(s)}
                    title={s.placeholder ? 'Take this scene off the day' : 'Delete this shot'}
                    aria-label="Delete row"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">
        {single
          ? project.pdrOrder[single]
            ? 'You set the order of this day. Times follow it; resets and company moves are added when the setup or location changes. '
            : 'Shots are ordered by production logic: one location at a time, full-cast masters first, then each character closing in, inserts before leaving the location and field / product shots after lunch. Drag a row by ⋮⋮ to set your own order. '
          : 'Pick a single day to change the order of its shots. '}
        Edit the end time of a shot to change how long it takes. ⭐ marks a key shot.
      </p>
    </div>
  );
}

function StructuralRow(props: { row: PdrRow; labels: ReturnType<typeof pdrLabels>; columns: number; dispatch: Dispatch<Action> }) {
  const { row, labels, columns, dispatch } = props;
  const next = row.next;
  const editable = (row.kind === 'reset' || row.kind === 'move') && next && !next.placeholder;
  return (
    <tr className={`pdr-${row.kind}`}>
      <td className="c-drag" />
      <td className="c-time">{row.kind === 'end' || row.kind === 'daySep' ? '' : timeText(row)}</td>
      <td colSpan={columns - 2}>
        {rowLabel(row, labels)}
        {editable && (
          <span className="gap-edit">
            <input
              type="number"
              min={0}
              step={5}
              value={(row.end ?? 0) - (row.start ?? 0)}
              onChange={(e) =>
                dispatch({ type: 'updateShot', id: next.id, patch: { gapMinutes: Math.max(0, Math.round(Number(e.target.value) || 0)) } })
              }
              aria-label="Minutes"
            />
            min
          </span>
        )}
      </td>
    </tr>
  );
}

function ShotCells(props: {
  row: PdrRow;
  shot: PdrShot;
  showTalent: boolean;
  dispatch: Dispatch<Action>;
  defaultMinutes: number;
}) {
  const { row, shot: s, dispatch } = props;
  const update = (patch: Partial<Shot>) => dispatch({ type: 'updateShot', id: s.id, patch });
  const start = row.start ?? 0;
  const notes = [...s.alerts, s.notes].filter(Boolean).join('\n');
  return (
    <>
      <td className="c-time">
        <span className="time-range">
          {fmtClock(start)} –
          {s.placeholder ? (
            <span> {fmtClock(row.end ?? start)}</span>
          ) : (
            <input
              type="time"
              value={fmtClock(row.end ?? start)}
              onChange={(e) => {
                if (!e.target.value) return;
                const minutes = toMinutes(e.target.value) - start;
                if (minutes > 0) update({ minutes });
              }}
              aria-label="Ends at"
              title={`Ends at (default length ${props.defaultMinutes} min)`}
            />
          )}
        </span>
      </td>
      <td className="c-scene">
        <b>{s.number || '—'}</b>
        {s.location && <div className="muted">{s.location}</div>}
      </td>
      <td className="c-desc">
        <textarea
          className="cell-text"
          value={s.description}
          rows={textRows(s.description, 48)}
          placeholder="Description"
          onChange={(e) =>
            s.placeholder
              ? dispatch({ type: 'updateSheet', id: s.sheetId, patch: { synopsis: e.target.value } })
              : update({ description: e.target.value })
          }
          aria-label="Description"
        />
      </td>
      {props.showTalent && <td className="c-talent">{s.talent.join(', ')}</td>}
      <td className="c-type">
        {s.placeholder ? (
          <span className="muted">No shot list</span>
        ) : (
          <span className="type-cell">
            <select value={s.type} onChange={(e) => update({ type: e.target.value as ShotType | '' })} aria-label="Shot size">
              <option value="">—</option>
              {SHOT_TYPES.map((t) => (
                <option key={t.key} value={t.key} title={t.name}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              className={`star ${s.keyShot ? 'on' : ''}`}
              onClick={() => update({ keyShot: !s.keyShot })}
              title={s.keyShot ? 'Key shot (click to unmark)' : 'Mark as key shot'}
            >
              ⭐
            </button>
          </span>
        )}
      </td>
      <td className="c-cat">
        {!s.placeholder && (
          <select value={s.category} onChange={(e) => update({ category: e.target.value as ShotCategory })} aria-label="Category">
            {SHOT_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className={`c-notes ${s.alerts.length ? 'alert' : ''}`}>
        {s.placeholder ? (
          notes
        ) : (
          <textarea
            className="cell-text"
            value={s.notes}
            rows={textRows(s.notes, 30)}
            placeholder="Notes"
            onChange={(e) => update({ notes: e.target.value })}
            aria-label="Production notes"
          />
        )}
        {!s.placeholder && s.alerts.length > 0 && <div className="alert-text">{s.alerts.join('\n')}</div>}
        {s.movement && <div className="muted">Camera: {s.movement}</div>}
      </td>
    </>
  );
}
