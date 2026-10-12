/**
 * Wrapper around BentoPDF's bundled EmbedPDF viewer. One viewer instance hosts
 * every open document; its own toolbars are hidden so the shell's
 * Acrobat-style chrome (quick toolbar, right rail) drives it via commands.
 */
import type { EmbedPdfContainer, PluginRegistry } from 'bentopdf-viewer';
import { editorFontFallback } from '../js/config/editor-fonts.js';
import { getThemePref, onThemeChange } from '../reskin/theme';
import { getPrefs } from './prefs';

/** Zoom level for the viewer from the "Default zoom" preference */
const zoomLevel = () => {
  const z = getPrefs().defaultZoom;
  return z === '100' ? 1 : z;
};

/** Acrobat-like neutral greys for both themes */
function viewerTheme() {
  return {
    preference: getThemePref(),
    light: {
      background: {
        app: '#f8f8f8',
        surface: '#ffffff',
        surfaceAlt: '#f5f5f5',
        elevated: '#ffffff',
        input: '#ffffff',
      },
      accent: {
        primary: '#3b63fb',
        primaryHover: '#274dea',
        primaryActive: '#1d3ecf',
        primaryLight: '#edf1ff',
        primaryForeground: '#ffffff',
      },
    },
    dark: {
      background: {
        app: '#141414',
        surface: '#222222',
        surfaceAlt: '#1c1c1c',
        elevated: '#2a2a2a',
        overlay: 'rgba(0,0,0,0.6)',
        input: '#1c1c1c',
      },
      foreground: {
        primary: '#ededed',
        secondary: '#c9c9c9',
        muted: '#9c9c9c',
        disabled: '#666666',
        onAccent: '#ffffff',
      },
      border: { default: '#333333', subtle: '#2a2a2a', strong: '#4a4a4a' },
      accent: {
        primary: '#5c7cff',
        primaryHover: '#7590ff',
        primaryActive: '#4a69ef',
        primaryLight: '#242a3d',
        primaryForeground: '#ffffff',
      },
      interactive: {
        hover: '#2f2f2f',
        active: '#3a3a3a',
        selected: '#2c3350',
        focus: '#5c7cff',
        focusRing: 'rgba(92,124,255,0.4)',
      },
      scrollbar: {
        track: 'transparent',
        thumb: '#4a4a4a',
        thumbHover: '#5e5e5e',
      },
    },
  };
}

const wasmUrl = new URL('bentopdf-pdfium/editcore.wasm', import.meta.url).href;

type Unsub = () => void;
// The plugin capabilities are loosely typed in the published d.ts; keep the
// surface we use small and explicit.
type Cap = Record<string, any>;

export interface PageInfo {
  current: number;
  total: number;
}

export class Viewer {
  private container?: EmbedPdfContainer;
  private registry?: PluginRegistry;
  private ready?: Promise<void>;
  /** our tab id -> viewer document id */
  private docIds = new Map<string, string>();
  private pending = new Map<string, (docId: string) => void>();
  private pageListeners = new Set<(tabId: string, info: PageInfo) => void>();
  private toolListeners = new Set<
    (tabId: string, toolId: string | null) => void
  >();
  private changeListeners = new Set<(tabId: string) => void>();

  constructor(private host: HTMLElement) {}

  cap(name: string): Cap {
    return (this.registry as any).getPlugin(name).provides();
  }

