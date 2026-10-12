# Contributing to Paperwing

Thanks for helping make Paperwing better! Bug reports, ideas, documentation fixes and pull requests
are all welcome.

## Reporting bugs and suggesting features

Use the [issue templates](https://github.com/rohanvijaykumar/paperwing/issues/new/choose). For bugs,
please include your Paperwing version (**Menu ▸ About Paperwing**), your OS, the steps to reproduce,
and — if you can share it — a PDF that shows the problem.

**Engine or interface?** Paperwing's PDF tools come from [BentoPDF](https://github.com/alam00000/bentopdf).
If a tool produces the wrong _output_ (e.g. a conversion loses formatting), the fix usually belongs
upstream; open the issue here anyway and we'll help route it. Problems with the workspace, themes,
shortcuts, installers or anything that looks wrong are Paperwing issues.

## Development setup

See [docs/BUILDING.md](docs/BUILDING.md). In short:

```bash
npm ci && (cd desktop && npm ci)
cd desktop && npm run dev
```

## Guidelines

- **Keep the engine untouched.** Paperwing code lives in `app.html`, `src/acro/`, `src/reskin/`,
  `reskin/` and `desktop/`. Avoid editing BentoPDF's files under `src/js`, `src/pages`, `public/`
  etc. — style or hook them from the integration layer instead, so upstream updates merge cleanly.
  Engine improvements are best contributed to BentoPDF directly.
- **Follow the design language.** New UI should match the existing Acrobat-style look in both light
  and dark themes: use the CSS tokens (`--surface`, `--text`, `--accent`… in the shell, `--rs-*` in
  tool pages), 32 px controls, pill-shaped buttons and the Source Sans 3 typeface.
- **Keep it light and private.** No telemetry, accounts, trackers or heavyweight dependencies.
- **Shortcuts** are defined once in `src/acro/keymap.ts`; run `npm run docs:shortcuts` in `desktop/`
  to regenerate `docs/SHORTCUTS.md` after changing them.
- **Test your change:** `npx tsc --noEmit -p .`, `npx vitest run`, and the end-to-end suite
  (`npm run test:e2e` in `desktop/`) for interface changes. Add tests for new behaviour.
- Pre-commit hooks run ESLint and Prettier on staged files.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make focused commits with clear messages.
3. Describe what changed and why, with screenshots for visual changes (light and dark).
4. Make sure the checks pass.

By contributing you agree that your contributions are licensed under the project's
[AGPL-3.0 license](LICENSE).

## Code of conduct

Please be kind and constructive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
