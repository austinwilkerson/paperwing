# Building, testing and releasing Paperwing

## Repository layout

Paperwing is a fork of [BentoPDF](https://github.com/alam00000/bentopdf) that keeps the engine
untouched and adds three layers on top:

| Path                     | What it is                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`, `public/`, …     | **BentoPDF engine** — the 100+ tool pages and their logic (upstream code)                                                                    |
| `app.html`, `src/acro/`  | **Paperwing workspace** — tabs, Home, All tools, document view, shortcuts, preferences                                                       |
| `src/reskin/`, `reskin/` | **Integration layer** — Acrobat-style light/dark theme for every tool page, frame embedding, a Vite plugin that injects it all at build time |
| `desktop/`               | **Electron app** — window, `app://` protocol, file associations, native dialogs, packaging                                                   |

The only upstream source file that Paperwing modifies is `vite.config.ts` (two lines registering
`reskin/vite-plugin-reskin.ts`). This keeps merging new BentoPDF releases easy.

## Prerequisites

- Node.js **22** or newer and npm
- Windows 10/11 or macOS 12+ (Linux works for development; AppImage packaging is configured but untested)
- Google Chrome or Chromium for the end-to-end tests

```bash
npm ci                 # in the repository root (engine)
cd desktop && npm ci   # desktop shell
```

## Running

| Command (in `desktop/`) | What it does                                          |
| ----------------------- | ----------------------------------------------------- |
| `npm run dev`           | Build the web app into `../dist` and launch Paperwing |
| `npm start`             | Launch Paperwing using the existing `../dist` build   |
| `npm run build:web`     | Build only the web app (Vite, simple mode)            |

For fast UI work you can also run the Vite dev server from the repository root and open the
workspace in a browser:

```bash
SIMPLE_MODE=true npx vite          # then open http://localhost:5173/app.html
```

(On Windows `cmd`: `set SIMPLE_MODE=true && npx vite`.) In a browser, files open through the File
System Access API instead of native dialogs; everything else behaves the same.

## Testing

```bash
npx vitest run                         # unit tests (engine + src/tests/paperwing-shell.test.ts)
npx tsc --noEmit -p .                  # type check

# End-to-end UI tests (in desktop/), against a running dev server or preview:
PAPERWING_URL=http://localhost:5173 npm run test:e2e
```

The end-to-end suite (`desktop/tests/e2e.test.mjs`) drives the real interface in headless Chrome:
opening documents, Acrobat shortcuts, unsaved-change prompts, reopening closed tabs, running a tool on
the open document, theming of tool pages, and more. Set `CHROME_PATH` if Chrome isn't found.

## Packaging

| Command (in `desktop/`) | Output in `desktop/release/`                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dist:win`      | `Paperwing-Setup-<v>-x64.exe`, `Paperwing-Portable-<v>-x64.exe`, `Paperwing-<v>-win-x64.zip` |
| `npm run dist:mac`      | `Paperwing-<v>-mac-arm64.dmg`, `…-mac-x64.dmg` and matching `.zip`s (must run on macOS)      |
| `npm run pack`          | Unpacked app folder only, for quick checks                                                   |

Packaging is configured in `desktop/electron-builder.yml`. The app icon is generated from
`desktop/build/icon.svg` (`icon.png`, 1024 px, is what electron-builder uses).

### Code signing (optional)

Builds are unsigned by default, which is why Windows SmartScreen and macOS Gatekeeper show a warning
on first launch (see [INSTALL.md](INSTALL.md)). To sign:

- **Windows:** set `CSC_LINK` (path/URL/base64 of a `.pfx`) and `CSC_KEY_PASSWORD`.
- **macOS:** set `CSC_LINK`/`CSC_KEY_PASSWORD` for a _Developer ID Application_ certificate, change
  `mac.identity` in `electron-builder.yml` from `'-'` to `null` (auto-discover) or your identity name,
  set `hardenedRuntime: true`, and add notarisation credentials (`APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) with `notarize: true`.

In GitHub Actions, add these as repository secrets and expose them as environment variables in
`.github/workflows/release.yml`, and remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`.

## Releasing

1. Update `version` in `desktop/package.json` and add a section to `CHANGELOG.md`.
2. Update `docs/RELEASE_NOTES.md` (it becomes the GitHub release description).
3. Commit, then tag and push:
   ```bash
   git tag v1.0.0
   git push origin main --tags
   ```
4. The **Release desktop apps** workflow builds Windows and macOS on GitHub's runners (about
   15–25 minutes) and creates a **draft release** with all installers and a `SHA256SUMS.txt`.
5. Open the draft on GitHub, check the notes and assets, and click **Publish release**.

The in-app update check compares against the latest _published_ release of the repository set in
`desktop/package.json` → `paperwing.repository`.

## Pulling in new BentoPDF versions

```bash
git fetch upstream --tags            # upstream = https://github.com/alam00000/bentopdf
git merge v2.9.0                     # the BentoPDF release tag you want
npm ci && npx vitest run && (cd desktop && npm run dev)
```

Conflicts are rare because Paperwing's code lives in its own folders. When they happen they're
usually in `vite.config.ts`, `package-lock.json` or the moved/removed repository files (README,
workflows) — keep Paperwing's version of those. After merging, look over a few tool pages in both
themes: new upstream markup may need a small addition to `src/reskin/reskin.css` or `apps.css`.
