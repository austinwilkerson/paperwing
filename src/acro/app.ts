/**
 * BentoPDF desktop shell: an Acrobat-style workspace (Home, All tools and
 * tabbed document views) around BentoPDF's viewer and tool pages.
 */
import '@phosphor-icons/web/duotone';
import { icon, toolIcon, type IconName } from './icons';
import {
  allToolGroups,
  convertTools,
  editTools,
  getTool,
  quickTools,
  recommendedTools,
  signTools,
  toolForFile,
  groups as catalogGroups,
  type AppTool,
  type ToolGroup,
} from './catalog';
import { Viewer, type PageInfo } from './viewer';
import {
  forgetRecent,
  listRecent,
  rememberFile,
  reopenRecent,
  updateRecent,
  type RecentFile,
} from './recent';

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, any> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function')
      el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;

function hydrateIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    if (el.querySelector(':scope > .ic')) return;
    el.prepend(icon(el.dataset.icon as IconName));
  });
  root.querySelectorAll<HTMLElement>('[data-icon-after]').forEach((el) => {
    if (el.querySelector(':scope > .ic')) return;
    el.append(icon(el.dataset.iconAfter as IconName, 16));
  });
}

function iconBtn(
  name: IconName,
  title: string,
  onClick: (e: MouseEvent) => void,
  cls = 'tb-btn'
) {
  return h(
    'button',
    { type: 'button', class: cls, title, 'aria-label': title, onClick },
    icon(name)
  );
}

function formatBytes(n: number) {
  if (!n) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 3);
  return `${(n / 1024 ** i).toFixed(i ? (n / 1024 ** i < 10 ? 1 : 0) : 0)} ${units[i]}`;
}

function formatOpened(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return `Today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

const isPdf = (f: { name: string; type?: string }) =>
  f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/* ------------------------------------------------------------------ */
/* Popovers & toasts                                                   */
/* ------------------------------------------------------------------ */

interface MenuItem {
  label?: string;
  shortcut?: string;
  icon?: Node;
  disabled?: boolean;
  divider?: boolean;
  onClick?: () => void;
}

let closePopover: (() => void) | null = null;

function showPopover(
  anchor: HTMLElement,
  content: HTMLElement,
  placement: 'below' | 'right' = 'below'
) {
  closePopover?.();
  const layer = $('#popover-layer');
  const pop = h('div', { class: 'popover' }, content);
  layer.append(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = placement === 'below' ? r.left : r.right + 6;
  let top = placement === 'below' ? r.bottom + 4 : r.top;
  left = Math.max(8, Math.min(left, innerWidth - pr.width - 8));
  top = Math.max(8, Math.min(top, innerHeight - pr.height - 8));
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  anchor.classList.add('is-open');

  const onDown = (e: Event) => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node))
      close();
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  const close = () => {
    pop.remove();
    anchor.classList.remove('is-open');
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    if (closePopover === close) closePopover = null;
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
  });
  closePopover = close;
  return pop;
}

function showMenu(
  anchor: HTMLElement,
  items: MenuItem[],
  placement?: 'below' | 'right'
) {
  const list = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it.divider) {
      list.append(h('div', { class: 'menu-div' }));
      continue;
    }
    list.append(
      h(
        'button',
        {
          type: 'button',
          class: 'menu-item',
          role: 'menuitem',
          disabled: it.disabled,
          onClick: () => {
            closePopover?.();
            it.onClick?.();
          },
        },
        h('span', { class: 'mi-icon' }, it.icon),
        h('span', { class: 'mi-label' }, it.label),
        it.shortcut && h('span', { class: 'mi-key' }, it.shortcut)
      )
    );
  }
  showPopover(anchor, list, placement);
}

function toast(
  message: string,
  action?: { label: string; onClick: () => void }
) {
  const el = h(
    'div',
    { class: 'toast', role: 'status' },
    h('span', {}, message),
    action &&
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            action.onClick();
            el.remove();
          },
        },
        action.label
      )
  );
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('is-leaving'), 4200);
  setTimeout(() => el.remove(), 4600);
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

type PanelKind = 'all' | 'edit' | 'convert' | 'sign';

interface FrameTool {
  tool: AppTool;
  frame: HTMLIFrameElement;
  el: HTMLElement;
  files: File[];
}

interface DocTab {
  kind: 'doc';
  id: string;
  name: string;
  handle?: FileSystemFileHandle;
  recentId?: string;
  starred: boolean;
  loading: boolean;
  panel: PanelKind;
  panelOpen: boolean;
  /** container inside #left-panel */
  panelEl: HTMLElement;
  panelTool?: FrameTool;
  fullTool?: FrameTool;
  page: PageInfo;
  activeAnnot: string | null;
}

interface ToolTab {
  kind: 'tool';
  id: string;
  name: string;
  tool: FrameTool;
}

interface AllToolsTab {
  kind: 'alltools';
  id: 'alltools';
  name: string;
}

type Tab = DocTab | ToolTab | AllToolsTab;

const tabs: Tab[] = [];
let activeId = 'home';
let lastDocId: string | null = null;
let tabSeq = 0;

const viewer = new Viewer($('#viewer-host'));
const activeTab = () => tabs.find((t) => t.id === activeId);
const activeDoc = () => {
  const t = activeTab();
  return t?.kind === 'doc' ? t : undefined;
};

/* ------------------------------------------------------------------ */
/* Title bar & tabs                                                    */
/* ------------------------------------------------------------------ */

function renderTabs() {
  const strip = $('#tabs');
  strip.replaceChildren(
    ...tabs.map((t) => {
      const el = h(
        'div',
        {
          class: `tab${t.id === activeId ? ' is-active' : ''}`,
          role: 'tab',
          'aria-selected': String(t.id === activeId),
          title: t.name,
          onMousedown: (e: MouseEvent) => {
            if (e.button === 1) {
              e.preventDefault();
              closeTab(t.id);
            }
          },
          onClick: () => activate(t.id),
        },
        t.kind === 'doc'
          ? h(
              'button',
              {
                type: 'button',
                class: `tab-star${t.starred ? ' is-on' : ''}`,
                title: t.starred ? 'Unstar' : 'Star',
                'aria-label': 'Star',
                onClick: (e: MouseEvent) => {
                  e.stopPropagation();
                  toggleStar(t);
                },
              },
              icon('star', 14)
            )
          : t.kind === 'alltools'
            ? h('span', { class: 'tab-glyph' }, icon('grid', 14))
            : h(
                'span',
                { class: 'tab-glyph' },
                toolIcon(t.tool.tool.icon, t.tool.tool.color, 14)
              ),
        h('span', { class: 'tab-label' }, t.name),
        iconBtn(
          'close',
          'Close tab',
          (e) => {
            e.stopPropagation();
            closeTab(t.id);
          },
          'tab-close'
        )
      );
      return el;
    })
  );
  $('#home-btn').classList.toggle('is-active', activeId === 'home');
  strip
    .querySelector('.tab.is-active')
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function activate(id: string) {
  closePopover?.();
  activeId = id;
  const tab = activeTab();
  if (tab?.kind === 'doc') lastDocId = tab.id;

  document
    .querySelectorAll<HTMLElement>('.view')
    .forEach((v) => v.classList.remove('is-active'));
  const viewId =
    id === 'home'
      ? 'view-home'
      : tab?.kind === 'alltools'
        ? 'view-alltools'
        : tab?.kind === 'tool'
          ? 'view-tool'
          : 'view-doc';
  $(`#${viewId}`).classList.add('is-active');

  // Per-tab frames stay in the DOM (detaching an iframe reloads it)
  document.querySelectorAll<HTMLElement>('[data-owner]').forEach((el) => {
    el.hidden = el.dataset.owner !== id;
  });

  if (id === 'home') refreshRecent();
  if (tab?.kind === 'alltools') $<HTMLInputElement>('#alltools-search').focus();
  if (tab?.kind === 'doc') {
    void viewer.activate(tab.id);
    renderDocChrome(tab);
  }
  renderTabs();
  document.title = tab ? `${tab.name} - BentoPDF` : 'BentoPDF';
}

