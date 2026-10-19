## Paperwing 1.2.1

Fixes for 1.2, and the latest BentoPDF (2.8.10) with its security hardening.

### Safer

- **Built on BentoPDF 2.8.10.** Sanitize, Flatten and Redact remove hidden content more
  thoroughly, signature validation is stricter, and the PDF engine and viewer are newer.
- **Signature checks you can trust.** Validate Signatures no longer reports a valid signature as
  unverified when the signer's certificate isn't the first one in it.

### Better

- **Updates show up sooner, and wait for you.** Paperwing now checks each time it starts and every
  few hours while it's open, instead of once a day. On Windows it tells you a new version is
  available and downloads it only when you choose **Update**, with its progress shown.

### Fixed

- **Readable shortcuts in tooltips.** The keyboard shortcut next to each tooltip's label was grey
  on grey in both light and dark themes. It's now an outlined key with clear, high-contrast text.
- **Full-size taskbar icon.** On Windows, Paperwing's icon is now the same size as other apps'
  (it was a few pixels smaller at common display scaling). If the taskbar still shows the old one
  after updating, unpin Paperwing and pin it again; Windows caches icons.

Everything new in 1.2 (Acrobat-style toolbar menus, page actions on thumbnails, recovery of unsaved
edits, offline engines and OCR) is in the [1.2.0 release](https://github.com/rohanvijaykumar/paperwing/releases/tag/v1.2.0).

On Windows, Paperwing 1.1 and later update themselves: open Paperwing and choose **Help ▸ Check
for updates** if it hasn't offered 1.2.1 yet. On macOS and the portable build, download it below
and install it over the old version. Full list of changes: [CHANGELOG.md](https://github.com/rohanvijaykumar/paperwing/blob/main/CHANGELOG.md).

### Downloads

|                     |                                    |
| ------------------- | ---------------------------------- |
| Windows installer   | `Paperwing-Setup-*-x64.exe`        |
| Windows portable    | `Paperwing-Portable-*-win-x64.zip` |
| macOS Apple Silicon | `Paperwing-*-mac-arm64.dmg`        |
| macOS Intel         | `Paperwing-*-mac-x64.dmg`          |

These builds aren't code-signed yet. On Windows choose **More info ▸ Run anyway**; on macOS
right-click the app and choose **Open** the first time. Full instructions:
[docs/INSTALL.md](https://github.com/rohanvijaykumar/paperwing/blob/main/docs/INSTALL.md).
Checksums are in `SHA256SUMS.txt`.

Thanks to Alam and the BentoPDF contributors — Paperwing wouldn't exist without their engine.
