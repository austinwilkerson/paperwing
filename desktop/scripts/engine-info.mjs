/**
 * Describes the large engine files that the desktop app downloads on first
 * use instead of shipping them in the installer (currently LibreOffice, used
 * by the Word/Excel/PowerPoint → PDF tools).
 *
 * The release tag is derived from the files' content, so a new engine build
 * automatically gets a new download location.
 *
 *   node scripts/engine-info.mjs          # prints JSON
 *   node scripts/engine-info.mjs --tag    # prints just the release tag
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const ON_DEMAND = [
  'libreoffice-wasm/soffice.wasm.gz',
  'libreoffice-wasm/soffice.data.gz',
];

export function engineInfo() {
  const hash = createHash('sha256');
  const files = ON_DEMAND.map((rel) => {
    const abs = resolve(root, 'public', rel);
    const data = readFileSync(abs);
    hash.update(data);
    return {
      path: rel,
      name: rel.split('/').pop(),
      size: statSync(abs).size,
      sha256: createHash('sha256').update(data).digest('hex'),
    };
  });
  return {
    tag: `engine-libreoffice-${hash.digest('hex').slice(0, 12)}`,
    files,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const info = engineInfo();
  console.log(
    process.argv.includes('--tag') ? info.tag : JSON.stringify(info, null, 2)
  );
}