function closeTab(id: string) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const tab = tabs[i];
  tabs.splice(i, 1);
  document
    .querySelectorAll(`[data-owner="${CSS.escape(id)}"]`)
    .forEach((el) => el.remove());
  if (tab.kind === 'doc') viewer.close(tab.id);
  if (lastDocId === id) lastDocId = null;
  if (activeId === id) {
    const next = tabs[Math.min(i, tabs.length - 1)];
    activate(next ? next.id : 'home');
  } else {
    renderTabs();
  }
}

async function toggleStar(tab: DocTab) {
  tab.starred = !tab.starred;
  if (tab.recentId) await updateRecent(tab.recentId, { starred: tab.starred });
  renderTabs();
}

/* ------------------------------------------------------------------ */
/* Opening files                                                       */
/* ------------------------------------------------------------------ */

async function pickFiles(): Promise<
  { file: File; handle?: FileSystemFileHandle }[]
> {
  const picker = (window as any).showOpenFilePicker;
  if (picker) {
    try {
      const handles: FileSystemFileHandle[] = await picker({
        multiple: true,
        types: [
          { description: 'PDF files', accept: { 'application/pdf': ['.pdf'] } },
        ],
      });
      return Promise.all(
        handles.map(async (handle) => ({
          file: await handle.getFile(),
          handle,
        }))
      );
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return [];
    }
  }
  const input = $<HTMLInputElement>('#open-input');
  input.value = '';
  return new Promise((resolve) => {
    input.onchange = () =>
      resolve(Array.from(input.files ?? []).map((file) => ({ file })));
    input.click();
  });
}

async function openFromDialog() {
  for (const { file, handle } of await pickFiles())
    await openDocument(file, handle);
}

async function openDocument(
  file: File,
  handle?: FileSystemFileHandle,
  recentId?: string
) {
  const id = `doc-${++tabSeq}`;
  const panelEl = h('div', { class: 'lp', dataset: { owner: id } });
  $('#left-panel').append(panelEl);
  const tab: DocTab = {
    kind: 'doc',
    id,
    name: file.name,
    handle,
    recentId,
    starred: false,
    loading: true,
    panel: 'all',
    panelOpen: true,
    panelEl,
    page: { current: 1, total: 0 },
    activeAnnot: null,
  };
  tabs.push(tab);
  activate(id);

  try {
    await viewer.open(id, await file.arrayBuffer());
  } catch (err) {
    console.error(err);
    toast(`Couldn't open ${file.name}`);
    closeTab(id);
    return;
  }
  tab.loading = false;
  tab.page = viewer.pageInfo(id) ?? tab.page;
  if (activeId === id) renderDocChrome(tab);

  tab.recentId = (await rememberFile(file, handle)) ?? recentId;
  const entry = (await listRecent()).find((r) => r.id === tab.recentId);
  if (entry?.starred) {
    tab.starred = true;
    renderTabs();
  }
}

async function openFiles(files: File[]) {
  const pdfs = files.filter(isPdf);
  const others = files.filter((f) => !isPdf(f));
  for (const f of pdfs) await openDocument(f);
  if (others.length) {
    const tool = toolForFile(others[0]) ?? getTool('image-to-pdf');
    if (tool) openToolTab(tool, others);
  }
}

/* ------------------------------------------------------------------ */
/* Tool frames                                                         */
/* ------------------------------------------------------------------ */

const frameTools = new Set<FrameTool>();

function createFrameTool(
  tool: AppTool,
  files: File[],
  owner: string
): FrameTool {
  const frame = h('iframe', {
    class: 'tool-frame',
    src: tool.href,
    title: tool.name,
  });
  const ft: FrameTool = {
    tool,
    frame,
    files,
    el: h('div', { class: 'frame-wrap' }, frame),
  };
  ft.el.dataset.owner = owner;
  frameTools.add(ft);
  return ft;
}

