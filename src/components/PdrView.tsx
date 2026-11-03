import { useEffect, useMemo, useRef, useState, type Dispatch, type DragEvent } from 'react';
import {
  fromISO,
  SHOT_CATEGORIES,
  SHOT_TYPES,
  shootDayNumbers,
  uid,
  type PdrSettings,
  type PlanItem,
  type PlanItemKind,
  type Project,
  type Shot,
  type ShotCategory,
  type ShotType,
} from '../model';
import {
  defaultMinutes,
  fmtClock,
  isPlanRow,
  pdrShots,
  planFromRows,
  planWarnings,
  sequencePdr,
  toMinutes,
  type PdrRow,
  type PdrShot,
} from '../pdr';
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

const ADD_ROWS: [PlanItemKind, string][] = [
  ['reset', 'Reset'],
  ['move', 'Company move'],
  ['lunch', 'Lunch'],
  ['break', 'Break (your own name)'],
];

/** Enough rows for the text, so long descriptions are not cut off and short ones stay short. */
const textRows = (text: string, perLine: number) =>
  Math.max(1, text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0));

/** A move waiting for the user to confirm it in the warning popup. */
interface PendingMove {
  title: string;
  lines: string[];
  warnings: string[];
  items: PlanItem[];
}

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
  const dayNo = single ? dayNumbers.get(single)! : 0;

  const shots = useMemo(() => pdrShots(project, selected), [project, selected.join()]);
  const byDay = <T,>(src: Record<string, T>) =>
    new Map(selected.filter((d) => src[d]).map((d) => [dayNumbers.get(d)!, src[d]] as const));
  const orders = useMemo(() => byDay(project.pdrOrder), [project.pdrOrder, selected.join(), dayNumbers]);
  const plans = useMemo(() => byDay(project.pdrPlan), [project.pdrPlan, selected.join(), dayNumbers]);
  const rows = useMemo(() => sequencePdr(shots, project.pdr, orders, plans), [shots, project.pdr, orders, plans]);
  const warnings = useMemo(() => planWarnings(rows), [rows]);
  const labels = pdrLabels(project.pdr.sheetLanguage);
  const [busy, setBusy] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ key: string; before: boolean } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingMove | null>(null);
  const templateInput = useRef<HTMLInputElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const addMenu = useRef<HTMLDetailsElement>(null);

  useEffect(() => setPicked(new Set()), [day]);

  if (!dates.length)
    return (
      <div className="empty">
        <h2>No shooting days yet</h2>
        <p>
          The shooting plan is built per shooting day. Import a shot list, or drag scenes onto days in Schedule and open a
          day's shooting plan from its column.
        </p>
        <div className="empty-actions">
          <button className="primary" onClick={props.onImportShotList}>
            Import shot list
          </button>
          <button onClick={props.onGoToSchedule}>Go to Schedule</button>
        </div>
      </div>
    );

  // ---- The day as an editable list: plan items, each tied to the row it is shown in.
  const planIdx = rows.map((r, i) => (isPlanRow(r) ? i : -1)).filter((i) => i >= 0);
  const keyOf = (i: number) => rows[i].planId ?? rows[i].shot?.id ?? `${rows[i].kind}@${i}`;
  const indexOfKey = (key: string) => planIdx.find((i) => keyOf(i) === key) ?? -1;
  /** The day's rows as plan items, in order; a day still in the automatic order becomes a plan here. */
  const currentItems = () => planFromRows(rows);
  const itemAt = (items: PlanItem[], row: number) => items[planIdx.indexOf(row)];
  const commit = (items: PlanItem[]) => {
    if (!single) return;
    dispatch({ type: 'setPdrPlan', date: single, items });
    setPicked(new Set());
  };
  const isPlan = !!(single && project.pdrPlan[single]);
  const isCustom = !!(single && (project.pdrPlan[single] || project.pdrOrder[single]));

  const info = () =>
    day === 'all'
      ? { subtitle: `${dates.length} shooting days · ${fmtDay(dates[0])} – ${fmtDay(dates[dates.length - 1])}`, fileTag: '' }
      : { subtitle: `${labels.shootDay(dayNo)} · ${fmtDay(day!)}`, fileTag: ` day ${dayNo}` };

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

  // ---- Editing
  const setStart = (row: number, value: string) => {
    const items = currentItems();
    const item = itemAt(items, row);
    if (!item) return;
    if (value) item.at = toMinutes(value);
    else delete item.at;
    commit(items);
  };

  const setEnd = (row: number, value: string) => {
    const r = rows[row];
    if (!value || r.start === undefined) return;
    const minutes = toMinutes(value) - r.start;
    if (minutes <= 0) return;
    // A shot's length belongs to the shot; other rows keep theirs in the plan.
    if (r.shot && !r.shot.placeholder) return dispatch({ type: 'updateShot', id: r.shot.id, patch: { minutes } });
    const items = currentItems();
    const item = itemAt(items, row);
    if (!item) return;
    item.minutes = minutes;
    commit(items);
  };

  const setLabel = (row: number, text: string) => {
    const items = currentItems();
    const item = itemAt(items, row);
    if (!item) return;
    if (text.trim()) item.label = text;
    else delete item.label;
    commit(items);
  };

  const addRow = (kind: PlanItemKind) => {
    addMenu.current?.removeAttribute('open');
    commit([...currentItems(), { id: uid(), kind, minutes: defaultMinutes(kind, project.pdr), ...(kind === 'break' ? { label: 'Break' } : {}) }]);
  };

  const remove = async (rowsToRemove: number[]) => {
    const list = rowsToRemove.map((i) => rows[i]);
    const shotsGone = list.filter((r) => r.shot && !r.shot.placeholder);
    const scenesOff = list.filter((r) => r.shot?.placeholder);
    if (
      (list.length > 1 || scenesOff.length) &&
      !(await askConfirm(
        [
          `Delete ${list.length === 1 ? 'this row' : `these ${list.length} rows`}?`,
          shotsGone.length ? `${shotsGone.length} shot${shotsGone.length === 1 ? ' is' : 's are'} removed from the shot list.` : '',
          scenesOff.length ? `${scenesOff.length} scene${scenesOff.length === 1 ? ' goes' : 's go'} back to Unscheduled.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      ))
    )
      return;
    const gone = new Set(rowsToRemove);
    const items = currentItems().filter((_, k) => !gone.has(planIdx[k]));
    for (const r of shotsGone) dispatch({ type: 'deleteShot', id: r.shot!.id });
    for (const r of scenesOff) dispatch({ type: 'moveStrip', sheetId: r.shot!.sheetId, date: null });
    if (single && (isPlan || list.some((r) => !r.shot))) commit(items);
    else setPicked(new Set());
  };

  /** Works out what a move changes, and asks before doing it. */
  const proposeMove = (dragged: string, target: string, before: boolean) => {
    if (!single) return;
    const moving = (picked.has(dragged) ? planIdx.filter((i) => picked.has(keyOf(i))) : [indexOfKey(dragged)]).filter((i) => i >= 0);
    const targetRow = indexOfKey(target);
    if (!moving.length || targetRow < 0 || moving.includes(targetRow)) return;
    const items = currentItems();
    const movingItems = moving.map((i) => ({ ...itemAt(items, i) }));
    for (const m of movingItems) delete m.at; // a moved row starts where it lands
    const targetItem = itemAt(items, targetRow);
    const rest = items.filter((_, k) => !moving.includes(planIdx[k]));
    rest.splice(rest.indexOf(targetItem) + (before ? 0 : 1), 0, ...movingItems);

    const next = sequencePdr(shots, project.pdr, orders, new Map([...plans, [dayNo, rest]]));
    const wrap = (rs: PdrRow[]) => rs.find((r) => r.kind === 'end')?.start;
    const [was, now] = [wrap(rows), wrap(next)];
    const lines: string[] = [];
    if (was !== undefined && now !== undefined)
      lines.push(was === now ? `The day still ends at ${fmtClock(now)}.` : `The day now ends at ${fmtClock(now)} (was ${fmtClock(was)}).`);
    const lunchStart = (rs: PdrRow[]) => rs.find((r) => r.kind === 'lunch')?.start;
    const [l1, l2] = [lunchStart(rows), lunchStart(next)];
    if (l2 !== undefined && l1 !== l2) lines.push(`Lunch now starts at ${fmtClock(l2)}${l1 !== undefined ? ` (was ${fmtClock(l1)})` : ''}.`);
    const afterLunch = (rs: PdrRow[], id: string) => {
      const li = rs.findIndex((r) => r.kind === 'lunch');
      const si = rs.findIndex((r) => r.shot?.id === id);
      return li >= 0 && si > li;
    };
    for (const m of movingItems)
      if (m.kind === 'shot' && afterLunch(rows, m.id) !== afterLunch(next, m.id)) {
        const s = shots.find((x) => x.id === m.id);
        lines.push(`Shot ${s?.number || '—'} is now ${afterLunch(next, m.id) ? 'after' : 'before'} lunch.`);
      }
    const old = new Set(warnings.map((w) => w.text));
    const fresh = [...new Set(planWarnings(next).map((w) => w.text))].filter((t) => !old.has(t));
    const what = moving.length === 1 ? (rows[moving[0]].shot ? `shot ${rows[moving[0]].shot!.number || '—'}` : 'this row') : `${moving.length} rows`;
    setPending({ title: `Move ${what}?`, lines, warnings: fresh, items: rest });
  };

  const endDrag = () => {
    setDragKey(null);
    setDropAt(null);
  };

  const togglePick = (key: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const shotCount = shots.filter((s) => !s.placeholder).length;
  const withoutList = [...new Set(shots.filter((s) => s.placeholder).map((s) => s.number || '—'))];
  const last = rows[rows.length - 1];
  const showTalent = shots.some((s) => s.talent.length);
  const columns = showTalent ? 9 : 8;
  const set = (patch: Partial<PdrSettings>) => dispatch({ type: 'setPdr', patch });
  const warningsAt = (i: number) => warnings.filter((w) => w.row === i).map((w) => w.text);
  const pickedRows = planIdx.filter((i) => picked.has(keyOf(i)));

  /** Drag handle, checkbox and drop target shared by shot rows and the rows between them. */
  const rowDnD = (i: number) => {
    const key = keyOf(i);
    return {
      className: `${dropAt?.key === key ? (dropAt.before ? 'drop-before' : 'drop-after') : ''} ${
        dragKey && (dragKey === key || (picked.has(dragKey) && picked.has(key))) ? 'dragging' : ''
      } ${picked.has(key) ? 'picked' : ''}`,
      onDragOver: (e: DragEvent<HTMLTableRowElement>) => {
        if (!dragKey) return;
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        setDropAt({ key, before: e.clientY - box.top < box.height / 2 });
      },
      onDrop: (e: DragEvent<HTMLTableRowElement>) => {
        e.preventDefault();
        if (dragKey && dropAt) proposeMove(dragKey, dropAt.key, dropAt.before);
        endDrag();
      },
      handle: single && (
        <span className="row-tools">
          <input type="checkbox" checked={picked.has(key)} onChange={() => togglePick(key)} aria-label="Select row" />
          <span
            className="drag-handle"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', key);
              e.dataTransfer.effectAllowed = 'move';
              setDragKey(key);
            }}
            onDragEnd={endDrag}
            title={picked.has(key) && picked.size > 1 ? `Drag to move the ${picked.size} selected rows` : 'Drag to move this row'}
          >
            ⋮⋮
          </span>
        </span>
      ),
    };
  };

  const timeCell = (i: number) => {
    const r = rows[i];
    const start = r.start ?? 0;
    const end = r.end ?? start;
    if (!single) return <td className="c-time">{timeText(r)}</td>;
    return (
      <td className="c-time">
        <span className="time-range">
          <input
            type="time"
            className={r.pinned ? 'pinned' : ''}
            value={fmtClock(start)}
            onChange={(e) => setStart(i, e.target.value)}
            aria-label="Starts at"
            title={r.pinned ? 'Fixed start time. Clear it to follow the row above again.' : 'Starts at (set a time to fix it)'}
          />
          –
          <input type="time" value={fmtClock(end)} onChange={(e) => setEnd(i, e.target.value)} aria-label="Ends at" title="Ends at" />
        </span>
      </td>
    );
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
        {single && (
          <details className="menu" ref={addMenu}>
            <summary>+ Add row ▾</summary>
            <div className="menu-items">
              {ADD_ROWS.map(([kind, label]) => (
                <button key={kind} onClick={() => addRow(kind)}>
                  {label}
                </button>
              ))}
            </div>
          </details>
        )}
        {isCustom && (
          <button
            onClick={async () =>
              (await askConfirm('Go back to the automatic order? Your order, added rows and fixed times for this day are lost.')) &&
              dispatch({ type: 'setPdrPlan', date: single!, items: null })
            }
            title="Forget your own order and let the app order the day again"
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

      {pickedRows.length > 0 && (
        <div className="pick-bar" role="status">
          {pickedRows.length} row{pickedRows.length === 1 ? '' : 's'} selected · drag any of them to move them together
          <button className="danger" onClick={() => void remove(pickedRows)}>
            Delete selected
          </button>
          <button className="ghost" onClick={() => setPicked(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <table className="pdr-table">
        <thead>
          <tr>
            <th className="c-drag" aria-label="Select and move" />
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
            const rowWarnings = warningsAt(i);
            if (!isPlanRow(r))
              return (
                <tr key={`${r.kind}-${i}`} className={`pdr-${r.kind}`}>
                  <td className="c-drag" />
                  <td className="c-time">{r.kind === 'end' || r.kind === 'daySep' ? '' : timeText(r)}</td>
                  <td colSpan={columns - 2}>{rowLabel(r, labels)}</td>
                </tr>
              );
            const dnd = rowDnD(i);
            const del = (
              <td className="c-del">
                {single && (
                  <button
                    className="ghost del"
                    onClick={() => void remove([i])}
                    title={r.shot?.placeholder ? 'Take this scene off the day' : 'Delete this row'}
                    aria-label="Delete row"
                  >
                    ×
                  </button>
                )}
              </td>
            );
            if (!r.shot)
              return (
                <tr key={keyOf(i)} className={`pdr-${r.kind} pdr-gap ${dnd.className}`} onDragOver={dnd.onDragOver} onDrop={dnd.onDrop}>
                  <td className="c-drag">{dnd.handle}</td>
                  {timeCell(i)}
                  <td colSpan={columns - 3}>
                    {single ? (
                      <input
                        className="gap-label"
                        value={rowLabel(r, labels)}
                        onChange={(e) => setLabel(i, e.target.value)}
                        aria-label="Row name"
                      />
                    ) : (
                      rowLabel(r, labels)
                    )}
                    {rowWarnings.map((w) => (
                      <div key={w} className="row-warning">
                        ⚠ {w}
                      </div>
                    ))}
                  </td>
                  {del}
                </tr>
              );
            const s = r.shot;
            return (
              <tr
                key={keyOf(i)}
                className={`pdr-shot ${s.keyShot ? 'key' : ''} ${s.placeholder ? 'placeholder' : ''} ${dnd.className}`}
                onDragOver={dnd.onDragOver}
                onDrop={dnd.onDrop}
              >
                <td className="c-drag">{dnd.handle}</td>
                {timeCell(i)}
                <ShotCells shot={s} showTalent={showTalent} dispatch={dispatch} warnings={rowWarnings} />
                {del}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">
        {single
          ? isPlan
            ? 'This day follows your own layout: rows run in the order you set, and nothing is added for you. ⚠ marks a possible problem. '
            : 'Shots are ordered by production logic: one location at a time, full-cast masters first, then each character closing in, inserts before leaving the location and field / product shots after lunch. '
          : 'Pick a single day to move, add or retime rows. '}
        {single &&
          'Drag rows by ⋮⋮, or tick several and drag one of them to move them together. Change a start time to fix it, or an end time to change how long a row takes. '}
        ⭐ marks a key shot.
      </p>

      {pending && (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setPending(null)}>
          <div className="modal" role="dialog" aria-labelledby="move-title">
            <h3 id="move-title">{pending.title}</h3>
            {pending.lines.map((l) => (
              <p key={l} className="modal-text">
                {l}
              </p>
            ))}
            {pending.warnings.length > 0 ? (
              <div className="move-warnings">
                <b>Check before moving:</b>
                <ul>
                  {pending.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="modal-text small">No problems found with the new order.</p>
            )}
            <div className="modal-actions">
              <span className="spacer" />
              <button onClick={() => setPending(null)}>Cancel</button>
              <button
                className="primary"
                autoFocus
                onClick={() => {
                  commit(pending.items);
                  setPending(null);
                }}
              >
                Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShotCells(props: { shot: PdrShot; showTalent: boolean; dispatch: Dispatch<Action>; warnings: string[] }) {
  const { shot: s, dispatch } = props;
  const update = (patch: Partial<Shot>) => dispatch({ type: 'updateShot', id: s.id, patch });
  const notes = [...s.alerts, s.notes].filter(Boolean).join('\n');
  return (
    <>
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
        {props.warnings.map((w) => (
          <div key={w} className="row-warning">
            ⚠ {w}
          </div>
        ))}
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
