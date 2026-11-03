import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { loadAISettings, PROVIDERS, providerSettings, saveAISettings, type AISettings } from './ai';
import { AIRunModal, AISettingsModal, BriefModal } from './components/AIDialogs';
import BreakdownTable, { EXTRA_COLS, SCENE_COLS } from './components/BreakdownTable';
import PdrView, { type PdrDay } from './components/PdrView';
import ScheduleView, { type ScheduleNav } from './components/ScheduleView';
import SidePanel from './components/SidePanel';
import { UpdateBanner, UpdateSettingsModal } from './components/Updates';
import WhatsNewModal, { markWhatsNewSeen, shouldShowWhatsNew } from './components/WhatsNew';
import { exportJSON, exportPDF, exportXLSX } from './export';
import { importLegacyBoard, importScript, importScriptFile, NoScenesError, projectFromBrief } from './importers';
import {
  formatEighths,
  GROUP_LABELS,
  newProject,
  shootDayNumbers,
  toISO,
  type CategoryGroup,
  type Project,
} from './model';
import { askConfirm, isDesktop } from './platform';
import { checkForUpdate, loadUpdateSettings, saveUpdateSettings } from './updates';
import { runRules } from './rules';
import { attachShotList, projectFromShotList, readShotListFile, SHOT_LIST_ACCEPT } from './shots';
import { loadSaved, reducer, saveProject, validateProject } from './store';

type ColumnGroup = CategoryGroup | 'extra';
type Tab = 'breakdown' | 'schedule' | 'pdr';
type AIDialog =
  | null
  /** `back` reopens the dialog the settings were opened from. */
  | { kind: 'settings'; back?: AIDialog }
  | { kind: 'run'; sheetIds: string[] }
  | { kind: 'brief'; title: string; text: string };
const TOGGLES: [ColumnGroup, string][] = [
  ...(Object.entries(GROUP_LABELS) as [CategoryGroup, string][]),
  ['extra', 'Extra fields'],
];
const SAMPLE = 'samples/The Lighthouse Keeper.fdx';

/** Opens the schedule on the first shooting day, or today when nothing is scheduled. */
const initialNav = (p: Project): ScheduleNav => ({
  mode: 'month',
  date: [...shootDayNumbers(p.schedule).keys()][0] ?? toISO(new Date()),
});

