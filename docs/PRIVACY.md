# FocusLine Privacy Policy

**Effective date:** 26 October 2026

FocusLine is a browser extension that dims the page around a draggable reading line and can read the page aloud with a local voice. This policy explains exactly what the extension does with data. It is intentionally short because the extension does very little.

## Summary

- FocusLine does **not** collect, transmit, or sell your browsing history.
- Page content never leaves your device.
- Read-aloud uses **local speech engines only**; page text is never sent to a network voice.
- Settings are stored locally in your browser.
- FocusLine makes **no network requests** at all.

## What is stored, and where

FocusLine uses `chrome.storage.local`, which stays on your device and is not synced to us or anyone else.

| Data | Purpose | Leaves your device? |
| --- | --- | --- |
| Per-site settings: band position, height, dim level, colour, calm flag, colour-guide mode, text formatting, selectors of elements you chose to hide | Restore your reading setup on each website | No |
| The hostname of sites where you changed a setting (used as the storage key) | Keep settings separate per site | No |
| Reading speed | Remember your preferred speech rate | No |
| PDF files you open in FocusLine Reader, and the reader's line settings | Draw the PDF and restore the line position | No — the file is decoded in memory and never uploaded |

FocusLine does not read or store the content of the pages you visit, keystrokes, form data, passwords, or files. Read-aloud processes page text in memory only; it is not saved. PDFs opened in the reader are decoded in memory to be drawn and are not stored.

## Network requests

The extension contains no analytics SDK, no advertising, no tracking pixels, and no third-party scripts, and it does not call any server of ours.

The one exception is a **remote PDF you explicitly open in FocusLine Reader**: the browser then fetches that file from the site you came from, using the site permission you granted. Local PDFs opened with “Open file…” or drag-and-drop never leave your device.

Read-aloud filters `speechSynthesis` voices to those with `localService === true`. If the system has no local voice, FocusLine shows a notice and does not fall back to a network voice. The page text is passed only to the browser's on-device speech engine.

The extension has no support or donation links. Contact details are only in the store listing and the project README; nothing is sent unless you write to that address.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `storage` | Save your per-site settings locally |
| `activeTab` | Access the current tab only after you click the toolbar icon or press the keyboard shortcut |
| `scripting` | Inject the reading-line overlay into that tab |
| Optional host access | Requested only when you turn on “Run automatically on this site”, for that one site |

FocusLine does not request access to all websites at install time.

## Children

FocusLine is a general-purpose reading aid and is not directed at children under 13. It does not knowingly collect personal information from anyone.

## Your control

- Turn the extension off at any time from the toolbar popup.
- Remove a site's settings by clearing the extension's storage, or uninstall the extension — uninstalling deletes all locally stored settings.

## Changes

If this policy changes materially, the updated version will be published at this URL with a new effective date.

## Contact

Questions about this policy: **lidachang78@gmail.com**. We aim to reply within three business days.