function disposeFrameTool(ft?: FrameTool) {
  if (!ft) return;
  frameTools.delete(ft);
  ft.el.remove();
}

window.addEventListener('message', async (e: MessageEvent) => {
  if (e.origin !== location.origin) return;
  const ft = [...frameTools].find((t) => t.frame.contentWindow === e.source);
  if (!ft) return;
  if (e.data?.type === 'acro:ready' && ft.files.length) {
    ft.frame.contentWindow!.postMessage(
      { type: 'acro:load-files', files: ft.files },
      location.origin
    );
  } else if (e.data?.type === 'acro:download') {
    const blob = e.data.blob as Blob;
    const name = uniqueTabName(String(e.data.name || 'download'));
    if (isPdf({ name, type: blob.type })) {
      await openDocument(new File([blob], name, { type: 'application/pdf' }));
      toast(`Opened ${name} in a new tab`, {
        label: 'Download',
        onClick: () => saveBlob(blob, name),
      });
    } else {
      saveBlob(blob, name);
      toast(`Saved ${name}`);
    }
  }
});

/** "report.pdf" -> "report (1).pdf" if a tab already uses that name */
function uniqueTabName(name: string) {
  const taken = new Set(tabs.map((t) => t.name));
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const [base, ext] =
    dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let i = 1; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function openToolTab(tool: AppTool, files: File[] = []) {
  if (!tool.href) return;
  const id = `tool-${++tabSeq}`;
  const ft = createFrameTool(tool, files, id);
  const view = $('#view-tool');
  const wrap = h(
    'div',
    { class: 'tool-tab', dataset: { owner: id } },
    h(
      'div',
      { class: 'tool-head' },
      toolIcon(tool.icon, tool.color, 22),
      h('h1', {}, tool.name),
      h(
        'button',
        { type: 'button', class: 'pill-btn', onClick: () => closeTab(id) },
        'Close'
      )
    ),
    ft.el
  );
  ft.el.removeAttribute('data-owner');
  view.append(wrap);
  tabs.push({ kind: 'tool', id, name: tool.name, tool: ft });
  activate(id);
}

/** Run a tool against the open document (side panel or full area) */
async function openToolOnDoc(tab: DocTab, tool: AppTool) {
  if (tool.action) return runViewerAction(tab, tool);
  if (!tool.href) return;
  if (tab.loading) return toast('The document is still loading…');

  const bytes = await viewer.exportBytes(tab.id);
  const files = bytes
    ? [new File([bytes], tab.name, { type: 'application/pdf' })]
    : [];

  if (tool.full) {
    disposeFrameTool(tab.fullTool);
    const ft = createFrameTool(tool, files, tab.id);
    const head = h(
      'div',
      { class: 'full-head' },
      toolIcon(tool.icon, tool.color, 20),
      h('span', { class: 'fh-title' }, tool.name),
      h('span', { class: 'fh-file' }, tab.name),
      h(
        'button',
        {
          type: 'button',
          class: 'pill-btn',
          onClick: () => closeFullTool(tab),
        },
        'Close'
      )
    );
    ft.el.prepend(head);
    $('#tool-full').append(ft.el);
    tab.fullTool = ft;
  } else {
    disposeFrameTool(tab.panelTool);
    tab.panelTool = createFrameTool(tool, files, tab.id);
    tab.panelTool.el.removeAttribute('data-owner');
    tab.panelOpen = true;
  }
  renderDocChrome(tab);
}

function closeFullTool(tab: DocTab) {
  disposeFrameTool(tab.fullTool);
  tab.fullTool = undefined;
  renderDocChrome(tab);
}

function runViewerAction(tab: DocTab, tool: AppTool) {
  if (tool.action === 'comment') {
    viewer.toggleSidebar(tab.id, 'comment-panel');
    if (tab.activeAnnot !== 'comment') setAnnot(tab, 'comment');
  } else if (tool.action === 'redact') {
    viewer.command(tab.id, 'redaction:redact');
    viewer.toggleSidebar(tab.id, 'redaction-panel');
  } else if (tool.action === 'find') {
    viewer.command(tab.id, 'panel:toggle-search');
  }
}

/* ------------------------------------------------------------------ */
/* Document view                                                       */
/* ------------------------------------------------------------------ */

function panelGroups(kind: PanelKind): ToolGroup[] {
  switch (kind) {
    case 'edit':
      return editTools();
    case 'convert':
      return convertTools();
    case 'sign':
      return signTools();
    default:
      return [{ name: 'All tools', tools: quickTools() }];
  }
}

const PANEL_TITLES: Record<PanelKind, string> = {
  all: 'All tools',
  edit: 'Edit',
  convert: 'Convert',
  sign: 'E-Sign',
};

function renderLeftPanel(tab: DocTab) {
  const el = tab.panelEl;
  $('#left-panel').classList.toggle('is-closed', !tab.panelOpen);
  $('#left-panel').classList.toggle('has-tool', !!tab.panelTool);

  if (tab.panelTool) {
    const t = tab.panelTool.tool;
    const head = h(
      'div',
      { class: 'lp-head lp-head-tool' },
      iconBtn('arrowLeft', 'Back to tools', () => {
        disposeFrameTool(tab.panelTool);
        tab.panelTool = undefined;
        renderLeftPanel(tab);
      }),
      h('span', { class: 'lp-title' }, t.name),
      iconBtn('expand', 'Open in full view', () => {
        disposeFrameTool(tab.panelTool);
        tab.panelTool = undefined;
        void openToolOnDoc(tab, { ...t, full: true });
      })
    );
    if (!el.contains(tab.panelTool.el)) {
      el.replaceChildren(head, tab.panelTool.el);
    } else {
      el.firstElementChild?.replaceWith(head);
    }
    return;
  }

  const head = h(
    'div',
    { class: 'lp-head' },
    h('span', { class: 'lp-title' }, PANEL_TITLES[tab.panel]),
    iconBtn('close', 'Close panel', () => {
      tab.panelOpen = false;
      renderDocChrome(tab);
    })
  );
  const body = h('div', { class: 'lp-body' });
  const lists = panelGroups(tab.panel);
  for (const g of lists) {
    if (lists.length > 1) body.append(h('div', { class: 'lp-group' }, g.name));
    for (const tool of g.tools) {
      body.append(
        h(
          'button',
          {
            type: 'button',
            class: 'lp-tool',
            title: tool.desc,
            onClick: () => {
              if (tab.panel === 'all' && tool.id === 'pdf-to-docx') {
                tab.panel = 'convert';
                return renderDocChrome(tab);
              }
              if (tab.panel === 'all' && tool.id === 'image-to-pdf') {
                return openToolTab(tool);
              }
              void openToolOnDoc(tab, tool);
            },
          },
          toolIcon(tool.icon, tool.color, 20),
          h('span', {}, tool.name)
        )
      );
    }
  }
  if (tab.panel === 'all') {
    body.append(
      h(
        'button',
        { type: 'button', class: 'lp-more', onClick: openAllTools },
        'View more'
      )
    );
  }
  el.replaceChildren(head, body);
}

function renderDocChrome(tab: DocTab) {
  if (activeId !== tab.id) return;
  document
    .querySelectorAll<HTMLButtonElement>('#gb-tabs button')
    .forEach((b) =>
      b.classList.toggle(
        'is-active',
        tab.panelOpen && b.dataset.panel === tab.panel
      )
    );
  renderLeftPanel(tab);
  $('#doc-stage').classList.toggle('has-full-tool', !!tab.fullTool);
  $('#doc-stage').classList.toggle('is-loading', tab.loading);
  renderQuickbar(tab);
  renderRightRail(tab);
}

$('#gb-tabs').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
    'button[data-panel]'
  );
  const tab = activeDoc();
  if (!btn || !tab) return;
  const kind = btn.dataset.panel as PanelKind;
  if (tab.panelOpen && tab.panel === kind && !tab.panelTool) {
    tab.panelOpen = false;
  } else {
    tab.panel = kind;
    tab.panelOpen = true;
    disposeFrameTool(tab.panelTool);
    tab.panelTool = undefined;
  }
  renderDocChrome(tab);
});

