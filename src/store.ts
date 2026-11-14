import {
  DEFAULT_PDR,
  newCallSheetDay,
  newProduction,
  newSchedule,
  newSheet,
  uid,
  type BreakdownElement,
  type CallSheetDay,
  type CastTimes,
  type CrewMember,
  type LocationInfo,
  type PdrSettings,
  type Production,
  type PlanItem,
  type PlanItemKind,
  type Project,
  type Sheet,
  type Shot,
  type ShotCategory,
  type ShotType,
  type Tag,
  type TagSource,
  type TagState,
} from './model';

export type Action =
  | { type: 'load'; project: Project }
  | { type: 'setTitle'; title: string }
  | { type: 'updateSheet'; id: string; patch: Partial<Sheet> }
  | { type: 'addSheet'; afterId?: string; patch?: Partial<Sheet> }
  | { type: 'deleteSheet'; id: string }
  | {
      type: 'addTag';
      sheetId: string;
      categoryId: string;
      name: string;
      state?: TagState;
      source?: TagSource;
      quote?: string;
      by?: string;
    }
  /** Pending suggestions from the rules or an AI; existing tags and rejected elements are kept. */
  | {
      type: 'addSuggestions';
      source: TagSource;
      items: { sheetId: string; categoryId: string; name: string; quote?: string; by?: string }[];
    }
  | { type: 'removeTag'; sheetId: string; elementId: string }
  | { type: 'acceptTag'; sheetId: string; elementId: string }
  | { type: 'rejectTag'; sheetId: string; elementId: string }
  | { type: 'acceptAll'; sheetId?: string }
  | { type: 'renameElement'; elementId: string; name: string }
  | { type: 'deleteElement'; elementId: string }
  /** date null = back to unscheduled; beforeId null = end of the day. */
  | { type: 'moveStrip'; sheetId: string; date: string | null; beforeId?: string | null }
  | { type: 'clearSchedule' }
  /** Moves a whole shooting day (its scenes and shooting plan order) to another date. */
  | { type: 'moveDay'; from: string; to: string }
  | { type: 'updateShot'; id: string; patch: Partial<Shot> }
  | { type: 'deleteShot'; id: string }
  | { type: 'setPdr'; patch: Partial<PdrSettings> }
  /** ids null = back to the automatic order for that date. */
  | { type: 'setPdrOrder'; date: string; ids: string[] | null }
  /** items null = back to the automatic order for that date (also forgets a dragged order). */
  | { type: 'setPdrPlan'; date: string; items: PlanItem[] | null }
  /** A day without a shot list gets a shooting plan only once the user starts it. */
  | { type: 'startPdr'; date: string }
  | { type: 'toggleDayOff'; date: string }
  /** Cast details: actor, phone, dates they can't shoot. */
  | { type: 'updateElement'; elementId: string; patch: Pick<BreakdownElement, 'actor' | 'phone' | 'unavailable'> }
  | { type: 'setProduction'; patch: Partial<Omit<Production, 'crew' | 'locations'>> }
  | { type: 'setCrew'; crew: CrewMember[] }
  | { type: 'setLocation'; set: string; patch: Partial<LocationInfo> }
  | { type: 'setCallSheet'; date: string; patch: Partial<Omit<CallSheetDay, 'cast'>> }
  | { type: 'setCastTimes'; date: string; elementId: string; patch: Partial<CastTimes> };

const normalizeName = (categoryId: string, name: string) => {
  const n = name.trim().replace(/\s+/g, ' ');
  return categoryId === 'cast' ? n.toUpperCase() : n;
};

function findOrCreateElement(
  elements: BreakdownElement[],
  categoryId: string,
  name: string,
): [BreakdownElement[], BreakdownElement] {
  const key = name.toLowerCase();
  const existing = elements.find((e) => e.categoryId === categoryId && e.name.toLowerCase() === key);
  if (existing) return [elements, existing];
  const el: BreakdownElement = { id: uid(), categoryId, name };
  if (categoryId === 'cast') {
    el.castId = Math.max(0, ...elements.filter((e) => e.categoryId === 'cast').map((e) => e.castId ?? 0)) + 1;
  }
  return [[...elements, el], el];
}

