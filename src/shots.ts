// Shot lists: reading a shot list file (Excel, Word table or plain-text table) into shots,
// and turning those shots into scenes, either as a new project or for one shooting day.

import {
  addDays,
  fromISO,
  newProject,
  newSheet,
  toISO,
  uid,
  type Project,
  type Sheet,
  type Shot,
  type ShotCategory,
  type ShotType,
} from './model';
import { runRules } from './rules';
import { reducer } from './store';

/** A shot as read from the file, before it belongs to a scene. */
export interface ParsedShot extends Omit<Shot, 'id' | 'sheetId'> {
  /** Scene number from a Scene column or the shot number ("01.A" → "01"); '' when unknown. */
  scene: string;
  intExt: string;
  dayNight: string;
  /** Shooting day from a Day column (1 = first day); null when the list has none. */
  day: number | null;
}

// ---------------------------------------------------------------- Shot types

/** English and Spanish names for each framing, matched as whole words at the start of the cell. */
const TYPE_ALIASES: [ShotType, string[]][] = [
  ['oner', ['plano secuencia', 'secuencia', 'oner', 'one shot', 'one-shot', 'oneshot', 'long take']],
  ['mws', ['pg corto', 'plano general corto', 'mws', 'mls', 'medium wide', 'medium long']],
  ['ws', ['pg', 'plano general', 'general', 'ws', 'wide', 'ls', 'long shot', 'ews', 'els', 'xws', 'master', 'establishing']],
  ['fs', ['pa', 'plano americano', 'americano', 'fs', 'full shot', 'full', 'cowboy', 'mfs']],
  ['group', ['pm conjunto', 'plano medio conjunto', 'group', 'two shot', 'two-shot', '2-shot', '2s']],
  ['mcu', ['pm corto', 'plano medio corto', 'mcu', 'medium close-up', 'medium close up']],
  ['ms', ['pm', 'plano medio', 'ms', 'medium', 'mid', 'ots', 'over the shoulder']],
  ['ecu', ['ppp', 'primerísimo primer plano', 'primerisimo primer plano', 'ecu', 'xcu', 'bcu', 'extreme close-up', 'extreme close up']],
  ['cu', ['pp', 'primer plano', 'cu', 'close-up', 'close up', 'closeup']],
  ['insert', ['pd', 'plano detalle', 'detalle', 'insert', 'detail', 'ins', 'macro', 'packshot']],
];
const TYPE_LOOKUP = TYPE_ALIASES.flatMap(([key, names]) => names.map((n) => [n, key] as const)).sort(
  (a, b) => b[0].length - a[0].length,
);

export function matchShotType(raw: string): ShotType | '' {
  const v = raw.replace(/⭐/g, '').trim().toLowerCase();
  if (!v) return '';
  for (const [name, key] of TYPE_LOOKUP) if (v === name || new RegExp(`^${name}(?![\\p{L}\\d])`, 'u').test(v)) return key;
  return '';
}

// ---------------------------------------------------------------- Columns

type Column =
  | 'number'
  | 'scene'
  | 'location'
  | 'setup'
  | 'type'
  | 'talent'
  | 'description'
  | 'movement'
  | 'minutes'
  | 'key'
  | 'day'
  | 'category'
  | 'notes'
  | 'intExt'
  | 'dayNight';

// Exact names, compared without accents, case, units in brackets or trailing punctuation.
const HEADER_ALIASES: Record<Column, string[]> = {
  number: ['#', 'no', 'n', 'n.', 'nº', 'n°', 'no.', 'num', 'numero', 'plano n', 'plano nº', 'n plano', 'nº plano', 'num plano', 'numero de plano', 'shot', 'shot #', 'shot#', 'shot no', 'shot number', 'id'],
  scene: ['scene', 'scene #', 'scene no', 'sc', 'escena', 'esc', 'sec', 'secuencia', 'escena / loc', 'scene/location', 'n escena', 'nº escena'],
  location: ['location', 'set', 'loc', 'localizacion', 'locacion', 'lugar', 'decorado', 'espacio'],
  setup: ['setup', 'set up', 'setup id'],
  type: ['shot type', 'type', 'size', 'shot size', 'framing', 'tipo de plano', 'tipo', 'plano', 'encuadre', 'tamano', 'tamano de plano', 'valor de plano', 'angulo'],
  talent: ['talent', 'talento', 'cast', 'characters', 'character', 'subject', 'personajes', 'personaje', 'personajes / talent', 'reparto', 'quien', 'sujeto', 'actor', 'actores', 'actriz', 'protagonista', 'protagonistas', 'casting'],
  description: ['description', 'action', 'subject / action', 'subject/action', 'what', 'descripcion', 'descripcion del plano', 'accion', 'concepto', 'que pasa', 'contenido'],
  movement: ['movement', 'camera movement', 'move', 'camera', 'movimiento', 'movimiento de camara', 'mov', 'camara'],
  minutes: ['duration', 'min', 'mins', 'minutes', 'est. time', 'time', 'duracion', 'minutos', 'tiempo', 'tiempo de rodaje', 'tiempo estimado', 'duracion estimada'],
  key: ['key', 'key shot', 'clave', 'plano clave', '⭐'],
  day: ['day', 'shoot day', 'dia', 'jornada', 'dia de rodaje'],
  category: ['category', 'cat', 'cat.', 'categoria'],
  notes: ['notes', 'note', 'comments', 'reference', 'ref', 'notas', 'notas / referencias', 'observaciones', 'obs', 'referencia', 'referencias', 'comentarios', 'comentario'],
  intExt: ['int/ext', 'i/e', 'int-ext', 'int / ext'],
  dayNight: ['d/n', 'day/night', 'dia/noche', 'd / n'],
};

