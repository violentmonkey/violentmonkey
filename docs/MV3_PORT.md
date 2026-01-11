# MV3 Port Tracker

## Target statement
Chrome MV3 only for Chrome stable (current Chrome). Keep MV2 code paths gated only if they still matter for other browsers.

## MV2 blocker inventory
| Blocker | Files | Why this is a blocker for MV3 | 
| --- | --- | --- |
| MV2 manifest schema (manifest_version 2, browser_action, background.scripts, webRequestBlocking) | `src/manifest.yml` | MV3 requires manifest_version 3, replaces browser_action with action, uses service workers instead of background.scripts, and restricts webRequestBlocking without declarativeNetRequest or enterprise allowances. |
| Manifest builder writes MV2 background.scripts | `scripts/manifest-helper.js` | The manifest helper rewrites `manifest.background.scripts` during builds, which is MV2-only and incompatible with MV3 service workers. |
| Build pipeline assumes a single `dist/` output + MV2 manifest schema | `gulpfile.js`, `scripts/webpack-base.js`, `scripts/manifest-helper.js` | The current build writes to a single `dist/` output and then mutates a MV2 manifest structure, which blocks a distinct MV3 manifest/service worker build artifact. |
| Background entry relies on window/DOM-only modules | `src/background/index.js`, `src/background/utils/clipboard.js`, `src/background/utils/icon.js` | MV3 service workers do not have `window` or DOM APIs, but the background entry sets `window._bg` and imports clipboard/icon utilities that use DOM elements, Image, canvas, and document. |
| Blocking webRequest header injection | `src/background/utils/requests-core.js` | MV3 disallows blocking webRequest in most cases; this module injects and modifies headers via onBeforeSendHeaders/onHeadersReceived in blocking mode. |
| MV2 injection APIs + CSP probing assumptions | `src/background/utils/preinject.js` | Uses `browser.tabs.executeScript` for content/page realm injection and relies on webRequest CSP/header inspection to drive injection decisions. |
| Legacy executeScript usage | `src/background/utils/popup-tracker.js`, `src/background/utils/preinject.js`, `src/background/utils/tab-redirector.js` | MV3 removes executeScript in favor of scripting/userScripts APIs. |
| DOM usage in background utilities (clipboard, icon rendering) | `src/background/utils/clipboard.js`, `src/background/utils/icon.js` | These modules use `document`, `addEventListener`, `Image`, and canvas APIs that are unavailable in MV3 service workers. |
