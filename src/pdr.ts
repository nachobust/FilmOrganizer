// Shooting plan (plan de rodaje, PDR): orders a day's shots by production logic, not script order, and
// times the day around call, prep, lunch and wrap.
//
// Order within a day:
//   1. One location at a time, in the order the day's scenes first use them, so each
//      location is shot out before the company moves on.
//   2. Inside a location, shots with its whole talent group first (masters), camera closing in.
//   3. Then each character in turn, closing in (wide → medium → close) before the next
//      character. A shot with several people goes with the first of them.
//   4. A change of setup inside a location is a reset; a change of location is a company move.
//   5. Inserts at the end of their location, so the company never goes back for them.
//   6. Field / product shots after lunch, starting where the company already is.
// Lunch is one block placed when the clock reaches the lunch time; a running block isn't split.
// After lunch the same location needs no reset, but a new location still needs its move.
// A day the user arranged by hand keeps their order (see sequenceManual).

import { SHOT_TYPES, shootDayNumbers, type PdrSettings, type Project, type Shot } from './model';

/** A shot ready for sequencing: scenes without a shot list stand in as one shot each. */
export interface PdrShot extends Shot {
  day: number;
  /** True for a scene without a shot list. */
  placeholder: boolean;
}

export type PdrRowKind = 'call' | 'prep' | 'shot' | 'reset' | 'move' | 'lunch' | 'wrap' | 'end' | 'daySep';