  private init(): Promise<void> {
    this.ready ??= (async () => {
      const { default: EmbedPDF } = await import('bentopdf-viewer');
      this.container = EmbedPDF.init({
        type: 'container',
        target: this.host,
        worker: true,
        wasmUrl,
        fontFallback: editorFontFallback,
        tabBar: 'never',
        documentManager: { maxDocuments: 50 },
        theme: viewerTheme(),
        zoom: {
          defaultZoomLevel:
            zoomLevel() === 'automatic' ? 'fit-width' : zoomLevel(),
        },
      } as any) as EmbedPdfContainer;
      this.registry = await (this.container as any).registry;
      onThemeChange(() => (this.container as any)?.setTheme?.(viewerTheme()));

      const dm = this.cap('document-manager');
      dm.onDocumentOpened((doc: { id: string; name?: string }) => {
        const tabId = doc.name ?? '';
        const resolve = this.pending.get(tabId);
        if (!resolve) return;
        this.pending.delete(tabId);
        this.docIds.set(tabId, doc.id);
        this.stripChrome(doc.id);
        resolve(doc.id);
      });

      // Thumbnails/bookmarks live on the right in Acrobat, beside the rail
      const ui = this.cap('ui');
      const panel = ui.getSchema().sidebars?.['sidebar-panel'];
      if (panel) {
        ui.mergeSchema({
          sidebars: {
            'sidebar-panel': {
              ...panel,
              position: { placement: 'right', slot: 'main', order: 0 },
            },
          },
        });
      }

      // Keep the viewer's own toolbars closed whenever it tries to show them
      ui.onToolbarChanged?.((e: { documentId?: string }) => {
        if (e?.documentId) this.stripChrome(e.documentId);
      });

      // Any undoable edit (annotations, redactions...) marks the doc changed
      this.cap('history').onHistoryChange((e: any) => {
        const tabId = this.tabFor(e.documentId);
        if (tabId) this.changeListeners.forEach((fn) => fn(tabId));
      });

      this.cap('annotation').onActiveToolChange((e: any) => {
        const tabId = this.tabFor(e.documentId);
        if (tabId)
          this.toolListeners.forEach((fn) => fn(tabId, e.tool?.id ?? null));
      });

      this.cap('scroll').onPageChange((e: any) => {
        const tabId = this.tabFor(e.documentId);
        if (tabId) this.emitPage(tabId);
      });
      this.cap('scroll').onLayoutReady?.((e: any) => {
        const tabId = this.tabFor(e.documentId);
        if (tabId) this.emitPage(tabId);
      });
    })();
    return this.ready;
  }

  private stripChrome(docId: string) {
    const d = this.cap('ui').forDocument(docId);
    for (const slot of ['main', 'secondary']) {
      if (d.isToolbarOpen?.('top', slot)) d.closeToolbarSlot('top', slot);
    }
    if (d.isOverlayEnabled?.('page-controls'))
      d.disableOverlay('page-controls');
  }

  private tabFor(docId: string): string | undefined {
    for (const [tab, id] of this.docIds) if (id === docId) return tab;
    return undefined;
  }

  private emitPage(tabId: string) {
    const info = this.pageInfo(tabId);
    if (info) this.pageListeners.forEach((fn) => fn(tabId, info));
  }

  onPage(fn: (tabId: string, info: PageInfo) => void): Unsub {
    this.pageListeners.add(fn);
    return () => this.pageListeners.delete(fn);
  }

  /** Start the PDF engine early (idle time after launch) so the first
   *  document opens without waiting for WebAssembly to compile. */
  warmUp(): Promise<void> {
    return this.init();
  }

  /** "Automatic" = fit the page width, but never above 150% (big screens) */
  applyDefaultZoom(tabId: string) {
    const id = this.docIds.get(tabId);
    if (!id) return;
    let level: number | string = zoomLevel();
    if (level === 'automatic') {
      const info = this.docInfo(tabId);
      const width = this.host.clientWidth - 96; // breathing room either side
      level =
        info?.width && width > 0
          ? Math.min(width / info.width, 1.5)
          : 'fit-width';
    }
    this.cap('zoom').forDocument(id).requestZoom(level);
    // Zooming keeps the centre in place; new documents should start at the top
    setTimeout(() => {
      try {
        this.cap('scroll')
          .forDocument(id)
          .scrollToPage({ pageNumber: 1, behavior: 'instant' });
      } catch {
        /* document closed meanwhile */
      }
    }, 120);
  }

