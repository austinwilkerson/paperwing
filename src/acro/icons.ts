/** UI chrome icons (lucide, thin strokes to match Acrobat's icon style) */
import {
  createElement,
  ArrowLeft,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Clock,
  Download,
  Ellipsis,
  Files,
  FolderOpen,
  GripHorizontal,
  Highlighter,
  House,
  LayoutGrid,
  List,
  Maximize2,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  Minus,
  Monitor,
  MousePointer2,
  Pen,
  Plus,
  Printer,
  Redo2,
  RotateCw,
  Save,
  Search,
  Signature,
  Square,
  Stamp,
  Star,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  Copy,
  Check,
  SunMoon,
  Settings,
  Pin,
  type IconNode,
} from 'lucide';

const ICONS = {
  arrowLeft: ArrowLeft,
  bookmark: Bookmark,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  help: CircleHelp,
  clock: Clock,
  download: Download,
  more: Ellipsis,
  thumbnails: Files,
  folder: FolderOpen,
  grip: GripHorizontal,
  highlight: Highlighter,
  home: House,
  grid: LayoutGrid,
  list: List,
  expand: Maximize2,
  menu: Menu,
  comments: MessageSquare,
  comment: MessageSquarePlus,
  minimize: Minus,
  computer: Monitor,
  select: MousePointer2,
  draw: Pen,
  plus: Plus,
  print: Printer,
  redo: Redo2,
  rotate: RotateCw,
  save: Save,
  search: Search,
  sign: Signature,
  shape: Square,
  stamp: Stamp,
  star: Star,
  trash: Trash2,
  text: Type,
  undo: Undo2,
  close: X,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  restore: Copy,
  check: Check,
  theme: SunMoon,
  settings: Settings,
  pin: Pin,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 18, strokeWidth = 1.6): SVGElement {
  const el = createElement(ICONS[name], {
    width: size,
    height: size,
    'stroke-width': strokeWidth,
    'aria-hidden': 'true',
  });
  el.classList.add('ic');
  return el;
}

/** Coloured two-tone tool icon (Phosphor duotone font) */
export function toolIcon(name: string, color: string, size = 20): HTMLElement {
  const el = document.createElement('i');
  el.className = `ph-duotone ph-${name} tool-ic`;
  el.style.color = color;
  el.style.fontSize = `${size}px`;
  el.setAttribute('aria-hidden', 'true');
  return el;
}
