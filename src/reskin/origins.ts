/**
 * Origins of the desktop app (served by desktop/main.cjs).
 *
 * The workspace (app.html) is the only page with the file bridge, so the
 * tool pages run on a separate origin: the same-origin policy then keeps
 * them (and anything a crafted PDF might inject into them) away from the
 * workspace and its bridge. The two sides talk only through postMessage,
 * checking origin and source on every message.
 *
 * Served from an ordinary web server (vite preview, self-hosting) there is
 * no bridge, and the workspace and tools share that one origin.
 */

/** Workspace origin in the desktop app (keep in sync with main.cjs) */
export const SHELL_ORIGIN = 'app://paperwing';
/** Tool pages' origin in the desktop app (keep in sync with main.cjs) */
export const TOOLS_ORIGIN = 'app://tools';

/** Workspace side: the origin tool pages are loaded from */
export function toolsOrigin(): string {
  return location.origin === SHELL_ORIGIN ? TOOLS_ORIGIN : location.origin;
}

/**
 * Tool side: the origin of the workspace embedding this page, or null when
 * the embedder isn't one we exchange files with.
 */
export function shellOrigin(): string | null {
  if (window.self === window.top) return null;
  // Firefox has no ancestorOrigins: only a same-origin parent can work there
  const parent = location.ancestorOrigins?.[0] ?? location.origin;
  if (parent === location.origin) return parent;
  if (location.origin === TOOLS_ORIGIN && parent === SHELL_ORIGIN)
    return parent;
  return null;
}