  /** Fires after every undoable edit in a document */
  onChange(fn: (tabId: string) => void): Unsub {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  /** Move between search results in the find panel */
  searchStep(tabId: string, dir: 1 | -1) {
    const id = this.docIds.get(tabId);
    if (!id) return;
    const s = this.cap('search').forDocument(id);
    if (dir > 0) s.nextResult();
    else s.previousResult();
  }

  history(tabId: string, action: 'undo' | 'redo') {
    const id = this.docIds.get(tabId);
    if (!id) return;
    const h = this.cap('history').forDocument(id);
    if (action === 'undo' ? h.canUndo() : h.canRedo()) h[action]();
  }

  /** Page count and size of the first page (PDF points) */
  docInfo(
    tabId: string
  ): { pages: number; width: number; height: number } | null {
    const id = this.docIds.get(tabId);
    if (!id || !this.registry) return null;
    const doc = this.cap('document-manager').getDocument(id);
    if (!doc) return null;
    const size = doc.pages?.[0]?.size ?? { width: 0, height: 0 };
    return { pages: doc.pageCount, width: size.width, height: size.height };
  }

  /** Fires when the active annotation tool changes (null = select) */
  onActiveTool(fn: (tabId: string, toolId: string | null) => void): Unsub {
    this.toolListeners.add(fn);
    return () => this.toolListeners.delete(fn);
  }

  async open(tabId: string, buffer: ArrayBuffer): Promise<void> {
    await this.init();
    const opened = new Promise<string>((r) => this.pending.set(tabId, r));
    this.cap('document-manager').openDocumentBuffer({
      buffer,
      name: tabId,
      autoActivate: true,
    });
    await opened;
    // Apply the preferred zoom once the first page is laid out
    setTimeout(() => this.applyDefaultZoom(tabId), 60);
  }

  async activate(tabId: string) {
    await this.init();
    const id = this.docIds.get(tabId);
    if (id) this.cap('document-manager').setActiveDocument(id);
  }

  close(tabId: string) {
    const id = this.docIds.get(tabId);
    if (!id || !this.registry) return;
    this.cap('document-manager').closeDocument(id);
    this.docIds.delete(tabId);
  }

  has(tabId: string) {
    return this.docIds.has(tabId);
  }

  command(tabId: string, commandId: string) {
    const id = this.docIds.get(tabId);
    if (!id) return;
    this.cap('commands').execute(commandId, id);
  }

  /** Toggle one of the viewer's sidebars, e.g. thumbnails or comments */
  toggleSidebar(tabId: string, sidebarId: string, tab?: string) {
    const id = this.docIds.get(tabId);
    if (!id) return;
    const d = this.cap('ui').forDocument(id);
    const sidebar = d.getSchema().sidebars?.[sidebarId];
    if (!sidebar) return;
    const { placement, slot } = sidebar.position;
    if (tab && d.getActiveSidebar(placement, slot) === sidebarId) {
      if (d.getSidebarTab?.(sidebarId) !== tab) {
        d.setSidebarTab(sidebarId, tab);
        return;
      }
    }
    d.toggleSidebar(placement, slot, sidebarId, tab);
  }

  setTool(tabId: string, toolId: string | null) {
    const id = this.docIds.get(tabId);
    if (!id) return;
    this.cap('annotation').forDocument?.(id)?.setActiveTool?.(toolId) ??
      this.cap('annotation').setActiveTool(toolId);
  }

  pageInfo(tabId: string): PageInfo | null {
    const id = this.docIds.get(tabId);
    if (!id || !this.registry) return null;
    try {
      const s = this.cap('scroll').forDocument(id);
      return { current: s.getCurrentPage(), total: s.getTotalPages() };
    } catch {
      return null;
    }
  }

  goToPage(tabId: string, page: number) {
    const id = this.docIds.get(tabId);
    if (!id) return;
    this.cap('scroll').forDocument(id).scrollToPage({ pageNumber: page });
  }

  /** Current document bytes, including annotations made in the viewer */
  async exportBytes(tabId: string): Promise<ArrayBuffer | null> {
    const id = this.docIds.get(tabId);
    if (!id) return null;
    return this.cap('export').forDocument(id).saveAsCopy().toPromise();
  }
}