// When no exact name matches: a word the header contains (checked in this order).
const HEADER_KEYWORDS: [RegExp, Column][] = [
  [/\b(int\.?\s*\/\s*ext|i\/e)\b/, 'intExt'],
  [/\b(d\/n|dia\s*\/\s*noche|day\s*\/\s*night)\b/, 'dayNight'],
  [/descrip|accion|action/, 'description'],
  [/tipo de plano|encuadre|shot (type|size)|tamano/, 'type'],
  [/personaj|talent|actor|actriz|reparto|\bcast\b|protagonist/, 'talent'],
  [/locali|locacion|location|decorado/, 'location'],
  [/movim|movement/, 'movement'],
  [/duracion|duration|minut|tiempo/, 'minutes'],
  [/nota|observ|comentari|referenc|notes?\b|comments?/, 'notes'],
  [/escena|scene/, 'scene'],
  [/categor/, 'category'],
];

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:.\s]+$/, '');

/** On-screen length in seconds, not shooting time: never read as minutes. */
const isSeconds = (header: string) => /\b(seg|segundos|secs?|seconds|s)\b|\(s\)|''/.test(header.toLowerCase());

function columnOf(header: string): Column | null {
  const h = normalize(header);
  if (!h) return null;
  for (const [col, names] of Object.entries(HEADER_ALIASES) as [Column, string[]][])
    if (h === col.toLowerCase() || names.includes(h)) return col === 'minutes' && isSeconds(header) ? null : col;
  for (const [re, col] of HEADER_KEYWORDS)
    if (re.test(h)) return col === 'minutes' && isSeconds(header) ? null : col;
  return null;
}

/**
 * "Plano" is the shot size in some lists and the shot number in others: when that column holds
 * mostly numbers and there is no other number column, it is the number.
 */
function fixPlanoColumn(header: (Column | null)[], body: string[][]): (Column | null)[] {
  const t = header.indexOf('type');
  if (t < 0 || header.includes('number')) return header;
  const values = body.map((r) => (r[t] ?? '').trim()).filter(Boolean);
  const numeric = values.filter((v) => /^\d+[A-Z]?$|^\d+[.\-]\w+$/i.test(v)).length;
  if (!values.length || numeric < values.length * 0.6) return header;
  return header.map((c, i) => (i === t ? 'number' : c));
}

const TRUTHY = new Set(['x', 'yes', 'y', 'true', '1', 'si', 'sí', '⭐', 'key', '*']);
const sceneKey = (s: string) => s.trim().toUpperCase().replace(/^0+(?=\w)/, '');

/** "1 - Porch" → scene "1", set "Porch"; "Porch" → no scene number. */
function splitScene(raw: string): { scene: string; rest: string } {
  const m = raw.trim().match(/^(\d+[A-Z]?)\b\s*[-–—.:/]?\s*(.*)$/i);
  return m ? { scene: m[1], rest: m[2].trim() } : { scene: '', rest: raw.trim() };
}

function category(raw: string): ShotCategory | null {
  const v = raw.trim().toLowerCase();
  if (/^(insert|inserto|recurso|b-?roll)/.test(v)) return 'insert';
  if (/^(field|campo|product|producto|ensoñación|ensonacion)/.test(v)) return 'field';
  if (/^(principal|main)/.test(v)) return 'principal';
  return null;
}

