import {
  addDays,
  elementLabel,
  formatEighths,
  fromISO,
  shootDayNumbers,
  STRIP_KINDS,
  stripKind,
  toISO,
  weekStart,
  type BreakdownElement,
  type Project,
  type Sheet,
} from './model';
import { saveFile } from './platform';

export const SHEET_FIELDS = [
  ['sheetNumber', 'Sheet'],
  ['scenes', 'Scene'],
  ['intExt', 'I/E'],
  ['set', 'Set'],
  ['dayNight', 'D/N'],
  ['pages', 'Pages'],
  ['synopsis', 'Synopsis'],
  ['scriptDay', 'Script Day'],
  ['location', 'Location'],
  ['scriptPage', 'Script Page'],
  ['timing', 'Est. Time'],
  ['sequence', 'Sequence'],
  ['episode', 'Episode'],
  ['misc1', 'Misc 1'],
  ['misc2', 'Misc 2'],
  ['misc3', 'Misc 3'],
  ['misc4', 'Misc 4'],
] as const;

const fieldValue = (s: Sheet, key: (typeof SHEET_FIELDS)[number][0]) =>
  key === 'pages' ? formatEighths(s.pages) : String(s[key] ?? '');

/** Confirmed tags only; pending suggestions are not part of the breakdown yet. */
function confirmedIn(s: Sheet, categoryId: string, els: Map<string, BreakdownElement>): string[] {
  return s.tags
    .filter((t) => t.state === 'confirmed' && els.get(t.elementId)?.categoryId === categoryId)
    .map((t) => elementLabel(els.get(t.elementId)!));
}

function castIdList(s: Sheet, els: Map<string, BreakdownElement>): string {
  return s.tags
    .filter((t) => t.state === 'confirmed')
    .map((t) => els.get(t.elementId)?.castId)
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b)
    .join(', ');
}

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTH_FMT: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
const fmtShort = (d: Date) => d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
const pagesLabel = (eighths: number) => `${formatEighths(eighths) || '0'} pgs`;
const weekday = (d: Date) => WEEKDAYS[(d.getDay() + 6) % 7];

function stripsOn(p: Project, iso: string, byId: Map<string, Sheet>): Sheet[] {
  return (p.schedule.byDate[iso] ?? []).map((id) => byId.get(id)).filter((s): s is Sheet => !!s);
}

function unscheduled(p: Project): Sheet[] {
  const scheduled = new Set(Object.values(p.schedule.byDate).flat());
  return p.sheets.filter((s) => !scheduled.has(s.id));
}

/** First day of every month that has shooting days; the current month when nothing is scheduled. */
function calendarMonths(p: Project): Date[] {
  const keys = new Set([...shootDayNumbers(p.schedule).keys()].map((iso) => iso.slice(0, 7)));
  if (!keys.size) keys.add(toISO(new Date()).slice(0, 7));
  return [...keys].sort().map((k) => fromISO(`${k}-01`));
}

