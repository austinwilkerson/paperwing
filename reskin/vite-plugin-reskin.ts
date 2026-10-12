/**
 * Acrobat-style desktop shell for BentoPDF.
 *
 * - Adds `app.html` (the Acrobat-style shell, code in src/acro/) as a build
 *   entry, so upstream's hardcoded page list doesn't need editing.
 * - Injects the light theme + embed helper (src/reskin/) into every upstream
 *   tool page, so they look native when the shell hosts them in a frame.
 *
 * No upstream page files are edited.
 */
import type { Plugin } from 'vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const APP_ENTRY = 'app.html';

export function reskinPlugin(): Plugin {
  return {
    name: 'acrobat-reskin',

    config(config) {
      const root = config.root || process.cwd();
      const { version } = JSON.parse(
        readFileSync(resolve(root, 'package.json'), 'utf8')
      );
      const input = config.build?.rollupOptions?.input;
      if (input && typeof input === 'object' && !Array.isArray(input)) {
        (input as Record<string, string>).app = resolve(root, APP_ENTRY);
      }
      return { define: { __APP_VERSION__: JSON.stringify(version) } };
    },

    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (ctx.filename.replace(/\\/g, '/').endsWith('/' + APP_ENTRY)) {
          return html;
        }
        return html
          .replace(
            '</head>',
            '  <link rel="stylesheet" href="/src/reskin/reskin.css" />\n  </head>'
          )
          .replace(/<body([^>]*)>/, (_m, attrs: string) =>
            /\bclass\s*=\s*"/.test(attrs)
              ? `<body${attrs.replace(/\bclass\s*=\s*"/, 'class="rs-theme ')}>`
              : `<body${attrs} class="rs-theme">`
          )
          .replace(
            '</body>',
            '  <script type="module" src="/src/reskin/reskin.ts"></script>\n  </body>'
          );
      },
    },
  };
}
