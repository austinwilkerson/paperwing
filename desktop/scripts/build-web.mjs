/**
 * Builds the web app (repository root) into ../dist for the desktop shell.
 *
 * Runs Vite directly instead of `npm run build` because upstream's build
 * script uses POSIX-only syntax and also generates SEO/sitemap assets the
 * desktop app doesn't need.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineInfo } from './engine-info.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = resolve(root, 'dist');

if (!existsSync(resolve(root, 'node_modules'))) {
  console.error('Install dependencies in the repository root first: npm ci');
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });

const env = {
  ...process.env,
  SIMPLE_MODE: 'true',
  VITE_BRAND_NAME: 'Paperwing',
  DISABLE_GITHUB_STARS: 'true',
  NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=6144']
    .filter(Boolean)
    .join(' '),
};

const vite = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');
const result = spawnSync(process.execPath, [vite, 'build'], {
  cwd: root,
  env,
  stdio: 'inherit',
});

if (result.status !== 0) process.exit(result.status ?? 1);
if (!existsSync(resolve(dist, 'app.html'))) {
  console.error('Build finished but dist/app.html is missing.');
  process.exit(1);
}
// The build also writes .br/.gz copies of most files for web servers. The
// desktop app serves files itself, so drop the copies (but keep real .gz
// sources such as LibreOffice's, which have no uncompressed sibling).
let removed = 0;
let saved = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (
      /\.(br|gz)$/.test(name) &&
      existsSync(p.replace(/\.(br|gz)$/, ''))
    ) {
      saved += statSync(p).size;
      rmSync(p);
      removed++;
    }
  }
};
walk(dist);
console.log(
  `Removed ${removed} pre-compressed copies (${(saved / 1048576).toFixed(1)} MB)`
);

// Manifest of engine files downloaded on first use (see main.cjs)
const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(
  resolve(here, '..', 'engines.json'),
  JSON.stringify(engineInfo(), null, 2)
);

console.log('\nWeb app built into dist/');