/** Monday-first weeks covering a month, as arrays of 7 dates. */
function monthWeeks(first: Date): Date[][] {
  const start = weekStart(first);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const weeks: Date[][] = [];
  for (let d = start; d <= last; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return weeks;
}

/** Mondays of every week that has shooting days, in date order. */
function shootingWeeks(p: Project): Date[] {
  const keys = new Set([...shootDayNumbers(p.schedule).keys()].map((iso) => toISO(weekStart(fromISO(iso)))));
  return [...keys].sort().map(fromISO);
}

const baseName = (p: Project) => p.title.trim().replace(/[\\/:*?"<>|]/g, '') || 'breakdown';

// ---------------------------------------------------------------- JSON

export async function exportJSON(p: Project) {
  await saveFile(`${baseName(p)}.filmorganizer.json`, JSON.stringify(p, null, 2), 'application/json');
}

// ---------------------------------------------------------------- Excel

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;
const solid = (hex: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: argb(hex) } });

/** Text of one stripboard card, as shown in the app. */
function cardText(s: Sheet, els: Map<string, BreakdownElement>): string {
  const cast = castIdList(s, els);
  return [
    `#${s.scenes || '—'}   ${formatEighths(s.pages) || '—'}`,
    s.set || 'Untitled set',
    `${stripKind(s).label}${cast ? ` · Cast ${cast}` : ''}`,
  ].join('\n');
}

export async function exportXLSX(p: Project) {
  const { default: ExcelJS } = await import('exceljs');
  const els = new Map(p.elements.map((e) => [e.id, e]));
  const byId = new Map(p.sheets.map((s) => [s.id, s]));
  const dayNumbers = shootDayNumbers(p.schedule);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FilmOrganizer';
  wb.title = p.title;
  const thin = { style: 'thin' as const, color: { argb: 'FFD4D4D8' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const white = { style: 'medium' as const, color: { argb: 'FFFFFFFF' } };
  const gap = { top: white, left: white, bottom: white, right: white };

  // Breakdown: one row per scene, one column per category.
  const bd = wb.addWorksheet('Breakdown', { views: [{ state: 'frozen', xSplit: 4, ySplit: 1 }] });
  bd.columns = [
    ...SHEET_FIELDS.map(([key, header]) => ({ header, key, width: key === 'synopsis' ? 40 : key === 'set' ? 28 : 11 })),
    ...p.categories.map((c) => ({ header: c.name, key: c.id, width: 24 })),
  ];
  bd.getRow(1).font = { bold: true };
  for (const s of p.sheets) {
    const row = bd.addRow([
      ...SHEET_FIELDS.map(([key]) => fieldValue(s, key)),
      ...p.categories.map((c) => confirmedIn(s, c.id, els).join('\n')),
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    const k = stripKind(s);
    for (let c = 1; c <= 6; c++) row.getCell(c).fill = solid(k.bg);
  }

  // Calendar: a month grid for every month with shooting days.
  const cal = wb.addWorksheet('Calendar');
  cal.columns = WEEKDAYS.map(() => ({ width: 26 }));
  for (const first of calendarMonths(p)) {
    const title = cal.addRow([first.toLocaleDateString('en-US', MONTH_FMT)]);
    cal.mergeCells(title.number, 1, title.number, 7);
    title.font = { bold: true, size: 14 };
    title.height = 24;
    const head = cal.addRow(WEEKDAYS);
    head.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = solid('#18181b');
      c.alignment = { horizontal: 'center' };
    });
    for (const week of monthWeeks(first)) {
      let lines = 2;
      const row = cal.addRow(
        week.map((date) => {
          const iso = toISO(date);
          const strips = stripsOn(p, iso, byId);
          const dayNo = dayNumbers.get(iso);
          const text = [
            `${date.getDate()}${p.daysOff.includes(iso) ? '   ·   DAY OFF' : dayNo ? `   ·   Day ${dayNo}` : ''}`,
            ...strips.map((s) => `#${s.scenes || '—'} ${s.set} (${stripKind(s).label})`),
            ...(strips.length ? [`${pagesLabel(strips.reduce((n, s) => n + s.pages, 0))} · ${strips.length} sc`] : []),
          ];
          lines = Math.max(lines, text.length);
          return text.join('\n');
        }),
      );
      row.height = Math.max(48, lines * 14 + 6);
      week.forEach((date, i) => {
        const cell = row.getCell(i + 1);
        const outside = date.getMonth() !== first.getMonth();
        const shoot = dayNumbers.has(toISO(date));
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = box;
        if (outside) cell.font = { color: { argb: 'FFA1A1AA' } };
        if (p.daysOff.includes(toISO(date))) {
          cell.font = { bold: true, color: { argb: 'FF9A3B33' } };
          cell.fill = solid('#f6e0dd');
        } else if (shoot) {
          cell.font = { bold: true };
          cell.fill = solid('#ededf0');
        } else if (outside) cell.fill = solid('#fafafa');
      });
    }
    cal.addRow([]);
  }

  // Stripboard: every shooting week as day columns of coloured strips, then the unscheduled pool.
  const sb = wb.addWorksheet('Stripboard');
  sb.columns = WEEKDAYS.map(() => ({ width: 24 }));
  const legend = sb.addRow(STRIP_KINDS.map((k) => k.label));
  STRIP_KINDS.forEach((k, i) => {
    const c = legend.getCell(i + 1);
    c.fill = solid(k.bg);
    c.font = { bold: true, color: { argb: argb(k.ink) } };
    c.alignment = { horizontal: 'center' };
    c.border = gap;
  });
  sb.addRow([]);
  const cardCell = (c: ReturnType<typeof legend.getCell>, s: Sheet) => {
    const k = stripKind(s);
    c.value = cardText(s, els);
    c.fill = solid(k.bg);
    c.font = { color: { argb: argb(k.ink) } };
    c.alignment = { vertical: 'top', wrapText: true };
    c.border = gap;
  };
  const weeks = shootingWeeks(p);
  if (!weeks.length) sb.addRow(['No scenes scheduled yet.']).font = { italic: true };
  for (const monday of weeks) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const columns = days.map((d) => stripsOn(p, toISO(d), byId));
    const title = sb.addRow([`Week of ${fmtShort(days[0])} – ${fmtShort(days[6])}, ${days[6].getFullYear()}`]);
    sb.mergeCells(title.number, 1, title.number, 7);
    title.font = { bold: true, size: 13 };
    title.height = 22;
    const head = sb.addRow(
      days.map((d) => {
        const dayNo = dayNumbers.get(toISO(d));
        return `${weekday(d)} ${fmtShort(d)}${dayNo ? `\nDay ${dayNo}` : ''}`;
      }),
    );
    head.height = 30;
    head.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = solid('#18181b');
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    const depth = Math.max(...columns.map((c) => c.length));
    for (let r = 0; r < depth; r++) {
      const row = sb.addRow([]);
      row.height = 48;
      columns.forEach((strips, i) => strips[r] && cardCell(row.getCell(i + 1), strips[r]));
    }
    const foot = sb.addRow(columns.map((strips) => `Total ${pagesLabel(strips.reduce((n, s) => n + s.pages, 0))} · ${strips.length} sc`));
    foot.eachCell((c) => {
      c.font = { bold: true };
      c.fill = solid('#e4e4e7');
      c.border = box;
    });
    sb.addRow([]);
  }
  const pool = unscheduled(p);
  if (pool.length) {
    const title = sb.addRow([`Unscheduled (${pool.length})`]);
    sb.mergeCells(title.number, 1, title.number, 7);
    title.font = { bold: true, size: 13 };
    for (let i = 0; i < pool.length; i += 7) {
      const row = sb.addRow([]);
      row.height = 48;
      pool.slice(i, i + 7).forEach((s, j) => cardCell(row.getCell(j + 1), s));
    }
  }

  // Element list with the scenes each element appears in.
  const el = wb.addWorksheet('Elements', { views: [{ state: 'frozen', ySplit: 1 }] });
  el.columns = [
    { header: 'Category', width: 22 },
    { header: 'ID', width: 6 },
    { header: 'Element', width: 30 },
    { header: 'Scene count', width: 12 },
    { header: 'Scenes', width: 50 },
  ];
  el.getRow(1).font = { bold: true };
  for (const c of p.categories)
    for (const e of p.elements.filter((x) => x.categoryId === c.id)) {
      const scenes = p.sheets.filter((s) => s.tags.some((t) => t.elementId === e.id && t.state === 'confirmed'));
      if (scenes.length) el.addRow([c.name, e.castId ?? '', e.name, scenes.length, scenes.map((s) => s.scenes).join(', ')]);
    }

  for (const ws of [cal, sb]) ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  const buf = await wb.xlsx.writeBuffer();
  await saveFile(`${baseName(p)}.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// ---------------------------------------------------------------- PDF

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;

/** PDF with three sections, each starting on its own page: breakdown, calendar, stripboard. */
export async function exportPDF(p: Project) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const els = new Map(p.elements.map((e) => [e.id, e]));
  const byId = new Map(p.sheets.map((s) => [s.id, s]));
  const dayNumbers = shootDayNumbers(p.schedule);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const bottom = H - 44;
  const total = p.sheets.reduce((n, s) => n + s.pages, 0);

  const title = (text: string, sub: string) => {
    doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(0).text(text, M, 44);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110).text(sub, M, 60);
    doc.setTextColor(0);
  };
  /** Truncates text with an ellipsis to fit the width at the current font size. */
  const fit = (text: string, width: number) => {
    if (doc.getTextWidth(text) <= width) return text;
    let t = text;
    while (t && doc.getTextWidth(`${t}…`) > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  const legend = () => {
    doc.setFont('helvetica', 'normal').setFontSize(7);
    let x = W - M;
    for (const k of [...STRIP_KINDS].reverse()) {
      const w = doc.getTextWidth(k.label) + 12;
      x -= w;
      doc.setFillColor(...rgb(k.bg)).setDrawColor(200).rect(x, 50, w - 4, 12, 'FD');
      doc.setTextColor(...rgb(k.ink)).text(k.label, x + 4, 58.5);
    }
    doc.setTextColor(0);
  };

  // 1. Breakdown: scene fields plus every confirmed element grouped by category.
  title(`${p.title} - Breakdown`, `${p.sheets.length} scenes · ${formatEighths(total) || 0} pages · confirmed elements only`);
  autoTable(doc, {
    startY: 74,
    head: [['Sheet', 'Scene', 'I/E', 'Set', 'D/N', 'Pages', 'Synopsis', 'Elements']],
    body: p.sheets.map((s) => [
      s.sheetNumber,
      s.scenes,
      s.intExt,
      s.set,
      s.dayNight,
      formatEighths(s.pages),
      s.synopsis,
      p.categories
        .map((c) => ({ c, items: confirmedIn(s, c.id, els) }))
        .filter((x) => x.items.length)
        .map((x) => `${x.c.name}: ${x.items.join(', ')}`)
        .join('\n'),
    ]),
    styles: { fontSize: 8, cellPadding: 4, valign: 'top' },
    headStyles: { fillColor: [24, 24, 27] },
    columnStyles: { 3: { cellWidth: 120 }, 6: { cellWidth: 170 }, 7: { cellWidth: 250 } },
    didParseCell: (data) => {
      if (data.section !== 'body' || data.column.index > 5) return;
      const k = stripKind(p.sheets[data.row.index]);
      data.cell.styles.fillColor = rgb(k.bg);
      data.cell.styles.textColor = rgb(k.ink);
    },
  });

  // 2. Calendar: one page per month with shooting days.
  for (const first of calendarMonths(p)) {
    doc.addPage();
    const weeks = monthWeeks(first);
    const shootDays = weeks.flat().filter((d) => d.getMonth() === first.getMonth() && dayNumbers.has(toISO(d))).length;
    title(`${p.title} - Calendar`, `${first.toLocaleDateString('en-US', MONTH_FMT)} · ${shootDays} shooting days`);
    legend();
    const top = 74;
    const colW = (W - 2 * M) / 7;
    const headH = 18;
    const rowH = (bottom - top - headH) / weeks.length;
    doc.setFillColor(24, 24, 27).rect(M, top, W - 2 * M, headH, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(255);
    WEEKDAYS.forEach((w, i) => doc.text(w, M + i * colW + colW / 2, top + 12, { align: 'center' }));
    weeks.forEach((week, r) =>
      week.forEach((date, c) => {
        const x = M + c * colW;
        const y = top + headH + r * rowH;
        const iso = toISO(date);
        const outside = date.getMonth() !== first.getMonth();
        const strips = stripsOn(p, iso, byId);
        const dayNo = dayNumbers.get(iso);
        doc.setDrawColor(212, 212, 216).setLineWidth(0.5);
        const off = p.daysOff.includes(iso);
        if (off) doc.setFillColor(246, 224, 221).rect(x, y, colW, rowH, 'FD');
        else if (outside) doc.setFillColor(248, 248, 249).rect(x, y, colW, rowH, 'FD');
        else doc.rect(x, y, colW, rowH);
        doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(outside ? 170 : 24).text(String(date.getDate()), x + 5, y + 12);
        if (off) doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(154, 59, 51).text('DAY OFF', x + colW - 5, y + 12, { align: 'right' });
        else if (dayNo) {
          const label = `Day ${dayNo}`;
          doc.setFontSize(7);
          const w = doc.getTextWidth(label) + 8;
          doc.setFillColor(24, 24, 27).roundedRect(x + colW - w - 4, y + 4, w, 11, 2, 2, 'F');
          doc.setTextColor(255).text(label, x + colW - w, y + 12);
        }
        const room = Math.max(0, Math.floor((rowH - 18 - 12) / 11));
        const shown = strips.length > room ? strips.slice(0, Math.max(0, room - 1)) : strips;
        doc.setFont('helvetica', 'normal').setFontSize(7);
        shown.forEach((s, i) => {
          const k = stripKind(s);
          const sy = y + 18 + i * 11;
          doc.setFillColor(...rgb(k.bg)).rect(x + 3, sy, colW - 6, 10, 'F');
          doc.setTextColor(...rgb(k.ink)).text(fit(`#${s.scenes || '—'} ${s.set}`, colW - 12), x + 6, sy + 7.5);
        });
        if (shown.length < strips.length)
          doc.setTextColor(110).text(`+${strips.length - shown.length} more`, x + 6, y + 18 + shown.length * 11 + 7.5);
        if (strips.length)
          doc
            .setTextColor(90)
            .text(`${pagesLabel(strips.reduce((n, s) => n + s.pages, 0))} · ${strips.length} sc`, x + colW - 5, y + rowH - 5, { align: 'right' });
      }),
    );
    doc.setTextColor(0);
  }

  // 3. Stripboard: one page per shooting week (more if a day overflows), then the unscheduled pool.
  const cardH = 40;
  const pitch = cardH + 4;
  const colW = (W - 2 * M - 6 * 6) / 7;
  const card = (s: Sheet, x: number, y: number, w: number) => {
    const k = stripKind(s);
    const cast = castIdList(s, els);
    doc.setFillColor(...rgb(k.bg)).roundedRect(x, y, w, cardH, 3, 3, 'F');
    doc.setTextColor(...rgb(k.ink)).setFont('helvetica', 'bold').setFontSize(8).text(`#${s.scenes || '—'}`, x + 5, y + 11);
    doc.setFont('helvetica', 'normal').text(formatEighths(s.pages) || '—', x + w - 5, y + 11, { align: 'right' });
    doc.setFont('helvetica', 'bold').text(fit(s.set || 'Untitled set', w - 10), x + 5, y + 23);
    doc.setFont('helvetica', 'normal').setFontSize(7).text(fit(`${k.label}${cast ? ` · Cast ${cast}` : ''}`, w - 10), x + 5, y + 34);
    doc.setTextColor(0);
  };
  const weeks = shootingWeeks(p);
  for (const monday of weeks) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const columns = days.map((d) => stripsOn(p, toISO(d), byId));
    const scenes = columns.reduce((n, c) => n + c.length, 0);
    const bodyTop = 110;
    const footTop = bottom - 18;
    const perPage = Math.floor((footTop - 4 - bodyTop) / pitch);
    const pageCount = Math.max(1, ...columns.map((c) => Math.ceil(c.length / perPage)));
    for (let pg = 0; pg < pageCount; pg++) {
      doc.addPage();
      title(
        `${p.title} - Stripboard`,
        `Week of ${fmtShort(days[0])} – ${fmtShort(days[6])}, ${days[6].getFullYear()} · ${scenes} scenes${pageCount > 1 ? ` · part ${pg + 1} of ${pageCount}` : ''}`,
      );
      legend();
      days.forEach((d, i) => {
        const x = M + i * (colW + 6);
        const dayNo = dayNumbers.get(toISO(d));
        doc.setFillColor(24, 24, 27).roundedRect(x, 74, colW, 30, 3, 3, 'F');
        doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(255).text(`${weekday(d)} ${fmtShort(d)}`, x + 6, 87);
        if (dayNo) doc.setFont('helvetica', 'normal').setFontSize(7).text(`Day ${dayNo}`, x + 6, 98);
        doc.setDrawColor(228, 228, 231).setLineWidth(0.5).rect(x, bodyTop - 3, colW, footTop - bodyTop + 3);
        columns[i].slice(pg * perPage, (pg + 1) * perPage).forEach((s, r) => card(s, x + 3, bodyTop + r * pitch, colW - 6));
        if (pg === pageCount - 1) {
          const eighths = columns[i].reduce((n, s) => n + s.pages, 0);
          doc.setFillColor(244, 244, 245).rect(x, footTop, colW, 18, 'F');
          doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(40).text('Total', x + 5, footTop + 12);
          doc.text(`${pagesLabel(eighths)} · ${columns[i].length} sc`, x + colW - 5, footTop + 12, { align: 'right' });
        }
      });
      doc.setTextColor(0);
    }
  }
  const pool = unscheduled(p);
  if (pool.length || !weeks.length) {
    const perPage = 7 * Math.floor((bottom - 74) / pitch);
    const pageCount = Math.max(1, Math.ceil(pool.length / perPage));
    for (let pg = 0; pg < pageCount; pg++) {
      doc.addPage();
      title(`${p.title} - Stripboard`, `Unscheduled · ${pool.length} scenes${weeks.length ? '' : ' · no scenes scheduled yet'}`);
      legend();
      pool
        .slice(pg * perPage, (pg + 1) * perPage)
        .forEach((s, i) => card(s, M + (i % 7) * (colW + 6), 74 + Math.floor(i / 7) * pitch, colW));
    }
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130).text(`${p.title} · page ${i} of ${pages}`, M, H - 20);
  }
  await saveFile(`${baseName(p)}.pdf`, doc.output('arraybuffer'), 'application/pdf');
}

