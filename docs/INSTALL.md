# Installing Paperwing

Download the file for your computer from the
**[latest release](https://github.com/rohanvijaykumar/paperwing/releases/latest)**.

- [Windows](#windows)
- [macOS](#macos)
- [Updating](#updating)
- [Uninstalling](#uninstalling)

---

## Windows

Windows 10 or 11, 64-bit. There are three versions. They all have the same features, so pick
whichever suits you.

### Installer (recommended)

1. Download `Paperwing-Setup-<version>-x64.exe` and run it.
2. If **Windows protected your PC** appears, click **More info ▸ Run anyway**. (Paperwing isn't
   code-signed yet; the warning appears for any unsigned app.)
3. Choose where to install and finish the setup.

The installer adds Start-menu and desktop shortcuts and offers Paperwing as an app for opening PDFs.
To make it your default PDF app: **Settings ▸ Apps ▸ Default apps**, search for `.pdf` and choose Paperwing.

### Portable (single .exe)

`Paperwing-Portable-<version>-x64.exe` runs without installing anything — handy on a USB stick or a
computer where you can't install software. Your settings are kept in a **Paperwing Data** folder next
to the file. The first launch takes a few seconds while it unpacks.

### Portable folder (.zip)

1. Unzip `Paperwing-<version>-win-x64.zip` anywhere.
2. Run `Paperwing.exe`.

By default settings are stored in your user profile. To keep them inside the folder instead (fully
portable), create an empty folder named **Paperwing Data** next to `Paperwing.exe`.

---

## macOS

macOS 12 Monterey or later.

| Your Mac                        | Download                            |
| ------------------------------- | ----------------------------------- |
| Apple Silicon (M1, M2, M3, M4…) | `Paperwing-<version>-mac-arm64.dmg` |
| Intel                           | `Paperwing-<version>-mac-x64.dmg`   |

Not sure? Apple menu ▸ **About This Mac** — "Chip: Apple…" means Apple Silicon.

1. Open the `.dmg` and drag **Paperwing** into **Applications**.
2. The first time, **right-click (or Control-click) Paperwing in Applications and choose Open**, then
   click **Open** in the dialog. You only need to do this once.

If macOS says the app **"is damaged and can't be opened"**, that is Gatekeeper's message for
downloaded apps that aren't notarised by Apple. Run this once in Terminal and open it again:

```bash
xattr -cr /Applications/Paperwing.app
```

To open PDFs with Paperwing by default: select any PDF in Finder ▸ **File ▸ Get Info** ▸
**Open with: Paperwing** ▸ **Change All…**

---

## Updating

Paperwing checks this project's GitHub Releases once a day and shows a notice when a new version is
out (you can turn this off in **Menu ▸ Preferences**). Download the new version and install it over
the old one — your settings, recent files and pinned tools are kept. Portable users can simply replace
the `.exe` / folder.

## Uninstalling

- **Windows installer:** Settings ▸ Apps ▸ Installed apps ▸ Paperwing ▸ Uninstall.
- **Windows portable:** delete the `.exe` (or folder) and its **Paperwing Data** folder.
- **macOS:** drag Paperwing from Applications to the Bin. Settings live in
  `~/Library/Application Support/Paperwing` if you want to remove them too.
