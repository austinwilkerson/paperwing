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
const { Readable } = require('node:stream');
const crypto = require('node:crypto');

/** PAPERWING_TRACE=1 prints startup timings (ms since the process started) */
const trace = process.env.PAPERWING_TRACE
  ? (what) =>
      console.log(`[paperwing] ${Math.round(performance.now())} ms  ${what}`)
  : () => {};

const pkg = require('./package.json');

const SCHEME = 'app';
const HOST = 'paperwing';
const ORIGIN = `${SCHEME}://${HOST}`;
const IS_MAC = process.platform === 'darwin';

/* ------------------------------------------------------------------ */
/* Portable mode: keep settings next to the executable                 */
/* ------------------------------------------------------------------ */

function portableDataDir() {
  const appDir = path.dirname(process.execPath);
  const beside = path.join(appDir, 'Paperwing Data');
  // An existing "Paperwing Data" folder always wins
  if (fs.existsSync(beside)) return beside;
  // The Windows zip is the portable build: anything that wasn't put there
  // by the installer (which leaves an uninstaller beside the exe) keeps its
  // settings next to itself, if that folder is writable
  if (process.platform !== 'win32') return null;
  if (fs.existsSync(path.join(appDir, `Uninstall ${app.getName()}.exe`)))
    return null;
  try {
    fs.mkdirSync(beside, { recursive: true });
    return beside;
  } catch {
    return null;
  }
}

const portableDir = app.isPackaged ? portableDataDir() : null;
if (portableDir) app.setPath('userData', portableDir);

/* ------------------------------------------------------------------ */
/* Single instance + files opened from the OS                          */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let mainWindow = null;
let rendererReady = false;
/** Set once the renderer has dealt with unsaved documents */
let allowClose = false;
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

/* ------------------------------------------------------------------ */
/* Engines downloaded on first use                                     */
/* ------------------------------------------------------------------ */

// Large engine files (LibreOffice, ~77 MB) aren't shipped in the installer.
// The first time a tool requests one, it's downloaded from this project's
// GitHub Releases, cached in the user data folder and served from there.
let engines = { tag: '', files: [] };
try {
  engines = require('./engines.json');
} catch {
  /* dev run without a desktop build: all engine files are in ../dist */
}
const ENGINE_DIR = () =>
  path.join(app.getPath('userData'), 'engines', engines.tag);
const engineDownloads = new Map();

function engineUrl(name) {
  const base =
    process.env.PAPERWING_ENGINE_BASE ||
    `https://github.com/${pkg.paperwing.repository}/releases/download/${engines.tag}`;
  return `${base.replace(/\/$/, '')}/${name}`;
}

/** Response for an on-demand engine file, downloading it if needed */
async function serveEngineFile(entry, headers) {
  const cached = path.join(ENGINE_DIR(), entry.name);
  if (fs.existsSync(cached) && fs.statSync(cached).size === entry.size) {
    headers.set('Content-Length', String(entry.size));
    const res = await net.fetch(pathToFileURL(cached).toString());
    return new Response(res.body, { status: 200, headers });
  }
  // Another request is already downloading it: wait, then serve the cache
  if (engineDownloads.has(entry.name)) {
    await engineDownloads.get(entry.name);
    return serveEngineFile(entry, headers);
  }
  const res = await net.fetch(engineUrl(entry.name));
  if (!res.ok || !res.body) {
    return new Response('Engine download failed', { status: 503, headers });
  }
  fs.mkdirSync(ENGINE_DIR(), { recursive: true });
  const tmp = `${cached}.part`;
  const [toPage, toDisk] = res.body.tee();
  const done = new Promise((resolve) => {
    const out = fs.createWriteStream(tmp);
    const hash = crypto.createHash('sha256');
    Readable.fromWeb(toDisk)
      .on('data', (chunk) => hash.update(chunk))
      .pipe(out)
      .on('finish', () => {
        // Only keep a complete, untampered copy
        if (hash.digest('hex') === entry.sha256) fs.renameSync(tmp, cached);
        else fs.rmSync(tmp, { force: true });
        resolve();
      })
      .on('error', () => {
        fs.rmSync(tmp, { force: true });
        resolve();
      });
  });
  engineDownloads.set(entry.name, done);
  done.finally(() => engineDownloads.delete(entry.name));
  headers.set('Content-Length', String(entry.size));
  return new Response(toPage, { status: 200, headers });
}

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const file = resolveRequestPath(request.url);
    if (!file) return new Response('Not found', { status: 404 });
    const headers = new Headers({
      'Content-Type':
        MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      ...SECURITY_HEADERS,
    });
    if (!fs.existsSync(file)) {
      const rel = path.relative(WEB_ROOT, file).split(path.sep).join('/');
      const entry = engines.files.find((f) => f.path === rel);
      if (entry) return serveEngineFile(entry, headers);
      return new Response('Not found', { status: 404 });
    }
    const res = await net.fetch(pathToFileURL(file).toString());
    const length = res.headers.get('Content-Length');
    if (length) headers.set('Content-Length', length);
    return new Response(res.body, { status: 200, headers });
  });
}

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

const TITLEBAR_HEIGHT = 40;
/** The launch screen stays up at least this long */
const SPLASH_MIN_MS = 900;

let splashWindow = null;
let splashShownAt = 0;
let appReady = false;

