// PDR Excel export: the sequenced rows written either into FilmOrganizer's own PDR layout,
// or into a copy of the user's PDR template (header and call sheet left as they are).

import type { Cell, Worksheet } from 'exceljs';
import { SHOT_TYPES, type PdrSettings, type Project } from './model';
import { fmtClock, type PdrRow } from './pdr';
import { saveFile } from './platform';

const LABELS = {
  en: {
    call: 'GENERAL CALL',
    prep: 'EQUIPMENT PREP',
    reset: 'Reset: camera and lights',
    move: (from: string, to: string) => `Company move: ${from} → ${to}`,
    lunch: 'LUNCH',
    wrap: 'WRAP',
    end: 'END OF DAY',
    day: (n: number) => `DAY ${n}`,
    shootDay: (n: number) => `Shooting day ${n}`,
    headers: ['TIME', 'SCENE', 'DESCRIPTION', 'TALENT', 'SHOT', 'SHOT REFERENCE', 'PRODUCTION NOTES'],
  },
  es: {
    call: 'CITACIÓN GENERAL',
    prep: 'PREPARACIÓN EQUIPO',
    reset: 'Reset — recolocación cámara y luz',
    move: (from: string, to: string) => `Company move — ${from} → ${to}`,
    lunch: 'COMIDA',
    wrap: 'WRAP',
    end: 'END OF THE DAY',
    day: (n: number) => `DÍA ${n}`,
    shootDay: (n: number) => `Día de rodaje ${n}`,
    headers: ['HORAS', 'ESCENA', 'DESCRIPCIÓN', 'TALENT', 'Plano', 'REFERENCIA DE PLANOS', 'OBSERVACIONES PRODU'],
  },
};
export type PdrLabels = (typeof LABELS)['en'];
export const pdrLabels = (lang: PdrSettings['sheetLanguage']): PdrLabels => LABELS[lang];

/** The label shown in a structural row's text cell. */
export function rowLabel(r: PdrRow, L: PdrLabels): string {
  switch (r.kind) {
    case 'call':
      return L.call;
    case 'prep':
      return L.prep;
    case 'reset':
      return L.reset;
    case 'move':
      return L.move(r.from || '—', r.to || '—');
    case 'lunch':
      return L.lunch;
    case 'wrap':
      return L.wrap;
    case 'end':
      return r.start !== undefined ? `${L.end} — ${fmtClock(r.start)}` : L.end;
    case 'daySep':
      return L.day(r.day);
    default:
      return '';
  }
}

export const timeText = (r: PdrRow) =>
  r.start === undefined ? '' : r.end === undefined ? fmtClock(r.start) : `${fmtClock(r.start)} - ${fmtClock(r.end)}`;

export function shotTypeLabel(type: string, lang: PdrSettings['sheetLanguage']): string {
  const t = SHOT_TYPES.find((x) => x.key === type);
  return t ? (lang === 'es' ? t.es : t.label) : '';
}

/** "Porch - back door" → "Porch": the scene cell only has room for the short name. */
const shortLocation = (s: string) => s.split(' - ')[0].split(' – ')[0].trim();

// ---------------------------------------------------------------- Styles (from the PDR template)