function unschedule(schedule: Project['schedule'], sheetId: string): Project['schedule'] {
  const byDate: Record<string, string[]> = {};
  for (const [date, ids] of Object.entries(schedule.byDate)) {
    const kept = ids.filter((id) => id !== sheetId);
    if (kept.length) byDate[date] = kept;
  }
  return { byDate };
}

const mapSheet = (p: Project, id: string | undefined, fn: (s: Sheet) => Sheet): Project => ({
  ...p,
  sheets: p.sheets.map((s) => (id === undefined || s.id === id ? fn(s) : s)),
});

// ---------------------------------------------------------------- Undo / redo

export interface History {
  past: Project[];
  present: Project;
  future: Project[];
  /** The last change, so quick edits to the same field count as one step. */
  lastKey?: string;
  lastAt?: number;
}

export type HistoryAction = Action | { type: 'undo' } | { type: 'redo' };

const UNDO_LIMIT = 100;
/** Edits to the same field closer together than this are one undo step (typing a word, not each letter). */
const GROUP_MS = 1000;

/** Which edits merge into one step: the same kind of change to the same thing and the same fields. */
function groupKey(a: Action): string | undefined {
  const fields = (patch: object) => Object.keys(patch).sort().join(',');
  switch (a.type) {
    case 'setTitle':
      return 'title';
    case 'updateSheet':
    case 'updateShot':
      return `${a.type}:${a.id}:${fields(a.patch)}`;
    case 'setPdr':
    case 'setProduction':
      return `${a.type}:${fields(a.patch)}`;
    case 'updateElement':
      return `${a.type}:${a.elementId}:${fields(a.patch)}`;
    case 'setLocation':
      return `${a.type}:${a.set}:${fields(a.patch)}`;
    case 'setCallSheet':
      return `${a.type}:${a.date}:${fields(a.patch)}`;
    case 'setCastTimes':
      return `${a.type}:${a.date}:${a.elementId}:${fields(a.patch)}`;
    case 'renameElement':
      return `${a.type}:${a.elementId}`;
    default:
      return undefined;
  }
}

export const initHistory = (present: Project): History => ({ past: [], present, future: [] });

export function historyReducer(h: History, a: HistoryAction, now = Date.now()): History {
  if (a.type === 'undo') {
    if (!h.past.length) return h;
    return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
  }
  if (a.type === 'redo') {
    if (!h.future.length) return h;
    return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
  }
  const next = reducer(h.present, a);
  if (next === h.present) return h;
  const key = groupKey(a);
  if (key && key === h.lastKey && h.lastAt !== undefined && now - h.lastAt < GROUP_MS)
    return { ...h, present: next, future: [], lastAt: now };
  return { past: [...h.past, h.present].slice(-UNDO_LIMIT), present: next, future: [], lastKey: key, lastAt: now };
}