/* Quick action toolbar ------------------------------------------------ */

const ANNOT_TOOLS: {
  id: string;
  icon: IconName;
  title: string;
  command?: string;
}[] = [
  { id: 'select', icon: 'select', title: 'Select' },
  {
    id: 'comment',
    icon: 'comment',
    title: 'Add a comment',
    command: 'annotation:add-comment',
  },
  {
    id: 'highlight',
    icon: 'highlight',
    title: 'Highlight text',
    command: 'annotation:add-highlight',
  },
  {
    id: 'ink',
    icon: 'draw',
    title: 'Draw freehand',
    command: 'annotation:add-ink',
  },
  {
    id: 'text',
    icon: 'text',
    title: 'Add text',
    command: 'annotation:add-text',
  },
  { id: 'sign', icon: 'sign', title: 'Fill & Sign' },
];

/** viewer annotation tool id -> quick toolbar button that activated it */
const buttonForTool = new Map<string, string>();
let pendingButton: string | null = null;

function runAnnotCommand(tab: DocTab, button: string, command: string) {
  pendingButton = button;
  viewer.command(tab.id, command);
}

function setAnnot(tab: DocTab, id: string) {
  const def = ANNOT_TOOLS.find((t) => t.id === id);
  if (id === 'sign') {
    const tool = getTool('sign-pdf');
    if (tool) void openToolOnDoc(tab, { ...tool, name: 'Fill & Sign' });
    return;
  }
  if (id === 'select' || tab.activeAnnot === id) {
    viewer.setTool(tab.id, null);
  } else if (def?.command) {
    runAnnotCommand(tab, id, def.command);
  }
}

viewer.onActiveTool((tabId, toolId) => {
  const tab = tabs.find((t) => t.id === tabId);
  if (tab?.kind !== 'doc') return;
  if (toolId && pendingButton) buttonForTool.set(toolId, pendingButton);
  pendingButton = null;
  tab.activeAnnot = toolId ? (buttonForTool.get(toolId) ?? 'more') : null;
  if (activeId === tabId) renderQuickbar(tab);
});

const MORE_ANNOTS: { label: string; command: string }[] = [
  { label: 'Underline', command: 'annotation:add-underline' },
  { label: 'Strikethrough', command: 'annotation:add-strikeout' },
  { label: 'Squiggly underline', command: 'annotation:add-squiggly' },
  { label: 'Highlighter pen', command: 'annotation:add-ink-highlighter' },
  { label: 'Text callout', command: 'annotation:add-callout' },
  { label: 'Rectangle', command: 'annotation:add-rectangle' },
  { label: 'Oval', command: 'annotation:add-circle' },
  { label: 'Line', command: 'annotation:add-line' },
  { label: 'Arrow', command: 'annotation:add-arrow' },
  { label: 'Polygon', command: 'annotation:add-polygon' },
  { label: 'Stamp', command: 'annotation:add-stamp' },
];

