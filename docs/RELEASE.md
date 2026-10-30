# Release checklist — 0.2.1

Run before uploading to the Chrome Web Store.

> **Launch order:** the Chrome Web Store charges a one-time $5 developer fee that needs an
> international card. If that is blocked, start on the **Edge Add-ons** store (free, same
> package) using `docs/STORE-EDGE.md`, then come back to Chrome once the card works.

## Artifact

- Source: `D:\fantasy\focusline`
- Build: `npm run build` → `dist/` (3.8 MB, 218 files)
- Package: `release/focusline-0.2.1.zip` (2.1 MB, manifest at the zip root)
- Version: `0.2.1` in both `manifest.json` and `package.json`

## Verified

- [x] `npm run build` clean
- [x] `npm test` — 81 checks (content 37, popup 26, background 6, i18n 7, reader-speech 5)
- [x] Manifest V3, `minimum_chrome_version` 120, MV3 service worker
- [x] Permissions are the narrow set: `storage`, `scripting`, `activeTab` + optional host access
      (no install-time host warning; host access is requested per site only)
- [x] Icons 16 / 32 / 48 / 128 present
- [x] 10 locales in `_locales/`, key parity enforced by the i18n test
- [x] `web_accessible_resources` limited to `_locales/*/messages.json`
- [x] No leftover `console.debug`; only a `console.warn` when a PDF page fails to render
- [x] Privacy policy text written (`docs/PRIVACY.md`) and consistent with the code
      (no network requests, local speech only, remote PDF only when opened explicitly)

## Blockers (must fix before submitting)

1. **Screenshots.** The store needs 1280×800 (or 640×400) images.
   - `docs/store/01-reading-line-1280x800.png` — ready (derived from `docs/screenshot-page.png`).
   - The old popup screenshot was deleted (it showed v0.1.0 and removed features). Capture the
     current popup, the PDF reader card and the colour guide at 1280×800.
2. **Privacy policy URL.** Rendered to `docs/privacy.html` and intended for GitHub Pages:
   `https://lidachang995599.github.io/focusline/privacy.html`. Enable Pages in the repo
   settings (branch `main`, folder `/docs`) and check the URL opens before submitting.
3. **Listing languages.** The table in `docs/STORE.md` lists 13 languages, but the UI ships
   10. Only add listings you actually translated, or finish the other three.
4. **Positioning.** The draft title and first line lead with ADHD/dyslexia. One review
   (“Why Dyslexia of all things in the extension preview? 😭”) suggests that turns off
   some general users. Suggested title: `FocusLine — Reading Line & Focus Mode` and lead
   the description with focus, keeping ADHD/dyslexia in “Who it is for”.

## Minor

- `action.default_title` is hard-coded `FocusLine` (not localised).
- Command descriptions in `manifest.json` are English only (Chrome shows them in
  `chrome://extensions/shortcuts`).
- The `docs/screenshot-page.png` capture predates the current band styling by a few
  builds; it still shows the right behaviour, but recapture it in the same session as
  the popup/reader screenshots.

## Steps

1. `npm run build && npm test`
2. Load `dist/` unpacked in Chrome, run the manual smoke list in `docs/TESTING.md`
3. Zip `dist/` (or use `release/focusline-0.2.1.zip`)
4. Upload at <https://chrome.google.com/webstore/devconsole>
5. Fill listing from `docs/STORE.md`, upload screenshots, paste the privacy URL
6. Submit for review

## “What’s new” copy for 0.2.1

```
• Snap to text lines: the line parks on the line under your cursor, and keeps
  following the text when you scroll
• Locked line now sticks to the text, not the screen: scroll and it moves with
  the paragraph you pinned
• Custom colour-guide colours (web and PDF)
• The PDF reader controls live in a compact floating card, collapsible out of the way
• Alt + click positions the line without touching your chosen height
• Alt + right-click releases the lock
```