export function reducer(p: Project, a: Action): Project {
  switch (a.type) {
    case 'load':
      return a.project;
    case 'setTitle':
      return { ...p, title: a.title };
    case 'updateSheet':
      return mapSheet(p, a.id, (s) => ({ ...s, ...a.patch }));
    case 'addSheet': {
      const idx = a.afterId ? p.sheets.findIndex((s) => s.id === a.afterId) : p.sheets.length - 1;
      const sheets = [...p.sheets];
      const nextNumber = Math.max(0, ...p.sheets.map((s) => Number.parseInt(s.sheetNumber) || 0)) + 1;
      sheets.splice(idx + 1, 0, newSheet({ sheetNumber: String(nextNumber), ...a.patch }));
      return { ...p, sheets };
    }
    case 'deleteSheet':
      return {
        ...p,
        sheets: p.sheets.filter((s) => s.id !== a.id),
        schedule: unschedule(p.schedule, a.id),
        shots: p.shots.filter((s) => s.sheetId !== a.id),
      };
    case 'moveStrip': {
      if (a.beforeId === a.sheetId) return p;
      const schedule = unschedule(p.schedule, a.sheetId);
      if (a.date === null) return { ...p, schedule };
      const ids = [...(schedule.byDate[a.date] ?? [])];
      const at = a.beforeId ? ids.indexOf(a.beforeId) : -1;
      ids.splice(at < 0 ? ids.length : at, 0, a.sheetId);
      return { ...p, schedule: { byDate: { ...schedule.byDate, [a.date]: ids } } };
    }
    case 'moveDay': {
      if (a.from === a.to || !p.schedule.byDate[a.from]) return p;
      const byDate = { ...p.schedule.byDate };
      // Onto a day that already has scenes: this day's scenes follow them.
      byDate[a.to] = [...(byDate[a.to] ?? []), ...byDate[a.from]];
      delete byDate[a.from];
      const pdrOrder = { ...p.pdrOrder };
      if (pdrOrder[a.from]) pdrOrder[a.to] = [...(pdrOrder[a.to] ?? []), ...pdrOrder[a.from]];
      delete pdrOrder[a.from];
      const pdrPlan = { ...p.pdrPlan };
      if (pdrPlan[a.from]) pdrPlan[a.to] = [...(pdrPlan[a.to] ?? []), ...pdrPlan[a.from]];
      delete pdrPlan[a.from];
      const callSheets = { ...p.callSheets };
      if (callSheets[a.from] && !callSheets[a.to]) callSheets[a.to] = callSheets[a.from];
      delete callSheets[a.from];
      const started = p.pdrStarted.includes(a.from) ? [...p.pdrStarted.filter((d) => d !== a.from), a.to] : p.pdrStarted;
      return { ...p, schedule: { byDate }, pdrOrder, pdrPlan, callSheets, pdrStarted: started };
    }
    case 'clearSchedule':
      return { ...p, schedule: newSchedule() };
    case 'updateShot':
      return { ...p, shots: p.shots.map((s) => (s.id === a.id ? { ...s, ...a.patch } : s)) };
    case 'deleteShot':
      return { ...p, shots: p.shots.filter((s) => s.id !== a.id) };
    case 'setPdr':
      return { ...p, pdr: { ...p.pdr, ...a.patch } };
    case 'setPdrOrder': {
      const pdrOrder = { ...p.pdrOrder };
      if (a.ids) pdrOrder[a.date] = a.ids;
      else delete pdrOrder[a.date];
      return { ...p, pdrOrder };
    }
    case 'setPdrPlan': {
      const pdrPlan = { ...p.pdrPlan };
      const pdrOrder = { ...p.pdrOrder };
      if (a.items) pdrPlan[a.date] = a.items;
      else delete pdrPlan[a.date];
      delete pdrOrder[a.date];
      return { ...p, pdrPlan, pdrOrder };
    }
    case 'startPdr':
      return p.pdrStarted.includes(a.date) ? p : { ...p, pdrStarted: [...p.pdrStarted, a.date] };
    case 'toggleDayOff':
      return {
        ...p,
        daysOff: p.daysOff.includes(a.date) ? p.daysOff.filter((d) => d !== a.date) : [...p.daysOff, a.date].sort(),
      };
    case 'updateElement':
      return { ...p, elements: p.elements.map((e) => (e.id === a.elementId ? { ...e, ...a.patch } : e)) };
    case 'setProduction':
      return { ...p, production: { ...p.production, ...a.patch } };
    case 'setCrew':
      return { ...p, production: { ...p.production, crew: a.crew } };
    case 'setLocation': {
      const key = a.set.trim().toUpperCase();
      const current = p.production.locations[key] ?? { address: '', parking: '', hospital: '', notes: '' };
      return { ...p, production: { ...p.production, locations: { ...p.production.locations, [key]: { ...current, ...a.patch } } } };
    }
    case 'setCallSheet': {
      const day = p.callSheets[a.date] ?? newCallSheetDay();
      return { ...p, callSheets: { ...p.callSheets, [a.date]: { ...day, ...a.patch } } };
    }
    case 'setCastTimes': {
      const day = p.callSheets[a.date] ?? newCallSheetDay();
      const cast = { ...day.cast, [a.elementId]: { ...day.cast[a.elementId], ...a.patch } };
      return { ...p, callSheets: { ...p.callSheets, [a.date]: { ...day, cast } } };
    }
    case 'addTag': {
      const name = normalizeName(a.categoryId, a.name);
      if (!name) return p;
      const state = a.state ?? 'confirmed';
      const sheet = p.sheets.find((s) => s.id === a.sheetId);
      if (!sheet) return p;
      const [elements, el] = findOrCreateElement(p.elements, a.categoryId, name);
      if (state === 'suggested' && sheet.rejected.includes(el.id)) return p;
      const existing = sheet.tags.find((t) => t.elementId === el.id);
      // A suggestion never downgrades or duplicates a tag the user already has.
      if (existing && (existing.state === 'confirmed' || state === 'suggested')) return { ...p, elements };
      const tag: Tag = { elementId: el.id, state, source: a.source ?? 'user', quote: a.quote, by: a.by };
      return {
        ...mapSheet({ ...p, elements }, a.sheetId, (s) => ({
          ...s,
          tags: [...s.tags.filter((t) => t.elementId !== el.id), tag],
          rejected: state === 'confirmed' ? s.rejected.filter((r) => r !== el.id) : s.rejected,
        })),
      };
    }
    case 'addSuggestions':
      return a.items.reduce(
        (acc, it) => reducer(acc, { type: 'addTag', ...it, state: 'suggested', source: a.source }),
        p,
      );
    case 'removeTag':
      return mapSheet(p, a.sheetId, (s) => ({ ...s, tags: s.tags.filter((t) => t.elementId !== a.elementId) }));
    case 'acceptTag':
      return mapSheet(p, a.sheetId, (s) => ({
        ...s,
        tags: s.tags.map((t) => (t.elementId === a.elementId ? { ...t, state: 'confirmed' } : t)),
      }));
    case 'rejectTag':
      return mapSheet(p, a.sheetId, (s) => ({
        ...s,
        tags: s.tags.filter((t) => t.elementId !== a.elementId),
        rejected: [...new Set([...s.rejected, a.elementId])],
      }));
    case 'acceptAll':
      return mapSheet(p, a.sheetId, (s) => ({
        ...s,
        tags: s.tags.map((t) => (t.state === 'suggested' ? { ...t, state: 'confirmed' } : t)),
      }));
    case 'renameElement': {
      const el = p.elements.find((e) => e.id === a.elementId);
      if (!el) return p;
      const name = normalizeName(el.categoryId, a.name);
      if (!name || name === el.name) return p;
      const twin = p.elements.find(
        (e) => e.id !== el.id && e.categoryId === el.categoryId && e.name.toLowerCase() === name.toLowerCase(),
      );
      if (!twin) return { ...p, elements: p.elements.map((e) => (e.id === el.id ? { ...e, name } : e)) };
      // Renaming onto an existing element merges the two.
      return {
        ...p,
        elements: p.elements.filter((e) => e.id !== el.id),
        sheets: p.sheets.map((s) => {
          if (!s.tags.some((t) => t.elementId === el.id)) return s;
          const hasTwin = s.tags.some((t) => t.elementId === twin.id);
          return {
            ...s,
            tags: hasTwin
              ? s.tags.filter((t) => t.elementId !== el.id)
              : s.tags.map((t) => (t.elementId === el.id ? { ...t, elementId: twin.id } : t)),
          };
        }),
      };
    }
    case 'deleteElement':
      return {
        ...p,
        elements: p.elements.filter((e) => e.id !== a.elementId),
        sheets: p.sheets.map((s) => ({
          ...s,
          tags: s.tags.filter((t) => t.elementId !== a.elementId),
          rejected: s.rejected.filter((r) => r !== a.elementId),
        })),
      };
  }
}

