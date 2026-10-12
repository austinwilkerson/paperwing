/**
 * Writes docs/SHORTCUTS.md from the app's keymap (src/acro/keymap.ts),
 * so the documentation always matches the shortcuts the app handles.
 * Usage: node scripts/gen-shortcuts-doc.mjs   (Node 22.6+ for TS imports)
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHORTCUTS, formatCombo } from '../../src/acro/keymap.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const kbd = (combo, mac) => `<kbd>${formatCombo(combo, mac)}</kbd>`;

let md = `# Keyboard shortcuts

Paperwing uses Adobe Acrobat's default shortcuts so your muscle memory carries over.
On macOS, ⌘ (Command) replaces Ctrl, except for switching documents, which uses Control as in Acrobat.

You can also see this list in the app under **Help ▸ Keyboard shortcuts**, and search every command
with the command palette (${kbd('Shift+Ctrl+P', false)}).

> **Single-key accelerators** (the *Tools* section) work when no text field is focused. They are on by
> default; turn them off in **Menu ▸ Preferences** if you prefer Acrobat's out-of-the-box behaviour.

`;
const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
for (const g of groups) {
  md += `## ${g}\n\n| Action | Windows | macOS |\n|---|---|---|\n`;
  for (const s of SHORTCUTS.filter((x) => x.group === g)) {
    md += `| ${s.label} | ${s.keys.map((k) => kbd(k, false)).join(' or ')} | ${s.keys
      .map((k) => kbd(k, true))
      .join(' or ')} |\n`;
  }
  md += '\n';
}
md += `## Also available

- **Esc** — return to the Select tool, close a menu, or leave read mode / full screen
- **Middle-click** a tab to close it; drag tabs to reorder them
- **Double-click** the grip of the floating toolbar to put it back in place
- **Enter** in the page box on the right rail jumps to that page
`;
writeFileSync(resolve(root, 'docs', 'SHORTCUTS.md'), md);
console.log('Wrote docs/SHORTCUTS.md');
