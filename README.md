# FilmOrganizer

**FilmOrganizer** is a free, open-source script breakdown and shooting schedule app for film, TV, commercials and branded content. Import a screenplay (PDF, Word, Final Draft or Fountain), get a scene-by-scene breakdown of cast, props, wardrobe, vehicles and locations, then plan the shoot on a stripboard and a calendar. It runs offline on Windows, macOS and Linux, with no account.

**Website:** https://filmorganizer.vercel.app

![FilmOrganizer stripboard: scenes as coloured strips dragged onto shooting days](site/img/stripboard.png)

## Download

Get the installer for your computer from the [latest release](https://github.com/nachobust/FilmOrganizer/releases/latest). It's free and runs offline.

| System | File |
|---|---|
| Windows | `.msi` or `-setup.exe` |
| macOS (Apple Silicon and Intel) | `.dmg` |
| Linux | `.AppImage` (any distribution) or `.deb` (Debian / Ubuntu) |

The installers are not code-signed yet, so the first launch shows a warning:

- **Windows** — "Windows protected your PC": click **More info → Run anyway**.
- **macOS** — the app is blocked the first time: open **System Settings → Privacy & Security** and click **Open Anyway** next to FilmOrganizer.
- **Linux (AppImage)** — make the file executable (right-click → Properties → Allow executing as program, or `chmod +x`), then open it.

This is needed only once.

## Features

- **Breakdown table** — every scene is a row (sheet, scene, I/E, set, day/night, pages in eighths, synopsis, script day, location, …) with one column per breakdown category (cast, background, props, wardrobe, vehicles, effects, …). Elements are added as tags; cast members get ID numbers automatically.
- **Script import** — PDF, Word (`.docx`), Final Draft (`.fdx`), Fountain and plain-text screenplays. PDFs are read from the page layout (headings, action, character cues and dialogue sit at standard indents) and scene lengths are measured from the page in eighths; Word files use screenplay paragraph styles, indents, or plain screenplay conventions. Speaking characters are suggested as cast.
- **Rule-based breakdown (offline)** — runs automatically on import and from **Suggest elements**: finds characters (including ones introduced in capitals with an age), props, vehicles, animals, wardrobe, makeup, effects, sound, music and camera needs from keyword lists in English and Spanish; flags production risks (night exteriors, dawn/dusk light, minors, water, weapons, crowds, long scenes); estimates story days; and spreads any element you confirm to every other scene that mentions it. No internet or AI needed, and the same script always gives the same result.
- **AI breakdown (optional)** — plug in Claude, ChatGPT, Gemini, a local model (Ollama, LM Studio — works offline) or any OpenAI-compatible service with your own key (**Suggest elements → AI settings**). It adds what rules can't infer, such as implied props. Keys are stored only in this browser.
- **Creative briefs (with AI)** — a brief, treatment or script without scene headings (PDF, Word or text) can be broken down by the AI into proposed scenes: locations, Int/Ext, Day/Night, characters, key shots and production risks. The scenes arrive as rows to review, and the rule-based breakdown then runs on them. Needs an AI provider; scripts with scene headings never do.
- **Suggestions** — imported, rule and AI elements arrive as suggestions you accept or reject; hover a chip to see what produced it and the script line behind it. Your own edits always win, and rejected elements are never suggested again.
- **Schedule** — month calendar with month/year navigation; click any day to open that week's drag-and-drop stripboard with an Unscheduled pool and per-day page totals.
- **Shot lists** — import a shot list (Excel, or a table in Word or plain text; English or Spanish column names) to start a project from it, or add one to any shooting day from its column on the stripboard. Shots are grouped into scenes and their talent becomes cast.
- **PDR (shooting plan)** — each shooting day becomes a timed plan: call, prep, one location at a time, full-cast masters first then each character closing in, inserts before lunch, field and product shots after, with resets and company moves timed. Change a shot's size, category or minutes and the day re-times itself. Export it as Excel, or into your own PDR template, with English or Spanish labels.
- **Export** — PDF with the breakdown, calendar and stripboard, each starting on its own page; an Excel workbook with the same three as separate tabs (plus an Elements tab); and a JSON project file.

Projects are saved automatically (in the app, or in the browser for the web version); use **Export → Project file** to keep a copy.

The app sends nothing over the internet unless you use an online AI provider, or turn on the desktop app's optional update check (**Updates** in the status bar, off by default), which asks GitHub for the latest version number once a day.

## Run locally

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Use **Load sample script** to try it with the included sample screenplay.

## Build

```bash
npm run build
```

## Desktop app

The desktop app wraps the same code with [Tauri](https://tauri.app). To run or build it locally you also need [Rust](https://www.rust-lang.org/tools/install) and Tauri's [system prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm run tauri dev     # run the desktop app with live reload
npm run tauri build   # build an installer for this computer
```

### Releasing

Installers for every system are built by GitHub Actions (`.github/workflows/release.yml`), free on public repositories:

1. Update `version` in `package.json`. If the release has news for existing users, update `WHATS_NEW` in `src/components/WhatsNew.tsx`: they see it once after updating.
2. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`.
3. When the workflow finishes, a draft release with all installers appears under **Releases**. Review it and press **Publish**.

To test a build without making a release, open the **Actions** tab, choose **Release → Run workflow**; the installers are attached to the run as artifacts.

### Website

The website is plain HTML and CSS in `site/`, hosted on Vercel, which redeploys it on every push to `main`. Preview it locally with `python -m http.server --directory site`.

## License

[MIT](LICENSE) © 2026 nachobust

FilmOrganizer uses open-source libraries under their own licences (MIT, Apache-2.0, ISC, BSD and similar). Every installer includes `THIRD-PARTY-NOTICES.txt` with each one's licence text; `npm run notices` regenerates it.
