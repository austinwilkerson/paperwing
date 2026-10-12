/**
 * Paperwing — Electron main process.
 *
 * Serves the BentoPDF-based web app from the app:// protocol (so it runs fully
 * offline with the cross-origin isolation headers its WebAssembly needs), opens
 * PDFs passed by the OS, and gives the renderer a small file bridge.
 */
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const pkg = require('./package.json');

const SCHEME = 'app';
const HOST = 'paperwing';
const ORIGIN = `${SCHEME}://${HOST}`;
const IS_MAC = process.platform === 'darwin';

/* ------------------------------------------------------------------ */
/* Portable mode: keep settings next to the executable                 */
/* ------------------------------------------------------------------ */

function portableDataDir() {
  // Set by electron-builder's "portable" target
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Paperwing Data');
  }
  // Zip build: opt in by creating a "Paperwing Data" folder next to the exe
  const beside = path.join(path.dirname(process.execPath), 'Paperwing Data');
  return fs.existsSync(beside) ? beside : null;
}

const portableDir = app.isPackaged ? portableDataDir() : null;
if (portableDir) {
  fs.mkdirSync(portableDir, { recursive: true });
  app.setPath('userData', portableDir);
}

/* ------------------------------------------------------------------ */
/* Single instance + files opened from the OS                          */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let mainWindow = null;
let rendererReady = false;
const pendingFiles = [];

const isPdfPath = (p) =>
  typeof p === 'string' && /\.pdf$/i.test(p) && fs.existsSync(p);

function pdfArgs(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).filter(isPdfPath);
}

async function sendFile(filePath) {
  if (!mainWindow || !rendererReady) {
    pendingFiles.push(filePath);
    return;
  }
  try {
    const data = await fsp.readFile(filePath);
    mainWindow.webContents.send('paperwing:open-file', {
      path: filePath,
      name: path.basename(filePath),
      data,
    });
  } catch (err) {
    dialog.showErrorBox('Could not open file', `${filePath}\n\n${err.message}`);
  }
}

pendingFiles.push(...pdfArgs(process.argv));

app.on('second-instance', (_e, argv) => {
  pdfArgs(argv).forEach(sendFile);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// macOS: Finder "Open With", dock drops
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  if (isPdfPath(filePath)) sendFile(filePath);
});

/* ------------------------------------------------------------------ */
/* app:// protocol                                                     */
/* ------------------------------------------------------------------ */

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);

const WEB_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.resolve(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.icc': 'application/vnd.iccprofile',
  '.data': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.gz': 'application/gzip',
  '.zip': 'application/zip',
};

const SECURITY_HEADERS = {
  // Same isolation policy as upstream's nginx config: enables
  // SharedArrayBuffer for the multi-threaded WebAssembly engines.
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'X-Content-Type-Options': 'nosniff',
};

function resolveRequestPath(url) {
  let pathname = decodeURIComponent(new URL(url).pathname);
  if (pathname === '/' || pathname === '') pathname = '/app.html';
  const file = path.normalize(path.join(WEB_ROOT, pathname));
  if (!file.startsWith(WEB_ROOT)) return null; // path traversal
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    return path.join(file, 'index.html');
  }
  if (!path.extname(file) && fs.existsSync(`${file}.html`))
    return `${file}.html`;
  return file;
}

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const file = resolveRequestPath(request.url);
    if (!file || !fs.existsSync(file)) {
      return new Response('Not found', { status: 404 });
    }
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set(
      'Content-Type',
      MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
    );
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    return new Response(res.body, { status: 200, headers });
  });
}

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

const TITLEBAR_HEIGHT = 40;

/** Title bar colours matching the app's light/dark chrome */
function chromeColors() {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#1a1a1a', symbolColor: '#d0d0d0' }
    : { color: '#f3f3f3', symbolColor: '#4b4b4b' };
}

nativeTheme.on('updated', () => {
  if (!mainWindow) return;
  const { color, symbolColor } = chromeColors();
  mainWindow.setBackgroundColor(color);
  if (!IS_MAC) {
    mainWindow.setTitleBarOverlay({
      color,
      symbolColor,
      height: TITLEBAR_HEIGHT,
    });
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Paperwing',
    backgroundColor: chromeColors().color,
    titleBarStyle: 'hidden',
    ...(IS_MAC
      ? { trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarOverlay: { ...chromeColors(), height: TITLEBAR_HEIGHT } }),
    icon: app.isPackaged
      ? undefined
      : path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });

  // Links to the web open in the default browser; nothing else may open windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.loadURL(`${ORIGIN}/app.html`);
}

/* ------------------------------------------------------------------ */
/* IPC bridge (see preload.cjs)                                        */
/* ------------------------------------------------------------------ */

function senderIsApp(e) {
  return e.senderFrame && e.senderFrame.url.startsWith(ORIGIN);
}

ipcMain.handle('paperwing:ready', (e) => {
  if (!senderIsApp(e)) return;
  rendererReady = true;
  pendingFiles.splice(0).forEach(sendFile);
});

ipcMain.handle('paperwing:set-theme', (e, pref) => {
  if (!senderIsApp(e)) return;
  nativeTheme.themeSource = ['light', 'dark'].includes(pref) ? pref : 'system';
});

ipcMain.handle('paperwing:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  portable: !!portableDir,
  repository: pkg.paperwing?.repository ?? '',
}));

ipcMain.handle('paperwing:read-file', async (e, filePath) => {
  if (!senderIsApp(e) || !isPdfPath(filePath)) return null;
  return fsp.readFile(filePath);
});

ipcMain.handle('paperwing:write-file', async (e, filePath, data) => {
  if (!senderIsApp(e) || !/\.pdf$/i.test(filePath)) return false;
  await fsp.writeFile(filePath, Buffer.from(data));
  return true;
});

ipcMain.handle('paperwing:save-as', async (e, suggestedName, data) => {
  if (!senderIsApp(e)) return null;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('documents'), suggestedName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;
  await fsp.writeFile(filePath, Buffer.from(data));
  return { path: filePath, name: path.basename(filePath) };
});

ipcMain.handle('paperwing:open-dialog', async (e) => {
  if (!senderIsApp(e)) return [];
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled) return [];
  return Promise.all(
    filePaths.map(async (p) => ({
      path: p,
      name: path.basename(p),
      data: await fsp.readFile(p),
    }))
  );
});

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

function buildMenu() {
  if (!IS_MAC) {
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS needs an application menu for Cmd+C/V/Q etc.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          {
            label: 'Paperwing on GitHub',
            click: () =>
              shell.openExternal(
                `https://github.com/${pkg.paperwing.repository}`
              ),
          },
        ],
      },
    ])
  );
}

/* ------------------------------------------------------------------ */
/* Startup                                                             */
/* ------------------------------------------------------------------ */

app.whenReady().then(() => {
  registerProtocol();
  buildMenu();

  // Exports that aren't PDFs (images, Word, ZIP...) ask where to save
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit();
});
