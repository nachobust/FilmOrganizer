// Call sheets: what each shooting day needs on one page, built from the schedule, the shooting
// plan and the production details (cast, crew, locations). Also the schedule checks behind it:
// actors scheduled on dates they can't shoot, and scenes on days off.

import {
  formatEighths,
  fromISO,
  shootDayNumbers,
  type BreakdownElement,
  type CastTimes,
  type Project,
  type Sheet,
} from './model';
import { fmtClock, pdrShots, sequencePdr, type PdrRow } from './pdr';

/** A day has a shooting plan once it has a shot list, or once the user started or arranged one. */
export function planStarted(p: Project, date: string): boolean {
  return (
    p.pdrStarted.includes(date) ||
    !!p.pdrPlan[date] ||
    !!p.pdrOrder[date] ||
    p.shots.some((s) => (p.schedule.byDate[date] ?? []).includes(s.sheetId))
  );
}

/** The shooting plan rows of one day, as the Shooting plan tab shows them; none if it isn't started. */
export function dayPlanRows(p: Project, date: string): PdrRow[] {
  if (!planStarted(p, date)) return [];
  const dayNo = shootDayNumbers(p.schedule).get(date) ?? 1;
  const orders = new Map(p.pdrOrder[date] ? [[dayNo, p.pdrOrder[date]]] : []);
  const plans = new Map(p.pdrPlan[date] ? [[dayNo, p.pdrPlan[date]]] : []);
  return sequencePdr(pdrShots(p, [date]), p.pdr, orders, plans);
}

/** Confirmed cast in a scene, by cast ID. */
export function castIn(p: Project, sheet: Sheet): BreakdownElement[] {
  const els = new Map(p.elements.map((e) => [e.id, e]));
  return sheet.tags
    .filter((t) => t.state === 'confirmed')
    .map((t) => els.get(t.elementId))
    .filter((e): e is BreakdownElement => !!e && e.categoryId === 'cast')
    .sort((a, b) => (a.castId ?? 999) - (b.castId ?? 999));
}

export interface Conflict {
  date: string;
  sheetId: string;
  /** The actor's character, when the problem is availability. */
  elementId?: string;
  text: string;
  /** A few words for a stripboard card. */
  short: string;
}

const sceneName = (s: Sheet) => `scene ${s.scenes || '—'}`;
const fmtDate = (iso: string) => fromISO(iso).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });

/** Scenes on days off, and characters scheduled on dates their actor can't shoot. */
export function scheduleConflicts(p: Project): Conflict[] {
  const sheets = new Map(p.sheets.map((s) => [s.id, s]));
  const out: Conflict[] = [];
  for (const [date, ids] of Object.entries(p.schedule.byDate))
    for (const id of ids) {
      const sheet = sheets.get(id);
      if (!sheet) continue;
      if (p.daysOff.includes(date))
        out.push({ date, sheetId: id, short: 'Day off', text: `${fmtDate(date)} is a day off, but ${sceneName(sheet)} is scheduled on it.` });
      for (const el of castIn(p, sheet))
        if (el.unavailable?.includes(date))
          out.push({
            date,
            sheetId: id,
            elementId: el.id,
            short: `${el.name} not available`,
            text: `${el.actor || el.name} (${el.name}) can't shoot on ${fmtDate(date)}, but is in ${sceneName(sheet)}.`,
          });
    }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface CallSheetScene {
  sheetId: string;
  scene: string;
  ieDn: string;
  set: string;
  synopsis: string;
  pages: string;
  cast: string;
  /** Start time from the shooting plan; empty when the day's plan isn't started. */
  time: string;
}

export interface CallSheetCast extends CastTimes {
  elementId: string;
  id: string;
  character: string;
  actor: string;
  phone: string;
  /** Why this actor shouldn't be scheduled today, if so. */
  warning: string;
}

export interface CallSheet {
  date: string;
  dateText: string;
  dayNo: number;
  totalDays: number;
  title: string;
  dayOff: boolean;
  times: { crewCall: string; shooting: string; lunch: string; wrap: string; end: string };
  sunrise: string;
  sunset: string;
  weather: string;
  notes: string;
  contacts: { role: string; name: string; phone: string }[];
  locations: { set: string; address: string; parking: string; hospital: string; notes: string }[];
  scenes: CallSheetScene[];
  cast: CallSheetCast[];
  crew: { department: string; role: string; name: string; phone: string; call: string }[];
  conflicts: string[];
}

export function buildCallSheet(p: Project, date: string): CallSheet {
  const dayNumbers = shootDayNumbers(p.schedule);
  const byId = new Map(p.sheets.map((s) => [s.id, s]));
  const sheets = (p.schedule.byDate[date] ?? []).map((id) => byId.get(id)).filter((s): s is Sheet => !!s);
  const rows = dayPlanRows(p, date);
  const day = p.callSheets[date];
  const crewCall = p.pdr.callTime;
  const at = (kind: PdrRow['kind']) => {
    const r = rows.find((x) => x.kind === kind);
    return r?.start !== undefined ? fmtClock(r.start) : '';
  };
  const firstShot = rows.find((r) => r.kind === 'shot');
  /** When a scene starts in the shooting plan (its first row). */
  const sceneStart = (sheetId: string) => {
    const r = rows.find((x) => x.shot?.sheetId === sheetId);
    return r?.start !== undefined ? fmtClock(r.start) : '';
  };

  const scenes: CallSheetScene[] = sheets.map((s) => ({
    sheetId: s.id,
    scene: s.scenes,
    ieDn: [s.intExt, s.dayNight].filter(Boolean).join(' · '),
    set: s.set,
    synopsis: s.synopsis,
    pages: formatEighths(s.pages),
    cast: castIn(p, s)
      .map((e) => e.castId ?? e.name)
      .join(', '),
    time: sceneStart(s.id),
  }));

  // Each character once, in cast ID order; on set when their first scene starts.
  const seen = new Map<string, { el: BreakdownElement; firstScene: string }>();
  for (const s of sheets) for (const el of castIn(p, s)) if (!seen.has(el.id)) seen.set(el.id, { el, firstScene: s.id });
  const cast: CallSheetCast[] = [...seen.values()]
    .sort((a, b) => (a.el.castId ?? 999) - (b.el.castId ?? 999))
    .map(({ el, firstScene }) => {
      const t = day?.cast[el.id] ?? {};
      return {
        elementId: el.id,
        id: el.castId ? String(el.castId) : '',
        character: el.name,
        actor: el.actor ?? '',
        phone: el.phone ?? '',
        pickup: t.pickup ?? '',
        call: t.call ?? crewCall,
        makeup: t.makeup ?? '',
        onSet: t.onSet ?? sceneStart(firstScene),
        warning: el.unavailable?.includes(date) ? 'Not available on this date' : '',
      };
    });

  const sets = [...new Set(sheets.map((s) => s.set).filter(Boolean))];
  const pr = p.production;
  return {
    date,
    dateText: fromISO(date).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    dayNo: dayNumbers.get(date) ?? 0,
    totalDays: dayNumbers.size,
    title: p.title,
    dayOff: p.daysOff.includes(date),
    times: {
      crewCall,
      shooting: firstShot?.start !== undefined ? fmtClock(firstShot.start) : '',
      lunch: at('lunch'),
      wrap: at('wrap'),
      end: at('end'),
    },
    sunrise: day?.sunrise ?? '',
    sunset: day?.sunset ?? '',
    weather: day?.weather ?? '',
    notes: day?.notes ?? '',
    contacts: [
      { role: 'Director', name: pr.director, phone: '' },
      { role: 'Producer', name: pr.producer, phone: '' },
      { role: 'Production manager', name: pr.productionManager, phone: pr.contactPhone },
    ].filter((c) => c.name || c.phone),
    locations: sets.map((set) => {
      const l = pr.locations[set.toUpperCase()];
      return { set, address: l?.address ?? '', parking: l?.parking ?? '', hospital: l?.hospital ?? '', notes: l?.notes ?? '' };
    }),
    scenes,
    cast,
    crew: pr.crew.map((c) => ({ department: c.department, role: c.role, name: c.name, phone: c.phone, call: c.call || crewCall })),
    conflicts: scheduleConflicts(p)
      .filter((c) => c.date === date)
      .map((c) => c.text),
  };
}