function renderQuickbar(tab: DocTab) {
  const bar = $('#quickbar');
  const grip = h('div', { class: 'qb-grip', title: 'Drag to move' });
  const buttons = ANNOT_TOOLS.map((t) =>
    h(
      'button',
      {
        type: 'button',
        class: `qb-btn${(tab.activeAnnot ?? 'select') === t.id ? ' is-active' : ''}`,
        title: t.title,
        'aria-label': t.title,
        onClick: () => setAnnot(tab, t.id),
      },
      icon(t.icon, 18)
    )
  );
  const more = h(
    'button',
    {
      type: 'button',
      class: `qb-btn${tab.activeAnnot === 'more' ? ' is-active' : ''}`,
      title: 'More tools',
      'aria-label': 'More tools',
    },
    icon('more', 18)
  );
  more.addEventListener('click', () =>
    showMenu(
      more,
      [
        ...MORE_ANNOTS.map((m) => ({
          label: m.label,
          onClick: () => runAnnotCommand(tab, 'more', m.command),
        })),
        { divider: true },
        {
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          icon: icon('undo', 16),
          onClick: () => viewer.command(tab.id, 'history:undo'),
        },
        {
          label: 'Redo',
          shortcut: 'Ctrl+Y',
          icon: icon('redo', 16),
          onClick: () => viewer.command(tab.id, 'history:redo'),
        },
        {
          label: 'Delete selected',
          shortcut: 'Del',
          icon: icon('trash', 16),
          onClick: () => viewer.command(tab.id, 'annotation:delete-selected'),
        },
      ],
      'right'
    )
  );
  bar.replaceChildren(grip, ...buttons, more);
  makeDraggable(bar, grip);
}

function makeDraggable(el: HTMLElement, handle: HTMLElement) {
  handle.onpointerdown = (e) => {
    const stage = el.parentElement!.getBoundingClientRect();
    const start = el.getBoundingClientRect();
    const dx = e.clientX - start.left;
    const dy = e.clientY - start.top;
    handle.setPointerCapture(e.pointerId);
    handle.onpointermove = (m) => {
      const x = Math.max(
        4,
        Math.min(m.clientX - dx - stage.left, stage.width - start.width - 4)
      );
      const y = Math.max(
        4,
        Math.min(m.clientY - dy - stage.top, stage.height - start.height - 4)
      );
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };
    handle.onpointerup = () => {
      handle.onpointermove = null;
      handle.onpointerup = null;
    };
  };
}

/* Right rail ----------------------------------------------------------- */

function renderRightRail(tab: DocTab) {
  const rail = $('#right-rail');
  const top = h(
    'div',
    { class: 'rr-top' },
    iconBtn(
      'comments',
      'Comments',
      () => viewer.toggleSidebar(tab.id, 'comment-panel'),
      'rr-btn'
    ),
    iconBtn(
      'bookmark',
      'Bookmarks',
      () => viewer.toggleSidebar(tab.id, 'sidebar-panel', 'outline'),
      'rr-btn'
    ),
    iconBtn(
      'thumbnails',
      'Page thumbnails',
      () => viewer.toggleSidebar(tab.id, 'sidebar-panel', 'thumbnails'),
      'rr-btn'
    ),
    iconBtn(
      'search',
      'Find text',
      () => viewer.command(tab.id, 'panel:toggle-search'),
      'rr-btn'
    )
  );
  const pageInput = h('input', {
    class: 'rr-page',
    value: String(tab.page.current || 1),
    'aria-label': 'Page number',
    inputmode: 'numeric',
  });
  pageInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const n = parseInt(pageInput.value, 10);
    if (n >= 1 && n <= tab.page.total) viewer.goToPage(tab.id, n);
    pageInput.blur();
  });
  const bottom = h(
    'div',
    { class: 'rr-bottom' },
    pageInput,
    h('div', { class: 'rr-total' }, String(tab.page.total || '–')),
    iconBtn(
      'chevronUp',
      'Previous page',
      () => viewer.command(tab.id, 'scroll:previous-page'),
      'rr-btn'
    ),
    iconBtn(
      'chevronDown',
      'Next page',
      () => viewer.command(tab.id, 'scroll:next-page'),
      'rr-btn'
    ),
    h('div', { class: 'rr-div' }),
    iconBtn(
      'rotate',
      'Rotate view',
      () => viewer.command(tab.id, 'rotate:clockwise'),
      'rr-btn'
    ),
    iconBtn(
      'zoomIn',
      'Zoom in',
      () => viewer.command(tab.id, 'zoom:in'),
      'rr-btn'
    ),
    iconBtn(
      'zoomOut',
      'Zoom out',
      () => viewer.command(tab.id, 'zoom:out'),
      'rr-btn'
    )
  );
  rail.replaceChildren(top, bottom);
}

viewer.onPage((tabId, info) => {
  const tab = tabs.find((t) => t.id === tabId);
  if (tab?.kind !== 'doc') return;
  tab.page = info;
  if (activeId === tabId) {
    const input = $<HTMLInputElement>('#right-rail .rr-page');
    if (input && document.activeElement !== input)
      input.value = String(info.current);
    const total = $('#right-rail .rr-total');
    if (total) total.textContent = String(info.total);
  }
});

/* Save / print / download / find -------------------------------------- */

async function docBlob(tab: DocTab): Promise<Blob | null> {
  const bytes = await viewer.exportBytes(tab.id);
  return bytes ? new Blob([bytes], { type: 'application/pdf' }) : null;
}

