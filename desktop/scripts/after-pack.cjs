/**
 * electron-builder afterPack hook: removes Chromium files Paperwing never
 * uses, before the installers are made.
 *
 *  - dxcompiler.dll / dxil.dll: DirectX shader compiler for WebGPU (~30 MB)
 *  - LICENSES.chromium.html is kept: Chromium's licence requires it.
 */
const { existsSync, rmSync, statSync } = require('node:fs');
const { join } = require('node:path');

const UNUSED = {
  win32: ['dxcompiler.dll', 'dxil.dll'],
};

exports.default = async function afterPack({
  appOutDir,
  electronPlatformName,
}) {
  let saved = 0;
  for (const name of UNUSED[electronPlatformName] ?? []) {
    const p = join(appOutDir, name);
    if (!existsSync(p)) continue;
    saved += statSync(p).size;
    rmSync(p);
  }
  if (saved)
    console.log(
      `  • afterPack removed ${(saved / 1048576).toFixed(1)} MB of unused Chromium files`
    );
};