const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${argb}` } });
const FILL_DARK = fill('434343');
const FILL_SEP = fill('C9DAF8');
const FILL_BLACK = fill('000000');
const FILL_TIME = fill('C9DAF8');
const FILL_DATA = fill('EFEFEF');
const FILL_KEY = fill('FFFF00');
const thin = { style: 'thin' as const };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };
const CENTER = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true };
const LEFT_TOP = { horizontal: 'left' as const, vertical: 'top' as const, wrapText: true };
const HELV = 'Helvetica Neue';
const font = (o: { size?: number; bold?: boolean; color?: string; name?: string } = {}) => ({
  name: o.name ?? HELV,
  size: o.size ?? 11,
  bold: o.bold ?? false,
  ...(o.color ? { color: { argb: `FF${o.color}` } } : {}),
});

/** Where each column sits. The template has two-column TIME and REFERENCE spans. */
interface Layout {
  time: [number, number];
  scene: number;
  desc: number;
  talent: number;
  shot: number;
  ref: [number, number];
  notes: number;
  last: number;
}
const OWN_LAYOUT: Layout = { time: [1, 1], scene: 2, desc: 3, talent: 4, shot: 5, ref: [6, 6], notes: 7, last: 7 };
const TEMPLATE_LAYOUT: Layout = { time: [1, 2], scene: 3, desc: 4, talent: 5, shot: 6, ref: [7, 8], notes: 9, last: 9 };

function style(c: Cell, s: { value?: string; fill?: object; font?: object; alignment?: object }) {
  if (s.value !== undefined) c.value = s.value;
  if (s.fill) c.fill = s.fill as Cell['fill'];
  if (s.font) c.font = s.font;
  if (s.alignment) c.alignment = s.alignment as Cell['alignment'];
  c.border = BOX;
}

/** About how many wrapped lines a text needs in a column of this width (an estimate). */
function lines(text: string, width: number): number {
  const perLine = Math.max(8, Math.floor(width * 1.7));
  return Math.max(
    1,
    text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0),
  );
}

function writeRows(ws: Worksheet, rows: PdrRow[], startRow: number, L: Layout, cfg: PdrSettings) {
  const labels = pdrLabels(cfg.sheetLanguage);
  const width = (col: number, fallback: number) => ws.getColumn(col).width || fallback;
  const range = (r: number, from: number, to: number) => from < to && ws.mergeCells(r, from, r, to);
  let r = startRow;
  for (const row of rows) {
    if (row.kind === 'end' || row.kind === 'daySep') {
      range(r, 1, L.last);
      for (let c = 1; c <= L.last; c++) style(ws.getCell(r, c), { fill: FILL_BLACK, font: font({ bold: true, color: 'FFFFFF' }), alignment: CENTER });
      ws.getCell(r, 1).value = rowLabel(row, labels);
      ws.getRow(r).height = 26;
    } else if (row.kind !== 'shot') {
      const dark = row.kind === 'call' || row.kind === 'prep';
      const f = dark ? FILL_DARK : FILL_SEP;
      const fnt = dark ? font({ color: 'FFFFFF' }) : font({ bold: true });
      range(r, L.time[0], L.time[1]);
      range(r, L.scene, L.last);
      for (let c = 1; c <= L.last; c++) style(ws.getCell(r, c), { fill: f, font: fnt, alignment: CENTER });
      ws.getCell(r, L.time[0]).value = timeText(row);
      ws.getCell(r, L.scene).value = rowLabel(row, labels);
      ws.getRow(r).height = dark ? 18 : 20;
    } else {
      const s = row.shot!;
      const data = s.keyShot ? FILL_KEY : FILL_DATA;
      const body = font({ size: 9, name: 'Arial' });
      const loc = shortLocation(s.location);
      const scene = loc ? `${s.number}\n${loc}` : s.number;
      const notes = [...s.alerts, s.notes, s.placeholder ? '(no shot list for this scene)' : ''].filter(Boolean).join('\n');
      const type = `${shotTypeLabel(s.type, cfg.sheetLanguage)}${s.keyShot ? ' ⭐' : ''}`.trim();
      range(r, L.time[0], L.time[1]);
      range(r, L.ref[0], L.ref[1]);
      for (let c = 1; c <= L.last; c++) style(ws.getCell(r, c), { fill: c <= L.time[1] ? FILL_TIME : data, font: body, alignment: LEFT_TOP });
      style(ws.getCell(r, L.time[0]), { value: timeText(row), font: font({ bold: true }), alignment: CENTER });
      style(ws.getCell(r, L.scene), { value: scene });
      style(ws.getCell(r, L.desc), { value: s.description });
      style(ws.getCell(r, L.talent), { value: s.talent.join(', '), alignment: CENTER });
      style(ws.getCell(r, L.shot), { value: type, alignment: CENTER });
      style(ws.getCell(r, L.notes), {
        value: notes,
        font: font({ size: 9, name: 'Arial', bold: true, color: s.alerts.length ? 'C00000' : undefined }),
        alignment: s.alerts.length ? LEFT_TOP : CENTER,
      });
      const needed = Math.max(
        lines(scene, width(L.scene, 19)),
        lines(s.description, width(L.desc, 44)),
        lines(s.talent.join(', '), width(L.talent, 31)),
        lines(notes, width(L.notes, 42)),
      );
      ws.getRow(r).height = Math.min(160, Math.max(30, needed * 12 + 8));
    }
    r++;
  }
}

export interface PdrExportInfo {
  /** e.g. "Shooting day 2 · Tue 4 Nov 2026"; the whole schedule when several days are exported. */
  subtitle: string;
  fileTag: string;
}

const baseName = (p: Project) => (p.title.trim() || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-');
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** FilmOrganizer's own PDR sheet: title, day line, column headers, then the schedule. */
export async function exportPdrXLSX(p: Project, rows: PdrRow[], info: PdrExportInfo) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FilmOrganizer';
  wb.title = `${p.title} PDR`;
  const ws = wb.addWorksheet('PDR', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  ws.columns = [13, 18, 44, 28, 12, 28, 40].map((width) => ({ width }));
  const labels = pdrLabels(p.pdr.sheetLanguage);

  ws.mergeCells(1, 1, 1, 7);
  ws.getCell(1, 1).value = p.title || 'Untitled';
  ws.getCell(1, 1).font = font({ size: 20, bold: true });
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, 7);
  ws.getCell(2, 1).value = info.subtitle;
  ws.getCell(2, 1).font = font({ size: 12 });
  labels.headers.forEach((h, i) =>
    style(ws.getCell(4, i + 1), { value: h, fill: FILL_DARK, font: font({ bold: true, color: 'FFFFFF' }), alignment: CENTER }),
  );
  ws.getRow(4).height = 22;

  writeRows(ws, rows, 5, OWN_LAYOUT, p.pdr);
  const buf = await wb.xlsx.writeBuffer();
  return saveFile(`${baseName(p)} PDR${info.fileTag}.xlsx`, buf, XLSX_TYPE);
}

/** The header row is the first one with a TIME / HORAS or SCENE / ESCENA heading. */
function findHeaderRow(ws: Worksheet): number | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 80); r++)
    for (const c of [1, 2, 3]) {
      const v = String(ws.getCell(r, c).value ?? '').trim().toUpperCase();
      if (/^(HORAS|TIME|ESCENA|SCENE)\b/.test(v)) return r;
    }
  return null;
}

/**
 * Writes the schedule into a copy of the user's own PDR template: everything above the column
 * headers (title, call sheet) is kept, everything below is replaced. The template needs the
 * PDR layout: TIME in A:B, then SCENE, DESCRIPTION, TALENT, SHOT, REFERENCE (G:H), NOTES (I).
 */
export async function exportPdrIntoTemplate(p: Project, rows: PdrRow[], info: PdrExportInfo, template: File) {
  if (!/\.xlsx$/i.test(template.name)) throw new Error('The template must be an Excel .xlsx file.');
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await template.arrayBuffer());
  const ws = wb.getWorksheet('PDR FINAL') ?? wb.worksheets[0];
  if (!ws) throw new Error('This template has no sheets.');
  const header = findHeaderRow(ws);
  if (!header)
    throw new Error(
      `No column header row (HORAS / TIME or ESCENA / SCENE in column A, B or C) was found in “${template.name}”.`,
    );
  const first = header + 1;

  // The project name sits in A8 of the PDR template; replace it only if there is one.
  if (ws.getCell('A8').value) ws.getCell('A8').value = p.title;

  // Clear the template's sample body: merges, values, styles and row heights.
  for (const range of [...((ws.model as { merges?: string[] }).merges ?? [])]) {
    const top = Number(range.split(':')[0].replace(/^[A-Z]+/, ''));
    if (top >= first) ws.unMergeCells(range);
  }
  const lastRow = Math.max(ws.rowCount, first + rows.length + 10);
  for (let r = first; r <= lastRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= TEMPLATE_LAYOUT.last; c++) {
      const cell = row.getCell(c);
      cell.value = null;
      cell.style = {};
    }
    row.height = undefined as unknown as number;
  }

  writeRows(ws, rows, first, TEMPLATE_LAYOUT, p.pdr);
  const buf = await wb.xlsx.writeBuffer();
  return saveFile(`${baseName(p)} PDR${info.fileTag}.xlsx`, buf, XLSX_TYPE);
}
