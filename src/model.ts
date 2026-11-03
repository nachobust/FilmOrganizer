// Data model for a film breakdown: breakdown sheets (one per scene row), categories,
// and elements tagged onto sheets, plus the shooting schedule.

export type CategoryGroup = 'cast' | 'people' | 'art' | 'camera' | 'other';

export interface Category {
  id: string;
  name: string;
  color: string;
  group: CategoryGroup;
}

export interface BreakdownElement {
  id: string;
  categoryId: string;
  name: string;
  /** Cast ID number shown on strips (cast category only). */
  castId?: number;
}

export type TagState = 'confirmed' | 'suggested';
export type TagSource = 'user' | 'import' | 'rules' | 'ai';

export interface Tag {
  elementId: string;
  state: TagState;
  source: TagSource;
  /** Script text that justifies the tag. */
  quote?: string;
  /** What produced a suggestion: the rule that matched, or the AI provider and model. */
  by?: string;
}

export interface ScriptParagraph {
  /** Paragraph type: Action, Character, Dialogue, Parenthetical, Transition. */
  t: string;
  x: string;
}

export interface Sheet {
  id: string;
  sheetNumber: string;
  scenes: string;
  intExt: string;
  set: string;
  dayNight: string;
  /** Page count in eighths of a page (1 4/8 = 12). */
  pages: number;
  scriptPage: string;
  scriptDay: string;
  synopsis: string;
  location: string;
  timing: string;
  sequence: string;
  episode: string;
  misc1: string;
  misc2: string;
  misc3: string;
  misc4: string;
  heading: string;
  script: ScriptParagraph[];
  tags: Tag[];
  /** Element ids the user rejected; never re-suggested for this sheet. */
  rejected: string[];
  reviewed: boolean;
}

export interface Schedule {
  /** Strip order per calendar date ("YYYY-MM-DD"). Sheets on no date are unscheduled. */
  byDate: Record<string, string[]>;
}

/** Framing, widest to tightest. Spanish shot lists (PG, PM, PP…) are read into these too. */
export type ShotType = 'oner' | 'ws' | 'mws' | 'fs' | 'group' | 'ms' | 'mcu' | 'cu' | 'ecu' | 'insert';

export const SHOT_TYPES: { key: ShotType; label: string; name: string; /** Spanish PDR label. */ es: string }[] = [
  { key: 'oner', label: 'Oner', name: 'Oner (one continuous take)', es: 'Plano secuencia' },
  { key: 'ws', label: 'WS', name: 'Wide shot', es: 'PG' },
  { key: 'mws', label: 'MWS', name: 'Medium wide shot', es: 'PG corto' },
  { key: 'fs', label: 'FS', name: 'Full / cowboy shot', es: 'PA' },
  { key: 'group', label: 'Group MS', name: 'Group medium shot', es: 'PM conjunto' },
  { key: 'ms', label: 'MS', name: 'Medium shot', es: 'PM' },
  { key: 'mcu', label: 'MCU', name: 'Medium close-up', es: 'PM corto' },
  { key: 'cu', label: 'CU', name: 'Close-up', es: 'PP' },
  { key: 'ecu', label: 'ECU', name: 'Extreme close-up', es: 'PPP' },
  { key: 'insert', label: 'Insert', name: 'Insert / detail', es: 'PD' },
];

/**
 * Where a shot goes in the day: principal coverage first, quick inserts before lunch,
 * field / product shots after lunch.
 */
export type ShotCategory = 'principal' | 'insert' | 'field';

export const SHOT_CATEGORIES: { key: ShotCategory; label: string }[] = [
  { key: 'principal', label: 'Principal' },
  { key: 'insert', label: 'Insert' },
  { key: 'field', label: 'Field / product' },
];

/** One camera setup or angle from a shot list, belonging to a scene. */
export interface Shot {
  id: string;
  sheetId: string;
  /** "[scene].[letter]", e.g. "01.A". */
  number: string;
  description: string;
  talent: string[];
  type: ShotType | '';
  movement: string;
  /** Estimated shooting minutes (setup + takes); the PDR default is used when empty. */
  minutes: number | null;
  keyShot: boolean;
  /** "!!" alerts, shown in red in the PDR notes column. */
  alerts: string[];
  notes: string;
  category: ShotCategory;
  /** A change of location is a company move; a change of setup inside it is a reset. */
  location: string;
  setup: string;
  /** Minutes of the reset or company move before this shot, when the user changed it. */
  gapMinutes?: number | null;
}

