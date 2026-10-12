/**
 * Themes viewers that tools embed in iframes (PDF.js viewer, annotation
 * viewer) to match Paperwing's light/dark Acrobat-style look.
 *
 * The viewers are vendored upstream builds under public/, so instead of
 * editing them we inject a stylesheet into each (same-origin) iframe document
 * and mirror the shell's theme onto the iframe's <html>:
 *   - data-theme="light|dark" only when the user overrides the system,
 *   - style.colorScheme set to the resolved theme (drives light-dark()),
 *   - PDF.js' own is-light / is-dark classes.
 */

import { getThemePref, isDark, onThemeChange } from './theme';
import pdfjsCss from './pdfjs-theme.css?url';
import annotationCss from './annotation-theme.css?url';
import font400 from './fonts/source-sans-3-latin-400-normal.woff2?url';
import font600 from './fonts/source-sans-3-latin-600-normal.woff2?url';
import font700 from './fonts/source-sans-3-latin-700-normal.woff2?url';

type ViewerKind = 'pdfjs' | 'annotation';

const LINK_ID = 'paperwing-frame-theme';
const FONT_ID = 'paperwing-frame-fonts';
const PREFS_KEY = 'pdfjs.preferences';

/** Iframes we already listen to */
const tracked = new WeakSet<HTMLIFrameElement>();
/** Iframe documents currently themed, re-themed on preference changes */
const themedDocs = new Set<Document>();

function viewerKind(iframe: HTMLIFrameElement): ViewerKind | null {
  const src = iframe.getAttribute('src') || '';
  let href = src;
  try {
    const loc = iframe.contentWindow?.location.href;
    if (loc && loc !== 'about:blank') href = loc;
  } catch {
    /* cross-origin: fall back to the src attribute */
  }
  if (href.includes('pdfjs-annotation-viewer')) return 'annotation';
  if (href.includes('pdfjs-viewer')) return 'pdfjs';
  return null;
}

function fontFaceCss(): string {
  return [
    [400, font400],
    [600, font600],
    [700, font700],
  ]
    .map(
      ([weight, url]) =>
        `@font-face{font-family:'Source Sans 3';font-style:normal;` +
        `font-weight:${weight};font-display:swap;` +
        `src:url('${new URL(String(url), location.href).href}') format('woff2');}`
    )
    .join('\n');
}

function applyThemeTo(doc: Document) {
  const root = doc.documentElement;
  if (!root) return;
  const pref = getThemePref();
  const dark = isDark(pref);
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.classList.toggle('is-dark', dark);
  root.classList.toggle('is-light', !dark);
}

/**
 * BentoPDF's signature colour picker samples the ink colour once when the
 * viewer starts. Keep it matching the themed ink unless the user picked one.
 */
function syncSignatureInk(doc: Document) {
  const picker = doc.getElementById(
    'signatureColorPicker'
  ) as HTMLInputElement | null;
  const input = doc.getElementById('addSignatureTypeInput');
  const dialog = doc.getElementById('addSignatureDialog');
  const win = doc.defaultView;
  if (!picker || !input || !win) return;
  if (dialog?.hasAttribute('data-signature-color')) return;
  const match = /rgba?\(([^)]+)\)/.exec(win.getComputedStyle(input).color);
  if (!match) return;
  const [r, g, b] = match[1].split(',').map((p) => parseFloat(p));
  if ([r, g, b].some((v) => Number.isNaN(v))) return;
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  picker.value = `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Injects fonts + theme stylesheet into an iframe document (idempotent) */
function themeDocument(doc: Document, kind: ViewerKind) {
  const head = doc.head;
  if (!head) return false;

  if (!doc.getElementById(FONT_ID)) {
    const style = doc.createElement('style');
    style.id = FONT_ID;
    style.textContent = fontFaceCss();
    head.appendChild(style);
  }

  if (!doc.getElementById(LINK_ID)) {
    const link = doc.createElement('link');
    link.id = LINK_ID;
    link.rel = 'stylesheet';
    link.href = new URL(
      kind === 'annotation' ? annotationCss : pdfjsCss,
      location.href
    ).href;
    if (kind === 'pdfjs') {
      link.addEventListener('load', () => syncSignatureInk(doc));
    }
    head.appendChild(link);
  }

  doc.documentElement.dataset.paperwingFrame = kind;
  applyThemeTo(doc);

  if (!themedDocs.has(doc)) {
    themedDocs.add(doc);
    doc.defaultView?.addEventListener('pagehide', () => themedDocs.delete(doc));
  }
  return true;
}

function frameDocument(iframe: HTMLIFrameElement): Document | null {
  try {
    return iframe.contentDocument;
  } catch {
    return null;
  }
}

/** Themes the iframe's current document if it is one of our viewers */
function tryTheme(iframe: HTMLIFrameElement): boolean {
  const kind = viewerKind(iframe);
  if (!kind) return false;
  const doc = frameDocument(iframe);
  if (!doc || doc.URL === 'about:blank') return false;
  return themeDocument(doc, kind);
}

/**
 * Polls briefly after a (re)navigation so the stylesheet lands while the
 * viewer is still parsing, avoiding a flash of the upstream colours. The
 * load listener remains the fallback.
 */
function watchNavigation(iframe: HTMLIFrameElement) {
  const started = performance.now();
  const initial = frameDocument(iframe);
  const tick = () => {
    if (!iframe.isConnected || performance.now() - started > 15000) return;
    const doc = frameDocument(iframe);
    if (doc && doc !== initial && doc.URL !== 'about:blank' && doc.head) {
      if (tryTheme(iframe)) return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function track(iframe: HTMLIFrameElement) {
  if (tracked.has(iframe)) return;
  tracked.add(iframe);
  iframe.addEventListener('load', () => tryTheme(iframe));
  watchNavigation(iframe);
}

function scan(root: Document | Element) {
  root.querySelectorAll('iframe').forEach((iframe) => {
    if (viewerKind(iframe)) track(iframe);
  });
}

/**
 * Keeps PDF.js' own theme preference in step (shared localStorage key).
 * 0 = follow system, 1 = light, 2 = dark. CSS stays the source of truth.
 */
function syncViewerPreference() {
  try {
    const pref = getThemePref();
    const raw = localStorage.getItem(PREFS_KEY);
    const prefs: Record<string, unknown> = raw ? JSON.parse(raw) : {};
    const value = pref === 'light' ? 1 : pref === 'dark' ? 2 : 0;
    if (prefs.viewerCssTheme === value) return;
    prefs.viewerCssTheme = value;
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable or malformed prefs: CSS still applies */
  }
}

export function initFrames(): void {
  syncViewerPreference();

  const start = () => {
    scan(document);
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') {
          const el = m.target as HTMLIFrameElement;
          if (el.tagName === 'IFRAME' && viewerKind(el)) {
            if (tracked.has(el)) watchNavigation(el);
            else track(el);
          }
          continue;
        }
        m.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.tagName === 'IFRAME') {
            const iframe = node as HTMLIFrameElement;
            if (viewerKind(iframe)) track(iframe);
          } else if (node.querySelector('iframe')) {
            scan(node);
          }
        });
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });
  };

  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });

  onThemeChange(() => {
    syncViewerPreference();
    for (const doc of themedDocs) {
      if (!doc.defaultView) {
        themedDocs.delete(doc);
        continue;
      }
      applyThemeTo(doc);
      if (doc.documentElement.dataset.paperwingFrame === 'pdfjs') {
        syncSignatureInk(doc);
      }
    }
  });
}
