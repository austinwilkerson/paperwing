# Changelog

All notable changes to Paperwing are documented here. Paperwing follows
[Semantic Versioning](https://semver.org). Changes to the underlying PDF engine are listed in
[BentoPDF's releases](https://github.com/alam00000/bentopdf/releases).

## [1.0.0] — 2026-10-12

First public release. Engine: BentoPDF 2.8.8.

### Added

- Desktop app for Windows (installer, portable `.exe`, portable `.zip`) and macOS (Apple Silicon and Intel)
- Acrobat-style workspace: tabbed documents, Home with recent and starred files, All tools view,
  Edit / Convert / E-Sign tool panels, floating quick-action toolbar and right navigation rail
- Built-in viewer with comments, highlights, drawing, text boxes, shapes, stamps, links and redaction
- Every BentoPDF tool runs on the open document, in the side panel or full view; results open in a new tab
- Light and neutral dark themes that follow the system, with an override in Preferences
- Acrobat-compatible keyboard shortcuts including single-key tool accelerators; macOS menu bar
- Command palette (Shift+Ctrl+P), pinned and recently used tools
- Unsaved-change indicators, save prompts when closing tabs or the window, session restore and
  reopen closed tab (Shift+Ctrl+T)
- Preferences, document properties, zoom to, read mode and full screen
- Native open/save dialogs, "Save" back to the original file, PDF file association, single instance
- Optional once-a-day update check against GitHub Releases
- Launch screen and background warm-up of the PDF engine for fast first open
- Unit tests for the shell and an end-to-end UI test suite
