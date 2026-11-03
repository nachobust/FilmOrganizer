import { describe, expect, it } from 'vitest';
import { DEFAULT_PDR, type ShotCategory, type ShotType } from './model';
import { fmtClock, sequencePdr, toMinutes, type PdrRow, type PdrShot } from './pdr';

let n = 0;
function shot(
  number: string,
  talent: string[],
  type: ShotType | '',
  o: { category?: ShotCategory; location?: string; setup?: string; day?: number; minutes?: number } = {},
): PdrShot {
  return {
    id: `s${n++}`,
    sheetId: 'x',
    number,
    description: '',
    talent,
    type,
    movement: '',
    minutes: o.minutes ?? 10,
    keyShot: false,
    alerts: [],
    notes: '',
    category: o.category ?? 'principal',
    location: o.location ?? 'Set A',
    setup: o.setup ?? '',
    day: o.day ?? 1,
    placeholder: false,
  };
}

const numbers = (rows: PdrRow[]) => rows.filter((r) => r.kind === 'shot').map((r) => r.shot!.number);
const kinds = (rows: PdrRow[]) => rows.map((r) => r.kind);

describe('sequencePdr: shot order', () => {
  it('full-cast masters lead, then each character closes in', () => {
    const rows = sequencePdr(
      [shot('01.C', ['A'], 'cu'), shot('01.A', ['A', 'B'], 'ws'), shot('01.B', ['A', 'B'], 'group'), shot('02.A', ['A'], 'ms')],
      DEFAULT_PDR,
    );
    const nums = numbers(rows);
    expect(nums.slice(0, 2)).toEqual(['01.A', '01.B']);
    expect(nums.indexOf('02.A')).toBeLessThan(nums.indexOf('01.C'));
  });

  it('finishes one character before starting the next', () => {
    const nums = numbers(
      sequencePdr(
        [shot('1.A', ['A'], 'cu'), shot('1.B', ['B'], 'ws'), shot('1.C', ['A'], 'ws'), shot('1.D', ['B'], 'cu')],
        DEFAULT_PDR,
      ),
    );
    expect(nums).toEqual(['1.C', '1.A', '1.B', '1.D']);
  });

  it('a single-cast shoot groups by setup, not by shot size', () => {
    const nums = numbers(
      sequencePdr(
        [
          shot('1', ['A'], 'cu', { setup: 'window' }),
          shot('2', ['A'], 'ws', { setup: 'door' }),
          shot('3', ['A'], 'ws', { setup: 'window' }),
        ],
        DEFAULT_PDR,
      ),
    );
    expect(nums).toEqual(['3', '1', '2']);
  });

  it('shoots out one location before moving to the next', () => {
    const rows = sequencePdr(
      [
        shot('1.A', ['A', 'B'], 'ws', { location: 'Porch' }),
        shot('1.B', ['A'], 'ms', { location: 'Porch' }),
        shot('2.A', ['A'], 'ws', { location: 'Kitchen' }),
        shot('1.C', ['B'], 'cu', { location: 'Porch' }),
      ],
      { ...DEFAULT_PDR, lunchAt: '23:00' },
    );
    expect(numbers(rows)).toEqual(['1.A', '1.B', '1.C', '2.A']);
    expect(rows.filter((r) => r.kind === 'move')).toHaveLength(1);
  });

  it('a oner leads its block like a master', () => {
    const nums = numbers(sequencePdr([shot('2', ['A'], 'ms'), shot('1', ['A'], 'oner')], DEFAULT_PDR));
    expect(nums[0]).toBe('1');
  });

  it('sorts shot numbers naturally', () => {
    const nums = numbers(sequencePdr([shot('10.A', ['A'], 'ms'), shot('2.A', ['A'], 'ms'), shot('1.B', ['A'], 'ms')], DEFAULT_PDR));
    expect(nums).toEqual(['1.B', '2.A', '10.A']);
  });
});

