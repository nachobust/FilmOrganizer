import { afterEach, describe, expect, it, vi } from 'vitest';
import { newProject, newSheet, type Project } from './model';
import { historyReducer, initHistory, loadSaved, reducer, saveProject, validateProject } from './store';

function projectWithSheet(): { p: Project; sheetId: string } {
  const sheet = newSheet({ sheetNumber: '1' });
  return { p: { ...newProject('Test'), sheets: [sheet] }, sheetId: sheet.id };
}

const tagsOf = (p: Project, sheetId: string) => p.sheets.find((s) => s.id === sheetId)!.tags;
const elementId = (p: Project, name: string) => p.elements.find((e) => e.name === name)!.id;

describe('reducer: suggestions and tags', () => {
  it('a suggestion never downgrades a confirmed tag', () => {
    const { p, sheetId } = projectWithSheet();
    const confirmed = reducer(p, { type: 'addTag', sheetId, categoryId: 'props', name: 'Lantern' });
    const after = reducer(confirmed, {
      type: 'addSuggestions',
      source: 'ai',
      items: [{ sheetId, categoryId: 'props', name: 'lantern' }],
    });
    expect(tagsOf(after, sheetId)).toHaveLength(1);
    expect(tagsOf(after, sheetId)[0].state).toBe('confirmed');
  });

  it('a rejected element is never suggested again for that sheet', () => {
    const { p, sheetId } = projectWithSheet();
    const suggested = reducer(p, {
      type: 'addSuggestions',
      source: 'rules',
      items: [{ sheetId, categoryId: 'props', name: 'Rope' }],
    });
    const rejected = reducer(suggested, { type: 'rejectTag', sheetId, elementId: elementId(suggested, 'Rope') });
    const again = reducer(rejected, {
      type: 'addSuggestions',
      source: 'ai',
      items: [{ sheetId, categoryId: 'props', name: 'Rope' }],
    });
    expect(tagsOf(again, sheetId)).toHaveLength(0);
  });

  it('the user can still add an element they rejected earlier, which clears the rejection', () => {
    const { p, sheetId } = projectWithSheet();
    const suggested = reducer(p, {
      type: 'addSuggestions',
      source: 'rules',
      items: [{ sheetId, categoryId: 'props', name: 'Rope' }],
    });
    const rejected = reducer(suggested, { type: 'rejectTag', sheetId, elementId: elementId(suggested, 'Rope') });
    const added = reducer(rejected, { type: 'addTag', sheetId, categoryId: 'props', name: 'Rope' });
    const sheet = added.sheets[0];
    expect(sheet.tags.map((t) => t.state)).toEqual(['confirmed']);
    expect(sheet.rejected).toHaveLength(0);
  });

  it('renaming an element onto its twin merges them without duplicate tags', () => {
    const { p, sheetId } = projectWithSheet();
    let q = reducer(p, { type: 'addTag', sheetId, categoryId: 'props', name: 'Lamp' });
    q = reducer(q, { type: 'addTag', sheetId, categoryId: 'props', name: 'Lantern' });
    q = reducer(q, { type: 'renameElement', elementId: elementId(q, 'Lamp'), name: 'lantern' });
    expect(q.elements.filter((e) => e.categoryId === 'props').map((e) => e.name)).toEqual(['Lantern']);
    expect(tagsOf(q, sheetId)).toHaveLength(1);
  });

  it('cast names are stored in capitals and numbered in order', () => {
    const { p, sheetId } = projectWithSheet();
    let q = reducer(p, { type: 'addTag', sheetId, categoryId: 'cast', name: 'marta' });
    q = reducer(q, { type: 'addTag', sheetId, categoryId: 'cast', name: 'tomás' });
    expect(q.elements.map((e) => [e.name, e.castId])).toEqual([
      ['MARTA', 1],
      ['TOMÁS', 2],
    ]);
  });
});