/** Finds the header row (title rows above it are skipped) and reads every row below it as a shot. */
export function parseShotRows(rows: string[][]): ParsedShot[] {
  let headerAt = -1;
  let header: (Column | null)[] = [];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const mapped = rows[i].map(columnOf);
    const hits = mapped.filter(Boolean);
    if (hits.length >= 2 && (hits.includes('number') || hits.includes('type') || hits.includes('description'))) {
      headerAt = i;
      header = mapped;
      break;
    }
  }
  if (headerAt < 0) return [];
  header = fixPlanoColumn(header, rows.slice(headerAt + 1));

  const shots: ParsedShot[] = [];
  let lastScene = '';
  for (const row of rows.slice(headerAt + 1)) {
    const cell = (col: Column) => {
      const i = header.indexOf(col);
      return i < 0 ? '' : (row[i] ?? '').trim();
    };
    const number = cell('number');
    let description = cell('description');
    if (!number && !description) {
      // A row with only a scene or location in it is a section heading ("SCENE 2 — Kitchen").
      const heading = row.find((c) => c.trim())?.trim() ?? '';
      const m = heading.match(/^(?:scene|escena|sc\.?)\s*(\d+[A-Z]?)/i);
      if (m) lastScene = m[1];
      continue;
    }
    // Template rows that are numbered but still empty ("11", "12"… with nothing else) are not shots.
    const filled = (['description', 'type', 'talent', 'location', 'notes', 'movement', 'minutes'] as Column[]).some((c) => cell(c));
    if (!filled) continue;
    let notes = cell('notes');
    // "!!" marks an operational alert: it moves out of the text into the alerts.
    const alerts: string[] = [];
    const pullAlerts = (s: string) =>
      s
        .replace(/!!\s*[^\n]*/g, (a) => {
          alerts.push(a.trim());
          return '';
        })
        .trim();
    description = pullAlerts(description);
    notes = pullAlerts(notes);

    const sceneCell = splitScene(cell('scene'));
    // "01.A" and "12B" carry the scene number; a plain "7" is just the shot's place in the list.
    const scene = sceneCell.scene || number.match(/^(\d+)(?:[.\-_/\s]\w+|[A-Z])$/i)?.[1] || lastScene;
    const location = cell('location') || sceneCell.rest;
    const type = matchShotType(cell('type'));
    const talent = cell('talent')
      .split(/\s*(?:[,/·+&;\n]|\by\b|\band\b)\s*/i)
      .map((t) => t.trim())
      .filter((t) => t && !/^[-–—]$/.test(t));
    const keyCell = cell('key').toLowerCase();
    const minutes = Number(cell('minutes').match(/\d+/)?.[0]);
    const intExt = (cell('intExt') || location.match(/^(INT\.?\/EXT|EXT\.?\/INT|INT|EXT)\b/i)?.[1] || '').toUpperCase();

    shots.push({
      scene,
      number,
      description: description.replace(/\s*⭐\s*/g, ' ').trim(),
      talent,
      type,
      movement: cell('movement'),
      minutes: minutes > 0 ? minutes : null,
      keyShot: TRUTHY.has(keyCell) || keyCell.includes('⭐') || row.some((c) => c.includes('⭐')),
      alerts,
      notes,
      category: category(cell('category')) ?? (type === 'insert' && !talent.length ? 'insert' : 'principal'),
      location: location.replace(/^(INT\.?\/EXT|EXT\.?\/INT|INT|EXT)\.?\s*/i, ''),
      setup: cell('setup'),
      intExt: intExt.replace(/\./g, ''),
      dayNight: cell('dayNight').toUpperCase(),
      day: Number(cell('day').match(/\d+/)?.[0]) || null,
    });
  }
  return shots;
}

// ---------------------------------------------------------------- Files

/** Splits plain text into rows when it is a pipe table or tab/semicolon separated. */
export function rowsFromText(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.slice(0, 5).filter((l) => (l.match(/\|/g) ?? []).length >= 2).length >= 2)
    return lines
      .filter((l) => !/^[\s|:\-]+$/.test(l))
      .map((l) =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim()),
      );
  for (const sep of ['\t', ';'])
    if (lines.slice(0, 12).filter((l) => l.includes(sep)).length >= Math.min(2, lines.length))
      return lines.map((l) => l.split(sep).map((c) => c.trim()));
  return [];
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(11, 16);
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; text?: string; result?: unknown };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if (o.text !== undefined) return String(o.text);
    if (o.result !== undefined) return cellText(o.result);
    return '';
  }
  return String(v);
}

