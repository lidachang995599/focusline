# Third-party notices

FocusLine is released under the MIT License (see `LICENSE`). It bundles the following
third-party software:

## pdf.js (pdfjs-dist) 4.10.38

- License: Apache License 2.0
- Upstream: <https://github.com/mozilla/pdf.js>
- Bundled at `vendor/pdfjs/` as `pdf.min.mjs`, `pdf.worker.min.mjs`, `cmaps/` and
  `standard_fonts/`. The built files keep their Apache-2.0 license header, and a copy of
  the license is included at `vendor/pdfjs/LICENSE`.
- Used only by the built-in PDF reader (`reader.html`).

## Build-only dependencies

These are used to build or test the project and are **not** distributed in the extension
package: TypeScript, jsdom, pdf-lib, @pdf-lib/fontkit, @types/chrome.