async function saveDoc(tab: DocTab, saveAs = false) {
  const blob = await docBlob(tab);
  if (!blob) return;
  let handle = saveAs ? undefined : tab.handle;
  const savePicker = (window as any).showSaveFilePicker;
  try {
    if (!handle && savePicker) {
      handle = await savePicker({
        suggestedName: tab.name,
        types: [
          { description: 'PDF file', accept: { 'application/pdf': ['.pdf'] } },
        ],
      });
    }
    if (handle) {
      const h2 = handle as any;
      if ((await h2.queryPermission?.({ mode: 'readwrite' })) !== 'granted') {
        await h2.requestPermission?.({ mode: 'readwrite' });
      }
      const w = await h2.createWritable();
      await w.write(blob);
      await w.close();
      tab.handle = handle;
      tab.name = handle.name;
      renderTabs();
      toast(`Saved ${handle.name}`);
      return;
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return;
    console.error(e);
  }
  saveBlob(blob, tab.name);
}

$('#save-btn').addEventListener('click', () => {
  const t = activeDoc();
  if (t) void saveDoc(t);
});
$('#print-btn').addEventListener('click', () => {
  const t = activeDoc();
  if (t) viewer.command(t.id, 'document:print');
});
$('#download-btn').addEventListener('click', async () => {
  const t = activeDoc();
  const blob = t && (await docBlob(t));
  if (t && blob) saveBlob(blob, t.name);
});

function searchTools(q: string): AppTool[] {
  const query = q.trim().toLowerCase();
  const seen = new Set<string>();
  const out: AppTool[] = [];
  for (const g of allToolGroups()) {
    for (const t of g.tools) {
      if (seen.has(t.id)) continue;
      if (!query || `${t.name} ${t.desc}`.toLowerCase().includes(query)) {
        seen.add(t.id);
        out.push(t);
      }
    }
  }
  return out;
}

function openFind(anchor: HTMLElement) {
  const tab = activeDoc();
  const input = h('input', {
    type: 'search',
    class: 'find-input',
    placeholder: 'Find text or tools',
  });
  const results = h('div', { class: 'find-results' });
  const render = () => {
    const q = input.value.trim();
    const items: HTMLElement[] = [];
    if (tab && q) {
      items.push(
        h(
          'button',
          {
            type: 'button',
            class: 'menu-item',
            onClick: () => {
              closePopover?.();
              viewer.command(tab.id, 'panel:toggle-search');
            },
          },
          h('span', { class: 'mi-icon' }, icon('search', 16)),
          h('span', { class: 'mi-label' }, `Find “${q}” in document`)
        )
      );
    }
    items.push(h('div', { class: 'find-head' }, 'Tools'));
    for (const t of searchTools(q).slice(0, 8)) {
      items.push(
        h(
          'button',
          {
            type: 'button',
            class: 'menu-item',
            onClick: () => {
              closePopover?.();
              runTool(t);
            },
          },
          h('span', { class: 'mi-icon' }, toolIcon(t.icon, t.color, 18)),
          h('span', { class: 'mi-label' }, t.name)
        )
      );
    }
    results.replaceChildren(...items);
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')
      results.querySelector<HTMLButtonElement>('.menu-item')?.click();
  });
  render();
  showPopover(anchor, h('div', { class: 'find-pop' }, input, results));
  input.focus();
}

$('#find-btn').addEventListener('click', (e) =>
  openFind(e.currentTarget as HTMLElement)
);

/** Open a tool on the current document if there is one, else in its own tab */
function runTool(tool: AppTool) {
  const doc =
    activeDoc() ??
    (lastDocId ? (tabs.find((t) => t.id === lastDocId) as DocTab) : undefined);
  if (
    doc &&
    (tool.action ||
      !catalogGroups
        .find((g) => g.name === 'Create a PDF')
        ?.tools.includes(tool))
  ) {
    activate(doc.id);
    void openToolOnDoc(doc, tool);
  } else if (tool.action) {
    toast('Open a PDF first to use this tool');
  } else {
    openToolTab(tool);
  }
}

/* ------------------------------------------------------------------ */
/* All tools view                                                      */
/* ------------------------------------------------------------------ */

function openAllTools() {
  if (!tabs.find((t) => t.id === 'alltools')) {
    tabs.push({ kind: 'alltools', id: 'alltools', name: 'All tools' });
  }
  activate('alltools');
}

function renderAllTools() {
  const q = $<HTMLInputElement>('#alltools-search').value.trim();
  const container = $('#alltools-groups');
  const groups: ToolGroup[] = q
    ? [{ name: 'Results', tools: searchTools(q) }]
    : allToolGroups();
  container.replaceChildren(
    ...groups
      .filter((g) => g.tools.length)
      .map((g) =>
        h(
          'section',
          { class: 'at-group' },
          h('h2', {}, g.name),
          h(
            'div',
            { class: 'at-grid' },
            ...g.tools.map((t) => {
              const more = iconBtn(
                'more',
                'More options',
                () =>
                  showMenu(more, [
                    { label: 'Open', onClick: () => runTool(t) },
                    ...(t.href
                      ? [
                          {
                            label: 'Open in a new tab',
                            onClick: () => openToolTab(t),
                          },
                        ]
                      : []),
                  ]),
                'sq-btn'
              );
              return h(
                'div',
                { class: 'at-item', title: t.desc },
                toolIcon(t.icon, t.color, 40),
                h('div', { class: 'at-name' }, t.name),
                h(
                  'div',
                  { class: 'at-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'sm-btn',
                      onClick: () => runTool(t),
                    },
                    'Open'
                  ),
                  more
                )
              );
            })
          )
        )
      )
  );
  if (q && !groups[0].tools.length) {
    container.append(h('p', { class: 'at-empty' }, `No tools match “${q}”.`));
  }
}

$('#alltools-search').addEventListener('input', renderAllTools);
$('#alltools-close').addEventListener('click', () => closeTab('alltools'));

/* ------------------------------------------------------------------ */
/* Home view                                                           */
/* ------------------------------------------------------------------ */

let homeTab: 'recent' | 'starred' = 'recent';
let homeLayout: 'list' | 'grid' = 'list';

function renderRecommended() {
  $('#rec-tools').replaceChildren(
    ...recommendedTools().map((t) =>
      h(
        'button',
        { type: 'button', class: 'rec-card', onClick: () => runTool(t) },
        h(
          'span',
          { class: 'rec-ic', style: `--c:${t.color}` },
          toolIcon(t.icon, t.color, 26)
        ),
        h('span', { class: 'rec-name' }, t.name),
        h('span', { class: 'rec-desc' }, t.desc),
        h('span', { class: 'rec-use' }, 'Use now')
      )
    )
  );
}

async function openRecent(entry: RecentFile) {
  const got = await reopenRecent(entry);
  if (!got) {
    toast(`${entry.name} is no longer available`, {
      label: 'Remove',
      onClick: async () => {
        await forgetRecent(entry.id);
        void refreshRecent();
      },
    });
    return;
  }
  await openDocument(got.file, got.handle, entry.id);
}