async function rowsFromXlsx(data: ArrayBuffer): Promise<string[][]> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  let best: string[][] = [];
  let bestScore = -1;
  for (const ws of wb.worksheets) {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (c, col) => {
        // Merged cells repeat the master's value; keep it only once.
        cells[col - 1] = c.isMerged && c.master !== c ? '' : cellText(c.value).trim();
      });
      rows.push(Array.from(cells, (c) => c ?? ''));
    });
    const score = rows
      .slice(0, 15)
      .flat()
      .filter((c) => columnOf(c)).length;
    if (score > bestScore) [best, bestScore] = [rows, score];
  }
  return best;
}

/** The largest table in a Word file, one string per cell. */
async function rowsFromDocx(data: ArrayBuffer): Promise<string[][]> {
  const { default: JSZip } = await import('jszip');
  const xml = await (await JSZip.loadAsync(data)).file('word/document.xml')?.async('string');
  if (!xml) throw new Error('This Word file has no document in it.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);
  let best: string[][] = [];
  for (const tbl of Array.from(doc.getElementsByTagNameNS(W, 'tbl'))) {
    const rows = kids(tbl, 'tr').map((tr) =>
      kids(tr, 'tc').map((tc) =>
        kids(tc, 'p')
          .map((p) => Array.from(p.getElementsByTagNameNS(W, 't'), (t) => t.textContent ?? '').join(''))
          .join('\n')
          .trim(),
      ),
    );
    if (rows.length > best.length) best = rows;
  }
  if (best.length) return best;
  const text = Array.from(doc.getElementsByTagNameNS(W, 'p'), (p) =>
    Array.from(p.getElementsByTagNameNS(W, 't'), (t) => t.textContent ?? '').join(''),
  ).join('\n');
  return rowsFromText(text);
}

export const SHOT_LIST_ACCEPT = '.xlsx,.xlsm,.docx,.txt,.md,.tsv';

/** Reads a shot list file into shots; throws a readable error when nothing looks like a shot list. */
export async function readShotListFile(file: File): Promise<ParsedShot[]> {
  const name = file.name;
  let rows: string[][];
  if (/\.xls[xm]$/i.test(name)) rows = await rowsFromXlsx(await file.arrayBuffer());
  else if (/\.docx$/i.test(name)) rows = await rowsFromDocx(await file.arrayBuffer());
  else if (/\.pdf$/i.test(name))
    throw new Error('PDF shot lists lose their columns. Export the shot list as Excel (.xlsx) or Word (.docx) and import that.');
  else if (/\.xls$/i.test(name)) throw new Error('Old Excel .xls files are not supported. Open it in Excel and save as .xlsx.');
  else rows = rowsFromText(await file.text());
  const shots = parseShotRows(rows);
  if (!shots.length)
    throw new Error(
      `No shot list found in “${name}”. It needs a table with a header row naming at least two columns, such as Shot #, Shot type, Description, Talent or Location (English or Spanish).`,
    );
  return shots;
}

// ---------------------------------------------------------------- Scenes from shots

const toShot = (p: ParsedShot, sheetId: string): Shot => ({
  id: uid(),
  sheetId,
  number: p.number,
  description: p.description,
  talent: p.talent,
  type: p.type,
  movement: p.movement,
  minutes: p.minutes,
  keyShot: p.keyShot,
  alerts: p.alerts,
  notes: p.notes,
  category: p.category,
  location: p.location,
  setup: p.setup,
});

/** Shots in groups, one per scene number (or per location when the list has no scene numbers). */
function groupByScene(shots: ParsedShot[]): ParsedShot[][] {
  const groups = new Map<string, ParsedShot[]>();
  for (const s of shots) {
    const key = s.scene ? `#${sceneKey(s.scene)}` : `@${s.location.toUpperCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.values()];
}

const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

function sheetFromShots(shots: ParsedShot[], sheetNumber: string, fallbackScene: string): Sheet {
  const first = shots[0];
  const location = shots.find((s) => s.location)?.location ?? '';
  const minutes = shots.reduce((n, s) => n + (s.minutes ?? 0), 0);
  const lead = shots.find((s) => s.keyShot && s.description) ?? shots.find((s) => s.description);
  return newSheet({
    sheetNumber,
    scenes: first.scene || fallbackScene,
    set: location.toUpperCase(),
    intExt: shots.find((s) => s.intExt)?.intExt ?? '',
    dayNight: shots.find((s) => s.dayNight)?.dayNight ?? '',
    synopsis: lead ? lead.description.slice(0, 160) : '',
    timing: minutes ? fmtMinutes(minutes) : '',
    // The shots stand in for script text, so the offline rules can read them for props and the rest.
    script: shots.map((s) => ({ t: 'Action', x: [s.number, s.description, s.notes].filter(Boolean).join(' — ') })),
  });
}

/** Talent on any of the scene's shots becomes confirmed cast: the shot list says who is in it. */
function tagTalent(p: Project, sheetId: string, shots: ParsedShot[]): Project {
  for (const name of new Set(shots.flatMap((s) => s.talent)))
    p = reducer(p, { type: 'addTag', sheetId, categoryId: 'cast', name, source: 'import', quote: 'In the shot list' });
  return p;
}

/**
 * A new project from a shot list: one scene per scene number, each with its shots. A shot list is
 * a shoot, so its scenes go straight onto shooting days: day 1 is `firstDate`, and a Day column
 * ("Día 2") puts a scene that many days later.
 */
export function projectFromShotList(title: string, shots: ParsedShot[], firstDate: string): Project {
  let p = newProject(title);
  const groups = groupByScene(shots);
  p.sheets = groups.map((g, i) => sheetFromShots(g, String(i + 1), String(i + 1)));
  p.shots = groups.flatMap((g, i) => g.map((s) => toShot(s, p.sheets[i].id)));
  groups.forEach((g, i) => (p = tagTalent(p, p.sheets[i].id, g)));
  const start = fromISO(firstDate);
  groups.forEach((g, i) => {
    const day = Math.min(...g.map((s) => s.day ?? 1));
    p = reducer(p, { type: 'moveStrip', sheetId: p.sheets[i].id, date: toISO(addDays(start, day - 1)), beforeId: null });
  });
  return runRules(p).project;
}

/**
 * Adds a shot list to one shooting day. Shots go to the scene on that day with the same number
 * (or the same set), then to an unscheduled scene with that number, which moves onto the day;
 * anything else becomes a new scene on the day. Scenes that get shots lose their old ones.
 */
export function attachShotList(
  project: Project,
  shots: ParsedShot[],
  date: string,
): { project: Project; matched: number; created: number } {
  let p = project;
  const dayIds = [...(p.schedule.byDate[date] ?? [])];
  const scheduled = new Set(Object.values(p.schedule.byDate).flat());
  const sheets = new Map(p.sheets.map((s) => [s.id, s]));
  const onDay = dayIds.map((id) => sheets.get(id)!).filter(Boolean);
  const pool = p.sheets.filter((s) => !scheduled.has(s.id));

  const targets = new Map<string, ParsedShot[]>();
  const orphans: ParsedShot[] = [];
  for (const s of shots) {
    const byNumber = (list: Sheet[]) => (s.scene ? list.find((x) => sceneKey(x.scenes) === sceneKey(s.scene)) : undefined);
    const bySet = s.location ? onDay.find((x) => x.set === s.location.toUpperCase()) : undefined;
    const target =
      byNumber(onDay) ?? bySet ?? byNumber(pool) ?? (!s.scene && !s.location && onDay.length === 1 ? onDay[0] : undefined);
    if (target) targets.set(target.id, [...(targets.get(target.id) ?? []), s]);
    else orphans.push(s);
  }

  // Unscheduled scenes that got shots join the end of the day.
  for (const id of targets.keys())
    if (!scheduled.has(id)) p = reducer(p, { type: 'moveStrip', sheetId: id, date, beforeId: null });

  const groups = groupByScene(orphans);
  const nextNumber = Math.max(0, ...p.sheets.map((s) => Number.parseInt(s.sheetNumber) || 0));
  const fresh = groups.map((g, i) => sheetFromShots(g, String(nextNumber + i + 1), `${nextNumber + i + 1}`));
  p = { ...p, sheets: [...p.sheets, ...fresh] };
  for (const s of fresh) p = reducer(p, { type: 'moveStrip', sheetId: s.id, date, beforeId: null });

  const replaced = new Set([...targets.keys(), ...fresh.map((s) => s.id)]);
  p = {
    ...p,
    shots: [
      ...p.shots.filter((s) => !replaced.has(s.sheetId)),
      ...[...targets].flatMap(([id, list]) => list.map((s) => toShot(s, id))),
      ...groups.flatMap((g, i) => g.map((s) => toShot(s, fresh[i].id))),
    ],
  };
  for (const [id, list] of targets) p = tagTalent(p, id, list);
  groups.forEach((g, i) => (p = tagTalent(p, fresh[i].id, g)));
  return { project: p, matched: targets.size, created: fresh.length };
}