/** Small frameless launch window, shown alone while the app loads */
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 560,
    height: 360,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    show: false,
    title: 'Paperwing',
    // Opaque (transparent windows take noticeably longer to appear on Windows)
    backgroundColor: '#c8102e',
    roundedCorners: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      spellcheck: false,
    },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'), {
    query: { v: app.getVersion() },
  });
  // Show as soon as it's parsed: 'ready-to-show' waits on the first paint,
  // which the main window's start-up delays by half a second. The window's
  // background matches the card, so there's no flash.
  splashWindow.webContents.once('dom-ready', () => {
    if (!splashWindow) return;
    splashShownAt = Date.now();
    splashWindow.show();
    trace('launch screen shown');
    if (appReady) revealMainWindow();
  });
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

/** Swap the launch screen for the main window once the app is ready */
function revealMainWindow() {
  appReady = true;
  if (!mainWindow || mainWindow.isVisible()) return;
  // Launch screen still loading: reveal once it has been seen briefly
  if (splashWindow && !splashShownAt) return;
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt));
  setTimeout(() => {
    if (!mainWindow || mainWindow.isVisible()) return;
    mainWindow.show();
    mainWindow.focus();
    splashWindow?.close();
    trace('main window shown');
  }, wait);
}

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
    // Hidden until loaded; the launch window is shown meanwhile
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

  // Let the app ask about unsaved documents before the window closes
  mainWindow.on('close', (e) => {
    if (allowClose || !rendererReady) return;
    e.preventDefault();
    mainWindow.webContents.send('paperwing:close-requested');
  });
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

  mainWindow.webContents.once('dom-ready', () => trace('app.html parsed'));
  mainWindow.loadURL(`${ORIGIN}/app.html`);
  // Safety net: never leave the user with only the launch screen
  setTimeout(() => {
    splashShownAt ||= 1;
    revealMainWindow();
  }, 12000);
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
  trace('app ready');
  revealMainWindow();
  pendingFiles.splice(0).forEach(sendFile);
});

ipcMain.handle('paperwing:set-theme', (e, pref) => {
  if (!senderIsApp(e)) return;
  nativeTheme.themeSource = ['light', 'dark'].includes(pref) ? pref : 'system';
});

// Same path as the window's close button (so unsaved work is checked)
ipcMain.handle('paperwing:request-close', (e) => {
  if (senderIsApp(e)) mainWindow?.close();
});

ipcMain.handle('paperwing:confirm-close', (e) => {
  if (!senderIsApp(e) || !mainWindow) return;
  allowClose = true;
  mainWindow.close();
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
    // Windows/Linux: no menu bar; the app handles every shortcut itself
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS: menu accelerators win over page key handling, so each item
  // forwards its command to the app instead of acting on the page.
  const send = (command) => () =>
    mainWindow?.webContents.send('paperwing:menu', command);
  const item = (label, accelerator, command) => ({
    label,
    accelerator,
    click: send(command),
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          item('About Paperwing', undefined, 'about'),
          { type: 'separator' },
          item('Preferences…', 'Cmd+,', 'prefs'),
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          item('Open…', 'Cmd+O', 'open'),
          item('Create PDF…', 'Cmd+N', 'create'),
          item('Reopen Closed Document', 'Shift+Cmd+T', 'reopen'),
          { type: 'separator' },
          item('Save', 'Cmd+S', 'save'),
          item('Save As…', 'Shift+Cmd+S', 'saveAs'),
          item('Print…', 'Cmd+P', 'print'),
          item('Document Properties…', 'Cmd+D', 'properties'),
          { type: 'separator' },
          item('Close Document', 'Cmd+W', 'close'),
          item('Close All', 'Alt+Cmd+W', 'closeAll'),
        ],
      },
      {
        label: 'Edit',
        submenu: [
          item('Undo', 'Cmd+Z', 'undo'),
          item('Redo', 'Shift+Cmd+Z', 'redo'),
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
          { type: 'separator' },
          item('Find', 'Cmd+F', 'find'),
          item('Find Next', 'Cmd+G', 'findNext'),
          item('Find Previous', 'Shift+Cmd+G', 'findPrev'),
          item('Search Tools & Commands…', 'Shift+Cmd+P', 'palette'),
        ],
      },
      {
        label: 'View',
        submenu: [
          item('Zoom In', 'Cmd+=', 'zoomIn'),
          item('Zoom Out', 'Cmd+-', 'zoomOut'),
          item('Zoom To…', 'Cmd+Y', 'zoomTo'),
          item('Actual Size', 'Cmd+1', 'actualSize'),
          item('Fit Page', 'Cmd+0', 'fitPage'),
          item('Fit Width', 'Cmd+2', 'fitWidth'),
          { type: 'separator' },
          item('Rotate Clockwise', 'Shift+Cmd+=', 'rotateCw'),
          item('Rotate Counterclockwise', 'Shift+Cmd+-', 'rotateCcw'),
          { type: 'separator' },
          item('Read Mode', 'Cmd+H', 'readMode'),
          item('Full Screen', 'Cmd+L', 'fullScreen'),
          item('Page Thumbnails', 'F4', 'navPane'),
          item('Tools Panel', 'Shift+F4', 'toolsPane'),
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          item('Next Document', 'Ctrl+Tab', 'nextTab'),
          item('Previous Document', 'Ctrl+Shift+Tab', 'prevTab'),
          { type: 'separator' },
          { role: 'front' },
        ],
      },
      {
        role: 'help',
        submenu: [
          item('Keyboard Shortcuts', undefined, 'shortcuts'),
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
  trace('electron ready');
  createSplash();
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