async function refreshRecent() {
  const q = $<HTMLInputElement>('#home-search').value.trim().toLowerCase();
  let items = await listRecent();
  if (homeTab === 'starred') items = items.filter((r) => r.starred);
  if (q) items = items.filter((r) => r.name.toLowerCase().includes(q));
  $('#recent-title').textContent = homeTab === 'starred' ? 'Starred' : 'Recent';

  const list = $('#recent-list');
  list.classList.toggle('is-grid', homeLayout === 'grid');
  if (!items.length) {
    list.replaceChildren(
      h(
        'div',
        { class: 'recent-empty' },
        homeTab === 'starred'
          ? 'Star a file from its tab to see it here.'
          : q
            ? 'No files match your search.'
            : 'Files you open will show up here.'
      )
    );
    return;
  }

  const rows = items.map((r) => {
    const star = iconBtn(
      'star',
      r.starred ? 'Unstar' : 'Star',
      async (e) => {
        e.stopPropagation();
        await updateRecent(r.id, { starred: !r.starred });
        tabs.forEach((t) => {
          if (t.kind === 'doc' && t.recentId === r.id) t.starred = !r.starred;
        });
        renderTabs();
        void refreshRecent();
      },
      `row-star${r.starred ? ' is-on' : ''}`
    );
    const remove = iconBtn(
      'close',
      'Remove from recent',
      async (e) => {
        e.stopPropagation();
        await forgetRecent(r.id);
        void refreshRecent();
      },
      'row-remove'
    );
    return h(
      'div',
      {
        class: 'recent-row',
        role: 'button',
        tabindex: '0',
        onClick: () => openRecent(r),
        onKeydown: (e: KeyboardEvent) => e.key === 'Enter' && openRecent(r),
      },
      h('span', { class: 'rr-file' }, h('span', { class: 'pdf-glyph' }, 'PDF')),
      h(
        'span',
        { class: 'rr-name' },
        h('span', { class: 'rr-title' }, r.name),
        h('span', { class: 'rr-kind' }, 'PDF')
      ),
      h('span', { class: 'rr-opened' }, formatOpened(r.openedAt)),
      h('span', { class: 'rr-size' }, formatBytes(r.size)),
      h('span', { class: 'rr-acts' }, star, remove)
    );
  });

  list.replaceChildren(
    h(
      'div',
      { class: 'recent-row recent-header' },
      h('span', {}),
      h('span', {}, 'NAME'),
      h('span', {}, 'OPENED'),
      h('span', {}, 'SIZE'),
      h('span', {})
    ),
    ...rows
  );
}

document.querySelectorAll<HTMLButtonElement>('[data-home-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    homeTab = b.dataset.homeTab as typeof homeTab;
    document
      .querySelectorAll('[data-home-tab]')
      .forEach((x) => x.classList.toggle('is-active', x === b));
    void refreshRecent();
  })
);
document.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach((b) =>
  b.addEventListener('click', () => {
    homeLayout = b.dataset.layout as typeof homeLayout;
    document
      .querySelectorAll('[data-layout]')
      .forEach((x) => x.classList.toggle('is-active', x === b));
    void refreshRecent();
  })
);
$('#home-search').addEventListener('input', () => void refreshRecent());
$('#home-select').addEventListener('click', openFromDialog);
$('#open-computer').addEventListener('click', openFromDialog);
$('#see-all-tools').addEventListener('click', openAllTools);

/* ------------------------------------------------------------------ */
/* Title bar menus                                                     */
/* ------------------------------------------------------------------ */

function createMenuItems(): MenuItem[] {
  const ids = [
    'image-to-pdf',
    'word-to-pdf',
    'excel-to-pdf',
    'powerpoint-to-pdf',
    'txt-to-pdf',
    'markdown-to-pdf',
    'email-to-pdf',
  ];
  const labels: Record<string, string> = {
    'image-to-pdf': 'From images',
    'word-to-pdf': 'From Word',
    'excel-to-pdf': 'From Excel',
    'powerpoint-to-pdf': 'From PowerPoint',
    'txt-to-pdf': 'From text',
    'markdown-to-pdf': 'From Markdown',
    'email-to-pdf': 'From email',
  };
  return [
    ...ids.map((id) => {
      const t = getTool(id)!;
      return {
        label: labels[id],
        icon: toolIcon(t.icon, t.color, 18),
        onClick: () => openToolTab(t),
      };
    }),
    { divider: true },
    {
      label: 'More formats…',
      onClick: () => {
        openAllTools();
        const input = $<HTMLInputElement>('#alltools-search');
        input.value = 'to PDF';
        renderAllTools();
      },
    },
  ];
}

$('#create-btn').addEventListener('click', (e) =>
  showMenu(e.currentTarget as HTMLElement, createMenuItems())
);

function closeAllTabs() {
  [...tabs].forEach((t) => closeTab(t.id));
}

$('#menu-btn').addEventListener('click', (e) => {
  const doc = activeDoc();
  showMenu(e.currentTarget as HTMLElement, [
    {
      label: 'Open…',
      shortcut: 'Ctrl+O',
      icon: icon('folder', 16),
      onClick: openFromDialog,
    },
    {
      label: 'Create PDF',
      icon: icon('plus', 16),
      onClick: () => showMenu($('#create-btn'), createMenuItems()),
    },
    { divider: true },
    {
      label: 'Save',
      shortcut: 'Ctrl+S',
      icon: icon('save', 16),
      disabled: !doc,
      onClick: () => doc && saveDoc(doc),
    },
    {
      label: 'Save as…',
      shortcut: 'Shift+Ctrl+S',
      disabled: !doc,
      onClick: () => doc && saveDoc(doc, true),
    },
    {
      label: 'Download a copy',
      icon: icon('download', 16),
      disabled: !doc,
      onClick: () => $('#download-btn').click(),
    },
    {
      label: 'Print…',
      shortcut: 'Ctrl+P',
      icon: icon('print', 16),
      disabled: !doc,
      onClick: () => doc && viewer.command(doc.id, 'document:print'),
    },
    { divider: true },
    {
      label: 'Close tab',
      shortcut: 'Ctrl+W',
      disabled: activeId === 'home',
      onClick: () => closeTab(activeId),
    },
    { label: 'Close all tabs', disabled: !tabs.length, onClick: closeAllTabs },
    { divider: true },
    { label: 'All tools', icon: icon('grid', 16), onClick: openAllTools },
    { label: 'About BentoPDF', onClick: showAbout },
  ]);
});

