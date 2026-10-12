# Security policy

## Supported versions

Security fixes are released for the latest version of Paperwing. Please keep your copy up to date —
the app tells you when a new release is available.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Instead, report them privately through
GitHub: go to the repository's **Security** tab and choose
**[Report a vulnerability](https://github.com/rohanvijaykumar/paperwing/security/advisories/new)**.

Include a description of the issue, steps to reproduce (a sample PDF if relevant), the Paperwing
version and your operating system. You can expect an acknowledgement within a few days.

If the vulnerability is in BentoPDF's tool code or one of its libraries (such as PDFium, PDF.js or
qpdf), we'll coordinate with the upstream maintainers.

## Security model

- All documents are processed locally. Paperwing has no servers, accounts or telemetry.
- The app's pages are served from a private `app://` origin with cross-origin isolation; the renderer
  runs sandboxed with context isolation, and only a small, explicit file bridge is exposed to it
  (`desktop/preload.cjs`). The bridge handles PDF files only, and only writes back to files the
  user opened or saved through Paperwing (via a temporary file, so a crash can't corrupt them).
- Permission requests (camera, microphone, location, notifications…) are denied.
- Links to websites open in your default browser, never inside the app, and neither the app nor
  its tool frames can navigate away from it.
- Network access is limited to the optional update check and on-demand engine downloads described
  in the [README](README.md#privacy). Downloaded engine files are checked against SHA-256 hashes
  built into the app before they're used.

### Known limitation

BentoPDF's tool pages run in frames on the same `app://` origin as the workspace, so a flaw in a
tool page (for example, script injection through a crafted PDF) could reach the file bridge. The
bridge is kept deliberately narrow for this reason. Serving the tool pages from a separate origin
is planned.