describe('sequencePdr: day structure', () => {
  it('builds call, prep, shots, lunch, wrap and end of day in order', () => {
    const rows = sequencePdr([shot('1', ['A'], 'ws')], DEFAULT_PDR);
    expect(kinds(rows)).toEqual(['call', 'prep', 'shot', 'lunch', 'wrap', 'end']);
    expect(rows[0].start).toBe(toMinutes('08:00'));
    expect(rows[2].start).toBe(toMinutes('10:00'));
  });

  it('a setup change is a reset and a location change is a company move, both taking time', () => {
    const rows = sequencePdr(
      [
        shot('1', ['A'], 'ws', { setup: 'one' }),
        shot('2', ['A'], 'ws', { setup: 'two' }),
        shot('3', ['A'], 'ws', { location: 'Set B' }),
      ],
      { ...DEFAULT_PDR, lunchAt: '23:00' },
    );
    const reset = rows.find((r) => r.kind === 'reset')!;
    const move = rows.find((r) => r.kind === 'move')!;
    expect(reset.end! - reset.start!).toBe(DEFAULT_PDR.resetMinutes);
    expect(move).toMatchObject({ from: 'Set A', to: 'Set B' });
    expect(move.end! - move.start!).toBe(DEFAULT_PDR.moveMinutes);
  });

  it('inserts come before lunch and field shots after it', () => {
    const rows = sequencePdr(
      [shot('F', [], 'insert', { category: 'field' }), shot('I', [], 'insert', { category: 'insert' }), shot('P', ['A'], 'ms')],
      DEFAULT_PDR,
    );
    const at = (k: string) => rows.findIndex((r) => r.shot?.number === k || r.kind === k);
    expect(at('P')).toBeLessThan(at('I'));
    expect(at('I')).toBeLessThan(at('lunch'));
    expect(at('lunch')).toBeLessThan(at('F'));
    const lunch = rows.find((r) => r.kind === 'lunch')!;
    expect(rows[at('F')].start).toBeGreaterThanOrEqual(lunch.end!);
  });

  it('lunch starts once the clock passes the lunch time, between blocks', () => {
    const rows = sequencePdr(
      Array.from({ length: 6 }, (_, i) => shot(`${i + 1}`, ['A'], 'ws', { setup: `s${i}`, minutes: 60 })),
      DEFAULT_PDR,
    );
    const lunch = rows.find((r) => r.kind === 'lunch')!;
    expect(lunch.start).toBeGreaterThanOrEqual(toMinutes('14:00'));
    expect(rows[rows.indexOf(lunch) + 1].kind).toBe('shot'); // no reset straight after lunch
  });

  it('keeps the company move when lunch falls on a location change', () => {
    const rows = sequencePdr(
      [shot('1', ['A'], 'ws', { location: 'Porch', minutes: 240 }), shot('2', ['A'], 'ws', { location: 'Street' })],
      DEFAULT_PDR,
    );
    expect(kinds(rows)).toEqual(['call', 'prep', 'shot', 'lunch', 'move', 'shot', 'wrap', 'end']);
    expect(rows.find((r) => r.kind === 'move')).toMatchObject({ from: 'Porch', to: 'Street' });
  });

  it('moves to field shots at another location after lunch', () => {
    const rows = sequencePdr(
      [shot('1', ['A'], 'ws', { location: 'Porch' }), shot('F', [], 'insert', { category: 'field', location: 'Street' })],
      DEFAULT_PDR,
    );
    expect(kinds(rows)).toEqual(['call', 'prep', 'shot', 'lunch', 'move', 'shot', 'wrap', 'end']);
  });

  it('shoots inserts at their location instead of moving the company back', () => {
    const rows = sequencePdr(
      [
        shot('1', ['A'], 'ws', { location: 'Porch' }),
        shot('2', [], 'insert', { category: 'insert', location: 'Porch' }),
        shot('3', ['A'], 'ws', { location: 'Kitchen' }),
        shot('4', [], 'insert', { category: 'insert', location: 'Kitchen' }),
      ],
      { ...DEFAULT_PDR, lunchAt: '23:00' },
    );
    expect(numbers(rows)).toEqual(['1', '2', '3', '4']);
    expect(rows.filter((r) => r.kind === 'move')).toHaveLength(1);
  });

  it('starts field shots where the company already is', () => {
    const rows = sequencePdr(
      [
        shot('1', ['A'], 'ws', { location: 'Porch' }),
        shot('F1', [], 'insert', { category: 'field', location: 'Street' }),
        shot('F2', [], 'insert', { category: 'field', location: 'Porch' }),
      ],
      DEFAULT_PDR,
    );
    expect(numbers(rows)).toEqual(['1', 'F2', 'F1']);
  });

  it('each day is timed on its own and days are joined by a separator', () => {
    const rows = sequencePdr([shot('2', ['A'], 'ws', { day: 2 }), shot('1', ['A'], 'ws', { day: 1 })], DEFAULT_PDR);
    expect(rows.filter((r) => r.kind === 'call').map((r) => r.start)).toEqual([480, 480]);
    expect(rows.findIndex((r) => r.kind === 'daySep')).toBe(rows.findIndex((r) => r.kind === 'end') + 1);
  });

  it('formats clock times', () => {
    expect(fmtClock(toMinutes('9:05'))).toBe('09:05');
    expect(fmtClock(24 * 60 + 30)).toBe('00:30');
  });
});

describe('sequencePdr: order set by hand', () => {
  const day = [
    shot('1', ['A'], 'ws', { setup: 'one', minutes: 30 }),
    shot('2', ['A'], 'cu', { setup: 'one', minutes: 30 }),
    shot('3', ['A'], 'ws', { location: 'Set B', minutes: 30 }),
  ];
  const cfg = { ...DEFAULT_PDR, lunchAt: '11:00' };

  it('keeps the order, adds moves, and puts lunch before the first shot after the lunch time', () => {
    const rows = sequencePdr(day, cfg, new Map([[1, [day[2].id, day[0].id, day[1].id]]]));
    expect(numbers(rows)).toEqual(['3', '1', '2']);
    expect(kinds(rows)).toEqual(['call', 'prep', 'shot', 'move', 'shot', 'lunch', 'shot', 'wrap', 'end']);
  });

  it('uses the minutes the user gave a company move', () => {
    const moved = [day[0], { ...day[2], gapMinutes: 5 }];
    const move = sequencePdr(moved, { ...cfg, lunchAt: '23:00' }).find((r) => r.kind === 'move')!;
    expect(move.end! - move.start!).toBe(5);
    expect(move.next?.number).toBe('3');
  });
});