$('#help-btn').addEventListener('click', (e) =>
  showMenu(e.currentTarget as HTMLElement, [
    { label: 'Keyboard shortcuts', onClick: showShortcuts },
    {
      label: 'BentoPDF on GitHub',
      onClick: () =>
        window.open(
          'https://github.com/alam00000/bentopdf',
          '_blank',
          'noopener'
        ),
    },
    { divider: true },
    { label: 'About BentoPDF', onClick: showAbout },
  ])
);

function dialog(title: string, body: Node) {
  const backdrop = h('div', { class: 'dlg-backdrop' });
  const close = () => backdrop.remove();
  backdrop.append(
    h(
      'div',
      { class: 'dlg', role: 'dialog', 'aria-label': title },
      h(
        'div',
        { class: 'dlg-head' },
        h('h2', {}, title),
        iconBtn('close', 'Close', close)
      ),
      body
    )
  );
  backdrop.addEventListener(
    'pointerdown',
    (e) => e.target === backdrop && close()
  );
  document.body.append(backdrop);
}

function showAbout() {
  dialog(
    'About BentoPDF',
    h(
      'div',
      { class: 'dlg-body' },
      h('p', {}, `BentoPDF ${__APP_VERSION__} — desktop edition.`),
      h(
        'p',
        {},
        'Everything runs locally on this computer. Your files are never uploaded.'
      ),
      h(
        'p',
        { class: 'muted' },
        'Open source under the AGPL-3.0 license. Desktop interface customisation by Rohan.'
      )
    )
  );
}

function showShortcuts() {
  const rows: [string, string][] = [
    ['Open a file', 'Ctrl+O'],
    ['Save', 'Ctrl+S'],
    ['Save as', 'Shift+Ctrl+S'],
    ['Print', 'Ctrl+P'],
    ['Find text', 'Ctrl+F'],
    ['Find tools', 'Ctrl+K'],
    ['Close tab', 'Ctrl+W'],
    ['Next / previous tab', 'Ctrl+Tab / Shift+Ctrl+Tab'],
    ['Home', 'Ctrl+Shift+H'],
  ];
  dialog(
    'Keyboard shortcuts',
    h(
      'div',
      { class: 'dlg-body' },
      h(
        'table',
        { class: 'kbd-table' },
        ...rows.map(([a, b]) =>
          h('tr', {}, h('td', {}, a), h('td', {}, h('kbd', {}, b)))
        )
      )
    )
  );
}

/* ------------------------------------------------------------------ */
/* Keyboard, drag & drop, startup                                      */
/* ------------------------------------------------------------------ */

window.addEventListener(
  'keydown',
  (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const doc = activeDoc();
    const k = e.key.toLowerCase();
    const run = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    if (k === 'o') run(openFromDialog);
    else if (k === 's' && doc) run(() => saveDoc(doc, e.shiftKey));
    else if (k === 'p' && doc)
      run(() => viewer.command(doc.id, 'document:print'));
    else if (k === 'f' && doc)
      run(() => viewer.command(doc.id, 'panel:toggle-search'));
    else if (k === 'k')
      run(() => (doc ? openFind($('#find-btn')) : openAllTools()));
    else if (k === 'w' && activeId !== 'home') run(() => closeTab(activeId));
    else if (k === 'h' && e.shiftKey) run(() => activate('home'));
    else if (k === 'tab' && tabs.length) {
      run(() => {
        const ids = ['home', ...tabs.map((t) => t.id)];
        const i = ids.indexOf(activeId);
        activate(ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]);
      });
    }
  },
  true
);

let dragDepth = 0;
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add('is-dragging');
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('is-dragging');
  }
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('is-dragging');
  const items = Array.from(e.dataTransfer!.items);
  const getHandle = (
    it: DataTransferItem
  ): Promise<FileSystemHandle | null> | undefined =>
    (it as any).getAsFileSystemHandle?.();
  const handles = await Promise.all(
    items.map(
      (it): Promise<FileSystemHandle | null> | null =>
        getHandle(it)?.catch((): null => null) ?? null
    )
  );
  const files = Array.from(e.dataTransfer!.files);
  const pdfs = files.filter(isPdf);
  for (const f of pdfs) {
    const handle = handles.find(
      (hd): hd is FileSystemFileHandle =>
        hd?.kind === 'file' && hd.name === f.name
    );
    await openDocument(f, handle);
  }
  const others = files.filter((f) => !isPdf(f));
  if (others.length) await openFiles(others);
});

$('#home-btn').addEventListener('click', () => activate('home'));

// Frameless desktop window (WebView2 host) gets its own caption buttons
const host = (window as any).chrome?.webview;
if (host) {
  document.body.classList.add('is-desktop');
  $('#win-controls').append(
    iconBtn(
      'minimize',
      'Minimize',
      () => host.postMessage('window:minimize'),
      'wc-btn'
    ),
    iconBtn(
      'restore',
      'Maximize',
      () => host.postMessage('window:maximize'),
      'wc-btn'
    ),
    iconBtn(
      'close',
      'Close',
      () => host.postMessage('window:close'),
      'wc-btn wc-close'
    )
  );
}

declare const __APP_VERSION__: string;

if (import.meta.env.DEV) (window as any).__acro = { viewer, tabs };

hydrateIcons();
renderRecommended();
renderAllTools();
activate('home');
