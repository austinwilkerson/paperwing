/**
 * Light/dark theme preference shared by the Paperwing shell and every tool
 * page (they are same-origin, so they share localStorage).
 *
 * "system" follows the OS. The resolved theme is exposed as
 * <html data-theme="light|dark"> only when the user overrides the system;
 * CSS handles the system case with prefers-color-scheme.
 */

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'paperwing:theme';
const EVENT = 'paperwing:themechange';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function isDark(pref = getThemePref()): boolean {
  return pref === 'dark' || (pref === 'system' && media.matches);
}

export function applyTheme(root: HTMLElement = document.documentElement) {
  const pref = getThemePref();
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  root.style.colorScheme = isDark(pref) ? 'dark' : 'light';
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable: applies to this session only */
  }
  applyTheme();
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Calls back whenever the effective theme may have changed */
export function onThemeChange(callback: () => void) {
  const run = () => {
    applyTheme();
    callback();
  };
  media.addEventListener('change', run);
  window.addEventListener(EVENT, run);
  // Another document (shell or a tool frame) changed the preference
  window.addEventListener('storage', (e) => e.key === KEY && run());
}