const STORAGE_KEY = 'filmorganizer.project';

export function loadSaved(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? validateProject(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * Saves the project for next time. Returns false when storage is full or unavailable: the
 * previous save is left as it was, and the caller must tell the user to export the project.
 */
export function saveProject(p: Project): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    localStorage.setItem(SAVED_AT_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

const SAVED_AT_KEY = 'filmorganizer.savedAt';

/** When the project was last saved on this computer (ms since epoch), if known. */
export function savedAt(): number | null {
  try {
    const v = Number(localStorage.getItem(SAVED_AT_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Accepts a project file only if its outline is right, then rebuilds it field by field so a
 * damaged or hand-edited file can't break the app: missing fields get defaults and malformed
 * entries are dropped.
 */
export function validateProject(data: unknown): Project | null {
  const p = data as Project;
  if (!p || p.version !== 1 || !Array.isArray(p.sheets) || !Array.isArray(p.elements) || !Array.isArray(p.categories))
    return null;
  const categories = p.categories
    .filter((c) => isObj(c) && str(c.id) && str(c.name))
    .map((c) => ({ id: c.id, name: c.name, color: str(c.color) || '#8b8d98', group: c.group ?? 'other' }));
  const catIds = new Set(categories.map((c) => c.id));
  const elements = p.elements
    .filter((e) => isObj(e) && str(e.id) && str(e.name) && catIds.has(e.categoryId))
    .map((e) => ({
      ...e,
      castId: typeof e.castId === 'number' ? e.castId : undefined,
      actor: typeof e.actor === 'string' ? e.actor : undefined,
      phone: typeof e.phone === 'string' ? e.phone : undefined,
      unavailable: Array.isArray(e.unavailable) ? strList(e.unavailable).filter(isDate) : undefined,
    }));
  const elIds = new Set(elements.map((e) => e.id));
  const sheets = p.sheets.filter(isObj).map((raw) => {
    const s = raw as unknown as Partial<Sheet>;
    const base = newSheet();
    const fields = Object.fromEntries(
      (Object.keys(base) as (keyof Sheet)[])
        .filter((k) => typeof base[k] === 'string')
        .map((k) => [k, str(s[k])]),
    );
    return {
      ...base,
      ...fields,
      id: str(s.id) || base.id,
      pages: typeof s.pages === 'number' && s.pages >= 0 ? Math.round(s.pages) : 0,
      reviewed: s.reviewed === true,
      script: (Array.isArray(s.script) ? s.script : []).filter(isObj).map((x) => ({ t: str(x.t), x: str(x.x) })),
      tags: (Array.isArray(s.tags) ? s.tags : [])
        .filter((t) => isObj(t) && elIds.has(t.elementId))
        .map((t) => ({
          ...t,
          state: t.state === 'suggested' ? ('suggested' as const) : ('confirmed' as const),
          source: (['user', 'import', 'rules', 'ai'] as const).includes(t.source) ? t.source : ('user' as const),
        })),
      rejected: (Array.isArray(s.rejected) ? s.rejected : []).filter((id) => elIds.has(id)),
    };
  });
  const sheetIds = new Set(sheets.map((s) => s.id));
  // Projects saved before the schedule existed have none.
  const byDate: Record<string, string[]> = {};
  if (isObj(p.schedule) && isObj(p.schedule.byDate))
    for (const [date, ids] of Object.entries(p.schedule.byDate))
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Array.isArray(ids)) {
        const kept = ids.filter((id) => sheetIds.has(id));
        if (kept.length) byDate[date] = kept;
      }
  const shots = (Array.isArray(p.shots) ? p.shots : [])
    .filter((s) => isObj(s) && sheetIds.has(s.sheetId))
    .map(validShot);
  return {
    version: 1,
    title: str(p.title) || 'Untitled',
    categories,
    elements,
    sheets,
    schedule: { byDate },
    shots,
    pdr: validPdr(p.pdr),
    pdrOrder: isObj(p.pdrOrder)
      ? Object.fromEntries(
          Object.entries(p.pdrOrder)
            .filter(([date, ids]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Array.isArray(ids))
            .map(([date, ids]) => [date, strList(ids)]),
        )
      : {},
    pdrPlan: isObj(p.pdrPlan)
      ? Object.fromEntries(
          Object.entries(p.pdrPlan)
            .filter(([date, items]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Array.isArray(items))
            .map(([date, items]) => [date, (items as unknown[]).filter(isObj).map(validPlanItem).filter((x) => x !== null)]),
        )
      : {},
    pdrStarted: strList(p.pdrStarted).filter(isDate),
    daysOff: strList(p.daysOff).filter(isDate),
    production: validProduction(p.production),
    callSheets: isObj(p.callSheets)
      ? Object.fromEntries(
          Object.entries(p.callSheets)
            .filter(([date, d]) => isDate(date) && isObj(d))
            .map(([date, d]) => [date, validCallSheet(d as unknown as Record<string, unknown>)]),
        )
      : {},
  };
}

const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

function validProduction(raw: unknown): Production {
  const pr = newProduction();
  if (!isObj(raw)) return pr;
  for (const k of ['company', 'director', 'producer', 'productionManager', 'contactPhone'] as const) pr[k] = str(raw[k]);
  pr.crew = (Array.isArray(raw.crew) ? raw.crew : []).filter(isObj).map((c) => ({
    id: str(c.id) || uid(),
    department: str(c.department),
    role: str(c.role),
    name: str(c.name),
    phone: str(c.phone),
    call: str(c.call),
  }));
  if (isObj(raw.locations))
    for (const [set, l] of Object.entries(raw.locations))
      if (isObj(l)) pr.locations[set] = { address: str(l.address), parking: str(l.parking), hospital: str(l.hospital), notes: str(l.notes) };
  return pr;
}

function validCallSheet(raw: Record<string, unknown>): CallSheetDay {
  const day = newCallSheetDay();
  for (const k of ['weather', 'sunrise', 'sunset', 'notes'] as const) day[k] = str(raw[k]);
  if (isObj(raw.cast))
    for (const [id, t] of Object.entries(raw.cast))
      if (isObj(t)) day.cast[id] = Object.fromEntries((['pickup', 'call', 'makeup', 'onSet'] as const).filter((k) => str(t[k])).map((k) => [k, str(t[k])]));
  return day;
}

const SHOT_TYPE_KEYS: ShotType[] = ['oner', 'ws', 'mws', 'fs', 'group', 'ms', 'mcu', 'cu', 'ecu', 'insert'];
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function validShot(s: Shot): Shot {
  return {
    id: str(s.id) || uid(),
    sheetId: s.sheetId,
    number: str(s.number),
    description: str(s.description),
    talent: strList(s.talent),
    type: SHOT_TYPE_KEYS.includes(s.type as ShotType) ? s.type : '',
    movement: str(s.movement),
    minutes: typeof s.minutes === 'number' && s.minutes > 0 ? Math.round(s.minutes) : null,
    keyShot: s.keyShot === true,
    alerts: strList(s.alerts),
    notes: str(s.notes),
    category: (['principal', 'insert', 'field'] as ShotCategory[]).includes(s.category) ? s.category : 'principal',
    location: str(s.location),
    setup: str(s.setup),
    gapMinutes: typeof s.gapMinutes === 'number' && s.gapMinutes >= 0 ? Math.round(s.gapMinutes) : null,
  };
}

const PLAN_KINDS: PlanItemKind[] = ['shot', 'reset', 'move', 'lunch', 'break'];
const clockMinutes = (v: unknown) => (typeof v === 'number' && v >= 0 && v < 48 * 60 ? Math.round(v) : undefined);

function validPlanItem(raw: Record<string, unknown>): PlanItem | null {
  if (!str(raw.id) || !PLAN_KINDS.includes(raw.kind as PlanItemKind)) return null;
  const item: PlanItem = { id: raw.id as string, kind: raw.kind as PlanItemKind };
  const minutes = clockMinutes(raw.minutes);
  const at = clockMinutes(raw.at);
  if (minutes !== undefined) item.minutes = minutes;
  if (at !== undefined) item.at = at;
  if (str(raw.label)) item.label = raw.label as string;
  return item;
}

function validPdr(raw: unknown): PdrSettings {
  const pdr = { ...DEFAULT_PDR };
  if (!isObj(raw)) return pdr;
  for (const k of Object.keys(pdr) as (keyof PdrSettings)[]) {
    const v = raw[k];
    if (typeof pdr[k] === 'number' && typeof v === 'number' && v >= 0) (pdr[k] as number) = Math.round(v);
  }
  for (const k of ['callTime', 'lunchAt'] as const)
    if (typeof raw[k] === 'string' && /^\d{1,2}:\d{2}$/.test(raw[k] as string)) pdr[k] = raw[k] as string;
  if (raw.sheetLanguage === 'es') pdr.sheetLanguage = 'es';
  return pdr;
}
