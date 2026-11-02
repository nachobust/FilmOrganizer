import { useMemo, useRef, useState, type Dispatch } from 'react';
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
import { pdrShots, sequencePdr, type PdrRow } from '../pdr';
import { exportPdrIntoTemplate, exportPdrXLSX, pdrLabels, rowLabel, timeText } from '../pdr-export';
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

  const shots = useMemo(() => pdrShots(project, selected), [project, selected.join()]);
  const rows = useMemo(() => sequencePdr(shots, project.pdr), [shots, project.pdr]);
  const labels = pdrLabels(project.pdr.sheetLanguage);
  const [busy, setBusy] = useState(false);
  const templateInput = useRef<HTMLInputElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);

  if (!dates.length)
    return (
      <div className="empty">
        <h2>No shooting days yet</h2>
        <p>
          The PDR (shooting plan) is built per shooting day. Drag scenes onto days in Schedule, then open a day's PDR from
          its column. You can also start from a shot list.
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
  const set = (patch: Partial<PdrSettings>) => dispatch({ type: 'setPdr', patch });

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
        {day !== 'all' && (
          <button onClick={() => props.onUploadForDay(day!)} title={`Accepts ${SHOT_LIST_ACCEPT.replace(/,/g, ', ')}`}>
            Upload shot list for this day…
          </button>
        )}
        <span className="muted">
          {shotCount} shot{shotCount === 1 ? '' : 's'}
          {last?.start !== undefined && ` · wraps ${timeText(last).replace(/.* /, '')}`}
        </span>
        <span className="spacer" />
        {busy && <span className="muted">Exporting…</span>}
        <details className="menu" ref={exportMenu}>
          <summary>Export PDR ▾</summary>
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
              Into my PDR template… <span className="muted">.xlsx</span>
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
          {day !== 'all' && ' Upload a shot list for this day to break them into shots.'}
        </p>
      )}

      <table className="pdr-table">
        <thead>
          <tr>
            <th className="c-time">Time</th>
            <th className="c-scene">Scene</th>
            <th>Description</th>
            <th className="c-talent">Talent</th>
            <th className="c-type">Shot</th>
            <th className="c-cat">Category</th>
            <th className="c-min">Min</th>
            <th>Production notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <Row key={i} row={r} labels={labels} dispatch={dispatch} defaultMinutes={project.pdr.shotMinutes} />
          ))}
        </tbody>
      </table>
      <p className="hint">
        Shots are ordered by production logic, not script order: full-cast masters first, then each character closing in,
        inserts before lunch and field / product shots after it. Change a shot's category, size or minutes and the day
        re-times itself. ⭐ marks a key shot.
      </p>
    </div>
  );
}

function Row(props: {
  row: PdrRow;
  labels: ReturnType<typeof pdrLabels>;
  dispatch: Dispatch<Action>;
  defaultMinutes: number;
}) {
  const { row, labels, dispatch } = props;
  if (row.kind !== 'shot')
    return (
      <tr className={`pdr-${row.kind}`}>
        <td className="c-time">{row.kind === 'end' || row.kind === 'daySep' ? '' : timeText(row)}</td>
        <td colSpan={7}>{rowLabel(row, labels)}</td>
      </tr>
    );
  const s = row.shot!;
  const update = (patch: Partial<Shot>) =>
    dispatch({ type: 'updateShot', id: s.id, patch });
  return (
    <tr className={`pdr-shot ${s.keyShot ? 'key' : ''} ${s.placeholder ? 'placeholder' : ''}`}>
      <td className="c-time">{timeText(row)}</td>
      <td className="c-scene">
        <b>{s.number || '—'}</b>
        {s.location && <div className="muted">{s.location}</div>}
      </td>
      <td>{s.description}</td>
      <td className="c-talent">{s.talent.join(', ')}</td>
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
      <td className="c-min">
        {!s.placeholder ? (
          <input
            type="number"
            min={1}
            value={s.minutes ?? ''}
            placeholder={String(props.defaultMinutes)}
            onChange={(e) => update({ minutes: Number(e.target.value) > 0 ? Math.round(Number(e.target.value)) : null })}
            aria-label="Shooting minutes"
          />
        ) : (
          (row.end ?? 0) - (row.start ?? 0)
        )}
      </td>
      <td className={s.alerts.length ? 'alert' : ''}>
        {[...s.alerts, s.notes, s.movement && `Camera: ${s.movement}`].filter(Boolean).join('\n')}
      </td>
    </tr>
  );
}
