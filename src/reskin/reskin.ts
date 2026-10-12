/**
 * Runs on every upstream tool page. When the page is hosted inside the
 * desktop shell (app.html) it:
 *  - hides the standalone page chrome (navbar, footer, back button),
 *  - accepts files sent by the shell and feeds them to the tool's file input,
 *  - hands generated downloads back to the shell instead of saving them, so
 *    results can open as a new document tab.
 *
 * Message protocol (same-origin postMessage):
 *   shell -> tool  { type: 'acro:load-files', files: File[] }
 *   tool  -> shell { type: 'acro:ready' }
 *   tool  -> shell { type: 'acro:download', blob: Blob, name: string }
 */

import { applyTheme, onThemeChange } from './theme';
import { initApps } from './apps';
import { initFrames } from './frames';

/** Page id for page-specific styling, e.g. <html data-page="sign-pdf"> */
document.documentElement.dataset.page =
  (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '') ||
  'index';

applyTheme();
onThemeChange(() => {});
initApps();
initFrames();

const embedded = window.self !== window.top;

if (embedded) {
  document.documentElement.classList.add('rs-embedded');
  // The shell says whether this tool sits in the side panel or the
  // document area (?embed=panel|full)
  const mode = new URLSearchParams(location.search).get('embed');
  if (mode === 'full' || mode === 'panel') {
    document.documentElement.classList.add(`rs-${mode}`);
  }

  // downloadFile() and friends revoke the object URL right after click(), so
  // remember which blob each URL points to.
  const blobsByUrl = new Map<string, Blob>();
  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const url = createObjectURL(obj);
    if (obj instanceof Blob) blobsByUrl.set(url, obj);
    return url;
  };

  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    const blob = this.hasAttribute('download')
      ? blobsByUrl.get(this.href)
      : undefined;
    if (!blob) return nativeClick.call(this);
    window.parent.postMessage(
      {
        type: 'acro:download',
        blob,
        name: this.download || 'download',
      },
      location.origin
    );
  };

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    if (e.data?.type === 'acro:load-files') loadFiles(e.data.files as File[]);
  });

  // App-level shortcuts (Ctrl+S, Ctrl+W, Ctrl+Tab, F4...) still work while
  // focus is inside the tool: forward the ones the tool didn't handle.
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (!mod && !/^F\d{1,2}$/.test(e.key)) return;
    const t = e.target as HTMLElement | null;
    const editing =
      !!t &&
      (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    window.parent.postMessage(
      {
        type: 'acro:key',
        editing,
        key: {
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        },
      },
      location.origin
    );
    // Stop the browser acting on app shortcuts (e.g. Ctrl+P printing the tool)
    if (
      mod &&
      /^[spwofdklnqyh0-9=+\-]$/i.test(e.key) &&
      !(editing && /^[zyxcva]$/i.test(e.key))
    ) {
      e.preventDefault();
    }
  });

  const announceReady = () =>
    window.parent.postMessage({ type: 'acro:ready' }, location.origin);
  if (document.readyState === 'complete') announceReady();
  else window.addEventListener('load', announceReady);
}

function findFileInput(): HTMLInputElement | null {
  const byId = document.getElementById('file-input');
  if (byId instanceof HTMLInputElement && byId.type === 'file') return byId;
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="file"]')
  );
  return inputs.find((i) => /pdf/i.test(i.accept)) ?? inputs[0] ?? null;
}

function loadFiles(files: File[]) {
  const input = findFileInput();
  if (!input || !files.length) return;
  const dt = new DataTransfer();
  for (const f of input.multiple ? files : files.slice(0, 1)) dt.items.add(f);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  // The shell supplied the document: collapse the big drop zone
  document.documentElement.classList.add('rs-has-doc');
}