describe('reducer: schedule', () => {
  it('moving a strip removes it from its old day', () => {
    const { p, sheetId } = projectWithSheet();
    let q = reducer(p, { type: 'moveStrip', sheetId, date: '2026-11-23' });
    q = reducer(q, { type: 'moveStrip', sheetId, date: '2026-11-24' });
    expect(q.schedule.byDate).toEqual({ '2026-11-24': [sheetId] });
  });

  it('deleting a sheet takes it off the schedule', () => {
    const { p, sheetId } = projectWithSheet();
    const q = reducer(reducer(p, { type: 'moveStrip', sheetId, date: '2026-11-23' }), { type: 'deleteSheet', id: sheetId });
    expect(q.schedule.byDate).toEqual({});
  });
});

describe('saving', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeStorage(limit: number) {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > limit) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        data.set(k, v);
      },
    };
  }

  it('reports a failed save and keeps the last good one', () => {
    vi.stubGlobal('localStorage', fakeStorage(20_000));
    const small = newProject('Small');
    expect(saveProject(small)).toBe(true);

    const big = { ...small, sheets: [newSheet({ synopsis: 'x'.repeat(50_000) })] };
    expect(saveProject(big)).toBe(false);
    expect(loadSaved()?.title).toBe('Small');
  });
});

describe('validateProject', () => {
  it('rejects things that are not a project', () => {
    for (const bad of [null, undefined, 42, 'text', [], {}, { version: 2, sheets: [], elements: [], categories: [] }])
      expect(validateProject(bad)).toBeNull();
  });

  it('survives a damaged file: drops bad entries and fills defaults', () => {
    const { p, sheetId } = projectWithSheet();
    const withTag = reducer(p, { type: 'addTag', sheetId, categoryId: 'props', name: 'Lantern' });
    const damaged = JSON.parse(JSON.stringify(withTag));
    damaged.title = 123;
    damaged.elements.push({ id: 'x', name: 'Ghost', categoryId: 'no-such-category' }, null, 'junk');
    damaged.sheets.push('junk', { pages: -5, script: 'not a list', tags: [{ elementId: 'missing' }] });
    damaged.sheets[0].tags.push({ elementId: 'missing', state: 'confirmed' });
    damaged.schedule = { byDate: { 'not-a-date': [sheetId], '2026-11-23': [sheetId, 'gone'] } };

    const q = validateProject(damaged)!;
    expect(q).not.toBeNull();
    expect(q.title).toBe('Untitled');
    expect(q.elements.map((e) => e.name)).toEqual(['Lantern']);
    expect(q.sheets).toHaveLength(2);
    expect(q.sheets[0].tags).toHaveLength(1);
    expect(q.sheets[1].pages).toBe(0);
    expect(q.sheets[1].script).toEqual([]);
    expect(q.sheets[1].tags).toEqual([]);
    expect(q.schedule.byDate).toEqual({ '2026-11-23': [sheetId] });
  });

  it('keeps a valid project as it was', () => {
    const { p, sheetId } = projectWithSheet();
    const q = reducer(reducer(p, { type: 'addTag', sheetId, categoryId: 'cast', name: 'Marta' }), {
      type: 'moveStrip',
      sheetId,
      date: '2026-11-23',
    });
    expect(validateProject(JSON.parse(JSON.stringify(q)))).toEqual(q);
  });
});

describe('undo and redo', () => {
  it('undoes and redoes changes, and a new change clears what could be redone', () => {
    let h = initHistory(newProject('A'));
    h = historyReducer(h, { type: 'toggleDayOff', date: '2026-11-20' }, 1000);
    h = historyReducer(h, { type: 'addSheet' }, 5000);
    expect(h.present.sheets).toHaveLength(1);
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.sheets).toHaveLength(0);
    expect(h.present.daysOff).toEqual(['2026-11-20']);
    h = historyReducer(h, { type: 'redo' });
    expect(h.present.sheets).toHaveLength(1);
    h = historyReducer(h, { type: 'undo' });
    h = historyReducer(h, { type: 'setTitle', title: 'B' }, 9000);
    expect(h.future).toHaveLength(0);
  });

  it('counts quick typing in one field as one step', () => {
    let h = initHistory(newProject('A'));
    h = historyReducer(h, { type: 'setTitle', title: 'Ne' }, 1000);
    h = historyReducer(h, { type: 'setTitle', title: 'New' }, 1300);
    h = historyReducer(h, { type: 'setTitle', title: 'New film' }, 1600);
    expect(h.past).toHaveLength(1);
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.title).toBe('A');
  });
});