/** Day timings used to build the shooting plan (durations in minutes, clock times as "HH:MM"). */
export interface PdrSettings {
  callTime: string;
  prepMinutes: number;
  lunchAt: string;
  lunchMinutes: number;
  resetMinutes: number;
  moveMinutes: number;
  wrapMinutes: number;
  shotMinutes: number;
  /** Language of the labels written into the exported sheet; the app itself stays in English. */
  sheetLanguage: 'en' | 'es';
}

export const DEFAULT_PDR: PdrSettings = {
  callTime: '08:00',
  prepMinutes: 120,
  lunchAt: '14:00',
  lunchMinutes: 60,
  resetMinutes: 20,
  moveMinutes: 45,
  wrapMinutes: 30,
  shotMinutes: 10,
  sheetLanguage: 'en',
};

export interface Project {
  version: 1;
  title: string;
  categories: Category[];
  elements: BreakdownElement[];
  sheets: Sheet[];
  schedule: Schedule;
  /** Shot lists, linked to scenes. Projects saved before shot lists existed have none. */
  shots: Shot[];
  pdr: PdrSettings;
  /**
   * Shooting plan rows the user dragged into their own order, per date ("YYYY-MM-DD"): shot ids
   * (or "scene-<sheet id>" for a scene without a shot list). Days not listed use the automatic order.
   */
  pdrOrder: Record<string, string[]>;
  /**
   * A day's shooting plan as the user laid it out, per date: every row in order, shots and the
   * resets, company moves, lunch and breaks between them. Takes over from `pdrOrder` and from the
   * automatic order as soon as the user moves, adds, deletes or times a row by hand.
   */
  pdrPlan: Record<string, PlanItem[]>;
}

export type PlanItemKind = 'shot' | 'reset' | 'move' | 'lunch' | 'break';

export interface PlanItem {
  /** A shot's id (or "scene-<sheet id>"); for the other rows, an id of their own. */
  id: string;
  kind: PlanItemKind;
  /** Length in minutes. For a shot it overrides the shot's own minutes only for a scene without a shot list. */
  minutes?: number;
  /** Fixed start ("starts at 14:00"), minutes since midnight; otherwise it starts when the row before ends. */
  at?: number;
  /** The row's own text, replacing "Reset: camera and lights", "LUNCH" and so on. */
  label?: string;
}

export const GROUP_LABELS: Record<CategoryGroup, string> = {
  cast: 'Cast',
  people: 'People & Animals',
  art: 'Art & Wardrobe',
  camera: 'Camera & Effects',
  other: 'Other',
};

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cast', name: 'Cast Members', color: '#e5484d', group: 'cast' },
  { id: 'background', name: 'Background Actors', color: '#30a46c', group: 'people' },
  { id: 'stunts', name: 'Stunts', color: '#f76b15', group: 'people' },
  { id: 'animals', name: 'Animals', color: '#a18072', group: 'people' },
  { id: 'wrangler', name: 'Animal Wrangler', color: '#8d6e63', group: 'people' },
  { id: 'security', name: 'Security', color: '#5b5bd6', group: 'people' },
  { id: 'labor', name: 'Additional Labor', color: '#7c66dc', group: 'people' },
  { id: 'props', name: 'Props', color: '#8e4ec6', group: 'art' },
  { id: 'setdressing', name: 'Set Dressing', color: '#ad7f58', group: 'art' },
  { id: 'artdept', name: 'Art Department', color: '#c2a14b', group: 'art' },
  { id: 'greenery', name: 'Greenery', color: '#46a758', group: 'art' },
  { id: 'wardrobe', name: 'Wardrobe', color: '#0090ff', group: 'art' },
  { id: 'makeup', name: 'Makeup/Hair', color: '#d6409f', group: 'art' },
  { id: 'vehicles', name: 'Vehicles', color: '#e93d82', group: 'art' },
  { id: 'camera', name: 'Camera', color: '#00a2c7', group: 'camera' },
  { id: 'specialequip', name: 'Special Equipment', color: '#12a594', group: 'camera' },
  { id: 'sfx', name: 'Special Effects', color: '#3e63dd', group: 'camera' },
  { id: 'mechfx', name: 'Mechanical Effects', color: '#6e56cf', group: 'camera' },
  { id: 'vfx', name: 'Visual Effects', color: '#0d74ce', group: 'camera' },
  { id: 'sound', name: 'Sound', color: '#978365', group: 'camera' },
  { id: 'music', name: 'Music', color: '#ab4aba', group: 'camera' },
  { id: 'misc', name: 'Miscellaneous', color: '#8b8d98', group: 'other' },
  { id: 'notes', name: 'Notes', color: '#60646c', group: 'other' },
];