export default function App() {
  const [project, dispatch] = useReducer(reducer, undefined, () => loadSaved() ?? newProject('Untitled'));
  const [tab, setTab] = useState<Tab>('breakdown');
  const [nav, setNav] = useState<ScheduleNav>(() => initialNav(project));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visible, setVisible] = useState<Set<ColumnGroup>>(new Set(['cast', 'people', 'art', 'camera', 'other']));
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [aiSettings, setAISettings] = useState<AISettings>(loadAISettings);
  const [aiDialog, setAIDialog] = useState<AIDialog>(null);
  const [pdrDay, setPdrDay] = useState<PdrDay | null>(null);
  const [whatsNew, setWhatsNew] = useState(() => shouldShowWhatsNew(loadSaved() !== null));
  const closeWhatsNew = () => {
    markWhatsNewSeen();
    setWhatsNew(false);
  };
  // Update check: desktop app only (the browser version is always current), and only if turned on.
  const [updateCheck, setUpdateCheck] = useState(() => loadUpdateSettings().enabled);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const toggleUpdateCheck = (on: boolean) => {
    saveUpdateSettings({ enabled: on });
    setUpdateCheck(on);
    if (on) void checkForUpdate().then(setNewVersion);
  };
  useEffect(() => {
    if (isDesktop) void checkForUpdate().then(setNewVersion);
  }, []);
  const scriptInput = useRef<HTMLInputElement>(null);
  const shotListInput = useRef<HTMLInputElement>(null);
  /** The shooting date the shot list file picker is open for; null = a new project. */
  const shotListDate = useRef<string | null>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const suggestMenu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setSaveFailed(!saveProject(project)), 300);
    return () => clearTimeout(t);
  }, [project]);

  const elMap = useMemo(() => new Map(project.elements.map((e) => [e.id, e])), [project.elements]);
  const fieldCols = visible.has('extra') ? [...SCENE_COLS, ...EXTRA_COLS] : SCENE_COLS;
  const categories = project.categories.filter((c) => visible.has(c.group));

  const sheets = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return project.sheets;
    return project.sheets.filter(
      (s) =>
        [s.scenes, s.set, s.synopsis, s.location, s.intExt, s.dayNight].some((v) => v.toLowerCase().includes(q)) ||
        s.tags.some((t) => elMap.get(t.elementId)?.name.toLowerCase().includes(q)),
    );
  }, [project.sheets, filter, elMap]);

  const stats = useMemo(() => {
    let eighths = 0;
    let pending = 0;
    let reviewed = 0;
    for (const s of project.sheets) {
      eighths += s.pages;
      pending += s.tags.filter((t) => t.state === 'suggested').length;
      if (s.reviewed) reviewed++;
    }
    const scheduled = new Set(Object.values(project.schedule.byDate).flat()).size;
    return { eighths, pending, reviewed, scheduled, days: shootDayNumbers(project.schedule).size };
  }, [project.sheets, project.schedule]);

  const replaceProject = useCallback(
    async (next: Project, confirmText = 'Replace the current project? Export it first if you want to keep it.') => {
      if (project.sheets.length && !(await askConfirm(confirmText))) return false;
      dispatch({ type: 'load', project: next });
      setSelectedId(next.sheets[0]?.id ?? null);
      setNav(initialNav(next));
      setError('');
      return true;
    },
    [project.sheets.length],
  );

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const openScript = async (file: File) => {
    try {
      if (await replaceProject(await importScriptFile(file))) setTab('breakdown');
    } catch (e) {
      // No scene headings: offer to read the file as a creative brief instead.
      if (e instanceof NoScenesError) setAIDialog({ kind: 'brief', title: e.title, text: e.text });
      else fail(e);
    }
  };

  const pickShotList = (date: string | null) => {
    shotListDate.current = date;
    shotListInput.current?.click();
  };

  /** A shot list starts a new project, or (with a date) fills in that shooting day and opens its shooting plan. */
  const openShotList = async (file: File, date: string | null) => {
    try {
      const shots = await readShotListFile(file);
      const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
      if (date === null) {
        // A shot list is a shoot: it opens as that day's shooting plan, dated today until the user sets the date.
        const next = projectFromShotList(file.name.replace(/\.[^.]+$/, ''), shots, toISO(new Date()));
        if (!(await replaceProject(next))) return;
        const days = [...shootDayNumbers(next.schedule).keys()];
        setPdrDay(days[0] ?? null);
        setTab('pdr');
        setNotice(
          `Imported ${plural(shots.length, 'shot')} as ${days.length > 1 ? `${days.length} shooting days` : 'a shooting day'}. Set the real shoot date in "Shoot date" above the plan.`,
        );
        return;
      }
      const { project: next, matched, created } = attachShotList(project, shots, date);
      dispatch({ type: 'load', project: next });
      setPdrDay(date);
      setTab('pdr');
      setError('');
      setNotice(
        `Added ${plural(shots.length, 'shot')} to this day: ${[
          matched && `${plural(matched, 'scene')} matched by number or set`,
          created && `${plural(created, 'new scene')}`,
        ]
          .filter(Boolean)
          .join(', ')}.`,
      );
    } catch (e) {
      fail(e);
    }
  };

  /** Opens a FilmOrganizer project, or merges an export from the standalone strip board. */
  const openProject = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const p = validateProject(data);
      if (p) return void (await replaceProject(p));
      const imported = importLegacyBoard(project, data);
      if (!imported) throw new Error('This is not a FilmOrganizer project or strip board file.');
      const merged =
        project.sheets.length === 0 && project.title === 'Untitled'
          ? { ...imported, title: file.name.replace(/\.json$/i, '').replace(/[-_]+/g, ' ') }
          : imported;
      if (
        stats.scheduled &&
        !(await askConfirm('Load this strip board? It replaces the current schedule; scenes are matched by number.'))
      )
        return;
      dispatch({ type: 'load', project: merged });
      setNav({ ...initialNav(merged), mode: 'week' });
      setTab('schedule');
      setError('');
    } catch (e) {
      fail(e);
    }
  };

  /** A file dropped anywhere on the window: a project opens, a shot list or script is imported. */
  const openDropped = (file: File) => {
    if (/\.json$/i.test(file.name)) return void openProject(file);
    if (/\.(xlsx|xlsm|tsv)$/i.test(file.name)) return void openShotList(file, null);
    if (/\.(pdf|docx|fdx|fountain|txt|md)$/i.test(file.name)) return void openScript(file);
    setError(`“${file.name}” can't be opened here. Drop a project (.json), a shot list (.xlsx) or a script (.pdf, .docx, .fdx, .fountain, .txt).`);
  };
  const dropRef = useRef(openDropped);
  dropRef.current = openDropped;
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    // Only files from outside count; dragging rows and strips inside the app carries no files.
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDropping(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDropping(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDropping(false);
      const file = e.dataTransfer!.files[0];
      if (file) dropRef.current(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const loadSample = async () => {
    try {
      const res = await fetch(encodeURI(SAMPLE));
      await replaceProject(importScript(SAMPLE.split('/').pop()!, await res.text()));
    } catch (e) {
      fail(e);
    }
  };

  const runExport = async (label: string, fn: (p: Project) => void | Promise<void>) => {
    exportMenu.current?.removeAttribute('open');
    setBusy(`Exporting ${label}…`);
    try {
      await fn(project);
    } catch (e) {
      fail(e);
    } finally {
      setBusy('');
    }
  };

  /** Offline rule-based breakdown; only adds suggestions, never changes what the user tagged. */
  const runRuleBreakdown = (sheetIds?: string[]) => {
    suggestMenu.current?.removeAttribute('open');
    const { project: next, added, scenes } = runRules(project, sheetIds);
    dispatch({ type: 'load', project: next });
    setNotice(
      added
        ? `Rules added ${added} suggestion${added === 1 ? '' : 's'} in ${scenes} scene${scenes === 1 ? '' : 's'}. Accept or reject them in the table.`
        : 'Rules found nothing new. Elements already tagged or rejected are not suggested again.',
    );
  };

  const openAI = (sheetIds: string[]) => {
    suggestMenu.current?.removeAttribute('open');
    setAIDialog({ kind: 'run', sheetIds });
  };

  const aiLabel = aiSettings.provider
    ? `${PROVIDERS[aiSettings.provider].label.replace(/ \(.*\)$/, '')} · ${providerSettings(aiSettings, aiSettings.provider).model || 'no model'}`
    : 'off';

  const toggle = (g: ColumnGroup) =>
    setVisible((v) => {
      const next = new Set(v);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const selected = project.sheets.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="app">
      {dropping && (
        <div className="drop-overlay" aria-hidden>
          <div>
            <b>Drop to open</b>
            <span>A project (.json), a shot list (.xlsx) or a script (.pdf, .docx, .fdx, .fountain, .txt)</span>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="brand">FilmOrganizer</div>
        <input
          className="title-input"
          value={project.title}
          onChange={(e) => dispatch({ type: 'setTitle', title: e.target.value })}
          aria-label="Project title"
        />
        <nav className="view-tabs">
          <button className={tab === 'breakdown' ? 'active' : ''} onClick={() => setTab('breakdown')}>
            Breakdown
          </button>
          <button className={tab === 'schedule' ? 'active' : ''} onClick={() => setTab('schedule')}>
            Schedule
          </button>
          <button className={tab === 'pdr' ? 'active' : ''} onClick={() => setTab('pdr')} title="Shooting plan per day">
            Shooting plan
          </button>
        </nav>
        <span className="spacer" />
        {busy && <span className="muted">{busy}</span>}
        <button className="primary" onClick={() => scriptInput.current?.click()}>
          Import script
        </button>
        <button onClick={() => pickShotList(null)} title="Excel, Word table or tab-separated text">
          Import shot list
        </button>
        <button
          onClick={() => projectInput.current?.click()}
          title="A FilmOrganizer project or strip board (.json), or a script or brief"
        >
          Open…
        </button>
        <details className="menu" ref={exportMenu}>
          <summary>Export ▾</summary>
          <div className="menu-items">
            <button onClick={() => runExport('Excel', exportXLSX)} disabled={!project.sheets.length}>
              Excel workbook <span className="muted">.xlsx</span>
            </button>
            <button onClick={() => runExport('PDF', exportPDF)} disabled={!project.sheets.length}>
              PDF breakdown, calendar & stripboard <span className="muted">.pdf</span>
            </button>
            <button onClick={() => runExport('project', exportJSON)}>
              Project file <span className="muted">.json</span>
            </button>
          </div>
        </details>
        <button onClick={() => replaceProject(newProject('Untitled'))}>New</button>
        <input
          ref={scriptInput}
          type="file"
          accept=".pdf,.docx,.fdx,.fountain,.txt,.md"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void openScript(f);
          }}
        />
        <input
          ref={shotListInput}
          type="file"
          accept={SHOT_LIST_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void openShotList(f, shotListDate.current);
          }}
        />
        <input
          ref={projectInput}
          type="file"
          accept=".json,.pdf,.docx,.fdx,.fountain,.txt,.md"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            // Projects open as they are; scripts and briefs go through the same import as Import script.
            if (f) void (/\.json$/i.test(f.name) ? openProject(f) : openScript(f));
          }}
        />
      </header>

      {tab === 'breakdown' && (
        <div className="toolbar">
          <input className="search" placeholder="Filter scenes or elements…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="toggles">
            {TOGGLES.map(([g, label]) => (
              <button key={g} className={`pill ${visible.has(g) ? 'on' : ''}`} onClick={() => toggle(g)}>
                {label}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <details className="menu" ref={suggestMenu}>
            <summary>Suggest elements ▾</summary>
            <div className="menu-items">
              <div className="menu-label">Rules · offline, instant</div>
              <button onClick={() => runRuleBreakdown()} disabled={!project.sheets.length}>
                All scenes
              </button>
              <button onClick={() => runRuleBreakdown([selectedId!])} disabled={!selectedId}>
                Selected scene
              </button>
              <div className="menu-label">AI · {aiLabel}</div>
              <button onClick={() => openAI(project.sheets.map((s) => s.id))} disabled={!project.sheets.length}>
                All scenes…
              </button>
              <button onClick={() => openAI([selectedId!])} disabled={!selectedId}>
                Selected scene…
              </button>
              <button
                onClick={() => {
                  suggestMenu.current?.removeAttribute('open');
                  setAIDialog({ kind: 'settings' });
                }}
              >
                AI settings…
              </button>
            </div>
          </details>
          <button onClick={() => dispatch({ type: 'addSheet', afterId: selectedId ?? undefined })}>+ Add scene</button>
          {stats.pending > 0 && (
            <button
              onClick={async () =>
                (await askConfirm(`Accept all ${stats.pending} suggestions in every scene?`)) && dispatch({ type: 'acceptAll' })
              }
            >
              Accept all suggestions
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="error" role="alert">
          {error}{' '}
          <button className="ghost" onClick={() => setError('')}>
            ✕
          </button>
        </div>
      )}

      {saveFailed && (
        <div className="error" role="alert">
          Your latest changes are not saved: there is no room left to store this project on this computer. Export the
          project file now to keep them.{' '}
          <button className="primary" onClick={() => runExport('project', exportJSON)}>
            Export project file
          </button>
        </div>
      )}

      {newVersion && <UpdateBanner version={newVersion} onClose={() => setNewVersion(null)} />}

      {notice && (
        <div className="notice" role="status">
          {notice}{' '}
          <button className="ghost" onClick={() => setNotice('')}>
            ✕
          </button>
        </div>
      )}

      <main className="main">
        {tab === 'pdr' ? (
          <PdrView
            project={project}
            day={pdrDay}
            setDay={setPdrDay}
            dispatch={dispatch}
            onUploadForDay={pickShotList}
            onError={fail}
            onGoToSchedule={() => setTab('schedule')}
            onImportShotList={() => pickShotList(null)}
          />
        ) : tab === 'schedule' ? (
          <ScheduleView
            project={project}
            nav={nav}
            setNav={setNav}
            dispatch={dispatch}
            elMap={elMap}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpenInBreakdown={(id) => {
              setSelectedId(id);
              setTab('breakdown');
            }}
            onOpenPdr={(date) => {
              // A day without any shots asks for its shot list first; otherwise straight to its shooting plan.
              const ids = new Set(project.schedule.byDate[date] ?? []);
              if (!project.shots.some((s) => ids.has(s.sheetId))) return pickShotList(date);
              setPdrDay(date);
              setTab('pdr');
            }}
          />
        ) : (
          <>
            {project.sheets.length === 0 ? (
              <div className="empty">
                <h2>Start a breakdown</h2>
                <p>Import a screenplay (PDF, Word .docx, Final Draft .fdx, Fountain or plain text) and every scene becomes a row you can break down. A creative brief or treatment without scene headings can be broken down into scenes with AI.</p>
                <p>Already have a shot list? Import it instead (Excel, or a table in Word or text): it opens straight as a timed shooting plan you can edit and export to Excel.</p>
                <div className="empty-actions">
                  <button className="primary" onClick={() => scriptInput.current?.click()}>
                    Import script
                  </button>
                  <button className="primary" onClick={() => pickShotList(null)}>
                    Import shot list
                  </button>
                  <button onClick={loadSample}>Load sample script</button>
                  <button onClick={() => dispatch({ type: 'addSheet' })}>Start with a blank scene</button>
                </div>
              </div>
            ) : (
              <BreakdownTable
                sheets={sheets}
                fieldCols={fieldCols}
                categories={categories}
                elMap={elMap}
                selectedId={selectedId}
                dispatch={dispatch}
                onSelect={setSelectedId}
              />
            )}
            <SidePanel project={project} sheet={selected} elMap={elMap} dispatch={dispatch} onSelect={setSelectedId} />
          </>
        )}
      </main>

      <footer className="statusbar">
        <span>{project.sheets.length} scenes</span>
        <span>{formatEighths(stats.eighths) || '0'} pages</span>
        <span>
          {stats.reviewed}/{project.sheets.length} reviewed
        </span>
        <span className={stats.pending ? 'warn' : ''}>{stats.pending} suggestions pending</span>
        <span>
          {stats.scheduled}/{project.sheets.length} scheduled · {stats.days} shooting days
        </span>
        <span className="spacer" />
        <button className="link" onClick={() => setWhatsNew(true)}>
          What's new
        </button>
        {isDesktop && (
          <button className="link" onClick={() => setUpdatesOpen(true)} title="Optional check for new versions">
            Updates: {updateCheck ? 'on' : 'off'}
          </button>
        )}
        <button className="link" onClick={() => setAIDialog({ kind: 'settings' })} title="AI settings">
          AI: {aiLabel}
        </button>
        {saveFailed ? (
          <span className="warn">Not saved: export the project file</span>
        ) : (
          <span className="muted">Saved in this browser automatically</span>
        )}
      </footer>

      {updatesOpen && (
        <UpdateSettingsModal
          enabled={updateCheck}
          onChange={toggleUpdateCheck}
          onFound={setNewVersion}
          onClose={() => setUpdatesOpen(false)}
        />
      )}
      {whatsNew && (
        <WhatsNewModal
          updateCheck={isDesktop ? { on: updateCheck, set: toggleUpdateCheck } : undefined}
          onClose={closeWhatsNew}
          onTry={() => {
            closeWhatsNew();
            setTab('pdr');
          }}
        />
      )}
      {aiDialog?.kind === 'settings' && (
        <AISettingsModal
          settings={aiSettings}
          onSave={(s) => {
            setAISettings(s);
            saveAISettings(s);
          }}
          onClose={() => setAIDialog(aiDialog.back ?? null)}
        />
      )}
      {aiDialog?.kind === 'brief' && (
        <BriefModal
          title={aiDialog.title}
          text={aiDialog.text}
          settings={aiSettings}
          onDone={async (scenes, by) => {
            if (!(await replaceProject(projectFromBrief(aiDialog.title, scenes, by)))) return;
            setAIDialog(null);
            setTab('breakdown');
            setNotice(
              `AI proposed ${scenes.length} scene${scenes.length === 1 ? '' : 's'} from “${aiDialog.title}”. Review each row: characters, key shots and risks are suggestions to accept or reject.`,
            );
          }}
          onOpenSettings={() => setAIDialog({ kind: 'settings', back: aiDialog })}
          onClose={() => setAIDialog(null)}
        />
      )}
      {aiDialog?.kind === 'run' && (
        <AIRunModal
          project={project}
          sheetIds={aiDialog.sheetIds}
          settings={aiSettings}
          onSuggestions={(items) => dispatch({ type: 'addSuggestions', source: 'ai', items })}
          onOpenSettings={() => setAIDialog({ kind: 'settings', back: aiDialog })}
          onClose={() => setAIDialog(null)}
        />
      )}

      <datalist id="dl-intext">
        {['INT', 'EXT', 'INT/EXT'].map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="dl-daynight">
        {['DAY', 'AFTERNOON', 'NIGHT', 'DAWN', 'DUSK', 'MORNING', 'EVENING', 'CONTINUOUS', 'LATER'].map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      {project.categories.map((c) => (
        <datalist key={c.id} id={`dl-${c.id}`}>
          {project.elements
            .filter((e) => e.categoryId === c.id)
            .map((e) => (
              <option key={e.id} value={e.name} />
            ))}
        </datalist>
      ))}
    </div>
  );
}
