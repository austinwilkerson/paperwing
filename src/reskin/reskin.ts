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

applyTheme();
onThemeChange(() => {});

const embedded = window.self !== window.top;

if (embedded) {
  document.documentElement.classList.add('rs-embedded');

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
}