export const uid = () => crypto.randomUUID();

export function newSchedule(): Schedule {
  return { byDate: {} };
}

// ---------- Calendar dates (local time, "YYYY-MM-DD" keys) ----------

export const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const fromISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Monday of the week containing d. */
export const weekStart = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

/** Shooting day numbers ("Day 1", "Day 2"…) for every date that has strips, in date order. */
export function shootDayNumbers(schedule: Schedule): Map<string, number> {
  const dates = Object.keys(schedule.byDate)
    .filter((d) => schedule.byDate[d].length)
    .sort();
  return new Map(dates.map((d, i) => [d, i + 1]));
}

export function newProject(title: string): Project {
  return {
    version: 1,
    title,
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    elements: [],
    sheets: [],
    schedule: newSchedule(),
    shots: [],
    pdr: { ...DEFAULT_PDR },
    pdrOrder: {},
    pdrPlan: {},
  };
}

export function newSheet(patch: Partial<Sheet> = {}): Sheet {
  return {
    id: uid(),
    sheetNumber: '',
    scenes: '',
    intExt: '',
    set: '',
    dayNight: '',
    pages: 0,
    scriptPage: '',
    scriptDay: '',
    synopsis: '',
    location: '',
    timing: '',
    sequence: '',
    episode: '',
    misc1: '',
    misc2: '',
    misc3: '',
    misc4: '',
    heading: '',
    script: [],
    tags: [],
    rejected: [],
    reviewed: false,
    ...patch,
  };
}

export function formatEighths(eighths: number): string {
  if (!eighths) return '';
  const whole = Math.floor(eighths / 8);
  const rest = eighths % 8;
  if (whole && rest) return `${whole} ${rest}/8`;
  return whole ? `${whole}` : `${rest}/8`;
}

/** Parses "1 4/8", "4/8" or "2" into eighths; null when invalid. */
export function parseEighths(input: string): number | null {
  const s = input.trim();
  if (!s) return 0;
  const m = s.match(/^(\d+)?\s*(?:([0-7])\/8)?$/);
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) * 8 + Number(m[2] ?? 0);
}

export function elementLabel(el: BreakdownElement): string {
  return el.castId ? `${el.castId}. ${el.name}` : el.name;
}

export interface StripKind {
  key: string;
  label: string;
  bg: string;
  ink: string;
}

/** Strip colours: Int/Ext × Day/Afternoon/Night. */
export const STRIP_KINDS: StripKind[] = [
  { key: 'ext-day', label: 'Ext Day', bg: '#fff3ad', ink: '#221d0f' },
  { key: 'int-day', label: 'Int Day', bg: '#bfe3ff', ink: '#0f1d24' },
  { key: 'ext-afternoon', label: 'Ext Afternoon', bg: '#ffab5c', ink: '#241505' },
  { key: 'int-afternoon', label: 'Int Afternoon', bg: '#d9b48f', ink: '#241a0d' },
  { key: 'ext-night', label: 'Ext Night', bg: '#5b7fd6', ink: '#f4f6ff' },
  { key: 'int-night', label: 'Int Night', bg: '#b393e6', ink: '#221730' },
];

const UNSET_STRIP: StripKind = { key: 'unset', label: 'Not set', bg: '#f4f4f5', ink: '#18181b' };

/** INT/EXT counts as Int; Spanish "TARDE"/"NOCHE" are recognised too. */
export function stripKind(sheet: Pick<Sheet, 'intExt' | 'dayNight'>): StripKind {
  if (!sheet.intExt && !sheet.dayNight) return UNSET_STRIP;
  const io = sheet.intExt.startsWith('EXT') ? 'ext' : 'int';
  const dn = sheet.dayNight.toUpperCase();
  const time = /NIGHT|NOCHE/.test(dn)
    ? 'night'
    : /AFTERNOON|TARDE|EVENING|DUSK|SUNSET|ATARDECER/.test(dn)
      ? 'afternoon'
      : 'day';
  return STRIP_KINDS.find((k) => k.key === `${io}-${time}`)!;
}
