/**
 * Builds the web app (repository root) into ../dist for the desktop shell.
 *
 * Runs Vite directly instead of `npm run build` because upstream's build
 * script uses POSIX-only syntax and also generates SEO/sitemap assets the
 * desktop app doesn't need.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
console.log('\nWeb app built into dist/');