export interface PdrRow {
  kind: PdrRowKind;
  day: number;
  /** Minutes since midnight. */
  start?: number;
  end?: number;
  shot?: PdrShot;
  /** Shots sharing a block id share a setup. */
  block?: number;
  /** Reset / company move: the shot it leads to (its minutes can be changed there). */
  next?: PdrShot;
  /** Company move: from → to. */
  from?: string;
  to?: string;
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const fmtClock = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Natural sort: "01.A" < "2.A" < "10.A" < "10.B". */
function numberKey(n: string): (string | number)[] {
  return n
    .trim()
    .split(/[^0-9A-Za-z]+/)
    .filter(Boolean)
    .map((p) => (/^\d+$/.test(p) ? Number(p) : p.toUpperCase()));
}

function compareNumbers(a: string, b: string): number {
  const x = numberKey(a);
  const y = numberKey(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (typeof x[i] === 'number' && typeof y[i] === 'number') return (x[i] as number) - (y[i] as number);
    if (typeof x[i] === 'number') return -1;
    if (typeof y[i] === 'number') return 1;
    return String(x[i]).localeCompare(String(y[i]));
  }
  return x.length - y.length;
}

/** 0 = widest. A oner leads its block like a master; shots without a type sit in the middle. */
const closeness = (s: Shot) => (s.type ? Math.max(0, SHOT_TYPES.findIndex((t) => t.key === s.type) - 1) : 4);
const byCloseness = (a: Shot, b: Shot) => closeness(a) - closeness(b) || compareNumbers(a.number, b.number);
const setupOf = (s: Shot) => s.setup || s.location;

type Block = { location: string; setup: string; shots: PdrShot[] };

/** Splits an ordered run of shots whenever the location or setup changes. */
function splitBlocks(shots: PdrShot[]): Block[] {
  const blocks: Block[] = [];
  for (const s of shots) {
    const last = blocks[blocks.length - 1];
    if (!last || last.location !== s.location || last.setup !== setupOf(s))
      blocks.push({ location: s.location, setup: setupOf(s), shots: [] });
    blocks[blocks.length - 1].shots.push(s);
  }
  return blocks;
}

/** Groups by location and setup in order of first appearance, widest first inside each. */
function bySetup(shots: PdrShot[]): Block[] {
  const groups = new Map<string, Block>();
  for (const s of shots) {
    const key = `${s.location}\u0000${setupOf(s)}`;
    if (!groups.has(key)) groups.set(key, { location: s.location, setup: setupOf(s), shots: [] });
    groups.get(key)!.shots.push(s);
  }
  return [...groups.values()].map((b) => ({ ...b, shots: [...b.shots].sort(byCloseness) }));
}

function orderPrincipal(shots: PdrShot[]): Block[] {
  // When every shot has the same people (or nobody), grouping by talent does nothing:
  // group by setup instead so rooms and lighting stay together.
  if (new Set(shots.map((s) => [...s.talent].sort().join('\u0000'))).size <= 1) return bySetup(shots);
  const order: string[] = [];
  for (const s of shots) for (const t of s.talent) if (!order.includes(t)) order.push(t);
  const isFullGroup = (s: Shot) => order.length >= 2 && s.talent.length === order.length && order.every((t) => s.talent.includes(t));

  const full = shots.filter(isFullGroup).sort(byCloseness);
  const perChar = new Map(order.map((t) => [t, [] as PdrShot[]]));
  const nobody: PdrShot[] = [];
  for (const s of shots.filter((x) => !isFullGroup(x))) {
    const first = order.find((t) => s.talent.includes(t));
    if (first) perChar.get(first)!.push(s);
    else nobody.push(s);
  }
  return [
    ...splitBlocks(full),
    ...order.flatMap((t) => splitBlocks(perChar.get(t)!.sort(byCloseness))),
    ...splitBlocks(nobody.sort(byCloseness)),
  ];
}

/** Adds the reset or company move before `next` and returns the clock after it. */
function gap(rows: PdrRow[], from: string, next: PdrShot, move: boolean, clock: number, cfg: PdrSettings, day: number) {
  // The crew resets during lunch, but a company move still takes its time.
  const minutes = next.gapMinutes ?? (move ? cfg.moveMinutes : cfg.resetMinutes);
  rows.push({
    kind: move ? 'move' : 'reset',
    day,
    start: clock,
    end: clock + minutes,
    next,
    ...(move ? { from, to: next.location } : {}),
  });
  return clock + minutes;
}

/**
 * The user's own order: shots run exactly as listed. A change of setup or location still gets
 * its reset or company move, and lunch comes before the first shot that would start after the
 * lunch time.
 */
function sequenceManual(shots: PdrShot[], cfg: PdrSettings, day: number, rows: PdrRow[], start: number): number {
  const lunchAt = toMinutes(cfg.lunchAt);
  let clock = start;
  let prev: PdrShot | null = null;
  let lunched = false;
  let justLunched = false;
  let blockId = 0;
  const lunch = () => {
    const s = Math.max(clock, lunchAt);
    rows.push({ kind: 'lunch', day, start: s, end: s + cfg.lunchMinutes });
    clock = s + cfg.lunchMinutes;
    lunched = justLunched = true;
  };
  for (const shot of shots) {
    if (!lunched && clock >= lunchAt) lunch();
    const changed = !prev || prev.location !== shot.location || setupOf(prev) !== setupOf(shot);
    if (prev && changed) {
      const move = prev.location !== shot.location;
      if (move || !justLunched) clock = gap(rows, prev.location, shot, move, clock, cfg, day);
    }
    if (changed) blockId++;
    justLunched = false;
    const end = clock + (shot.minutes ?? cfg.shotMinutes);
    rows.push({ kind: 'shot', day, start: clock, end, shot, block: blockId });
    clock = end;
    prev = shot;
  }
  if (!lunched) lunch();
  return clock;
}

function sequenceDay(shots: PdrShot[], cfg: PdrSettings, day: number, order?: string[]): PdrRow[] {
  const call = toMinutes(cfg.callTime);
  const lunchAt = toMinutes(cfg.lunchAt);
  const rows: PdrRow[] = [{ kind: 'call', day, start: call }];
  let clock = call;
  if (cfg.prepMinutes > 0) {
    rows.push({ kind: 'prep', day, start: call, end: call + cfg.prepMinutes });
    clock += cfg.prepMinutes;
  }

  if (order) {
    // Shots not in the saved order (added since) follow it, in the automatic order.
    const auto = sequenceDay(shots, cfg, day)
      .filter((r) => r.kind === 'shot')
      .map((r) => r.shot!);
    const at = (s: PdrShot) => {
      const i = order.indexOf(s.id);
      return i < 0 ? order.length + auto.indexOf(s) : i;
    };
    clock = sequenceManual([...shots].sort((a, b) => at(a) - at(b)), cfg, day, rows, clock);
    rows.push({ kind: 'wrap', day, start: clock, end: clock + cfg.wrapMinutes });
    rows.push({ kind: 'end', day, start: clock + cfg.wrapMinutes });
    return rows;
  }

  let prev: Block | null = null;
  let lunched = false;
  let justLunched = false;
  let blockId = 1;
  const lunch = (force: boolean) => {
    if (lunched || (!force && clock < lunchAt)) return;
    const start = Math.max(clock, lunchAt);
    rows.push({ kind: 'lunch', day, start, end: start + cfg.lunchMinutes });
    clock = start + cfg.lunchMinutes;
    lunched = true;
    justLunched = true;
  };
  const run = (blocks: Block[]) => {
    for (const b of blocks) {
      lunch(false);
      const move = !!prev && prev.location !== b.location;
      if (prev && (move || !justLunched)) clock = gap(rows, prev.location, b.shots[0], move, clock, cfg, day);
      justLunched = false;
      for (const shot of b.shots) {
        const end = clock + (shot.minutes ?? cfg.shotMinutes);
        rows.push({ kind: 'shot', day, start: clock, end, shot, block: blockId });
        clock = end;
      }
      blockId++;
      prev = b;
    }
  };

  const principal = shots.filter((s) => s.category === 'principal');
  const inserts = shots.filter((s) => s.category === 'insert');
  const locations = [...new Set(principal.map((s) => s.location))];
  run([
    ...locations.flatMap((loc) => [
      ...orderPrincipal(principal.filter((s) => s.location === loc)),
      ...bySetup(inserts.filter((s) => s.location === loc)),
    ]),
    ...bySetup(inserts.filter((s) => !locations.includes(s.location))),
  ]);
  const field = bySetup(shots.filter((s) => s.category === 'field'));
  const here = (prev as Block | null)?.location;
  lunch(true); // field shots are always after lunch, and a day without them still has lunch
  run([...field.filter((b) => b.location === here), ...field.filter((b) => b.location !== here)]);

  rows.push({ kind: 'wrap', day, start: clock, end: clock + cfg.wrapMinutes });
  rows.push({ kind: 'end', day, start: clock + cfg.wrapMinutes });
  return rows;
}

/**
 * Orders shots day by day (ascending), joined by a day separator. `orders` holds the days the
 * user arranged by hand (by shooting day number); the others are ordered automatically.
 */
export function sequencePdr(shots: PdrShot[], cfg: PdrSettings, orders: Map<number, string[]> = new Map()): PdrRow[] {
  const days = [...new Set(shots.map((s) => s.day))].sort((a, b) => a - b);
  return days.flatMap((day, i) => [
    ...(i ? [{ kind: 'daySep' as const, day }] : []),
    ...sequenceDay(
      shots.filter((s) => s.day === day),
      cfg,
      day,
      orders.get(day),
    ),
  ]);
}

/**
 * The shots for the given dates, in stripboard order. A scene without a shot list stands in
 * as one shot: its synopsis, confirmed cast, and about an hour per page.
 */
export function pdrShots(p: Project, dates: string[]): PdrShot[] {
  const dayNumbers = shootDayNumbers(p.schedule);
  const sheets = new Map(p.sheets.map((s) => [s.id, s]));
  const elements = new Map(p.elements.map((e) => [e.id, e]));
  return dates.flatMap((date) =>
    (p.schedule.byDate[date] ?? []).flatMap((id): PdrShot[] => {
      const sheet = sheets.get(id);
      if (!sheet) return [];
      const day = dayNumbers.get(date) ?? 1;
      const own = p.shots.filter((s) => s.sheetId === id);
      if (own.length)
        return own.map((s) => ({ ...s, location: s.location || sheet.set || sheet.location, day, placeholder: false }));
      const cast = sheet.tags
        .filter((t) => t.state === 'confirmed' && elements.get(t.elementId)?.categoryId === 'cast')
        .map((t) => elements.get(t.elementId)!.name);
      return [
        {
          id: `scene-${sheet.id}`,
          sheetId: sheet.id,
          number: sheet.scenes,
          description: sheet.synopsis || sheet.heading,
          talent: cast,
          type: '' as const,
          movement: '',
          minutes: sheet.pages ? Math.max(p.pdr.shotMinutes, Math.round((sheet.pages / 8) * 60)) : null,
          keyShot: false,
          alerts: [],
          notes: '',
          category: 'principal' as const,
          location: sheet.set || sheet.location,
          setup: '',
          day,
          placeholder: true,
        },
      ];
    }),
  );
}
