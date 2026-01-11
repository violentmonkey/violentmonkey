# Chrome MV3 Migration Guide (Violentmonkey)

This guide covers the Chrome MV3 target for Violentmonkey on **Chrome 143 (macOS)**. It assumes you already have the MV3 baseline in this repo.

## Build the Chrome MV3 target

**Requirements**

- Node.js 20
- Yarn 1.22.22

**Command**

```bash
yarn run build:mv3
```

The build output is written to `dist/chrome-mv3`.

## Load the unpacked MV3 extension in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer Mode** (top right).
3. Click **Load unpacked** and select `dist/chrome-mv3`.

## Enable “Allow user scripts”

1. In `chrome://extensions`, click **Details** for the Violentmonkey MV3 extension.
2. Enable **Allow user scripts** (available in Chrome 138+).
3. The MV3 service worker checks availability via `isUserScriptsAvailable()` using `chrome.userScripts.getScripts()` in `src/background/sw/index.js`. If this check fails, user scripts will not run.

## Known limitations vs MV2

- **User script execution world:** MV3 runs user scripts via `chrome.userScripts` in the `USER_SCRIPT` world by default. Main-world injection is limited and should not be relied on for CSP bypassing.
- **CSP/nonce handling:** MV3 no longer depends on MV2-style CSP header parsing or nonce injection. Scripts are expected to run in the `USER_SCRIPT` world instead.
- **MV2-only injection APIs:** MV3 does not use `tabs.executeScript`; extension-owned code uses `chrome.scripting.executeScript` when needed.
- **GM_xmlhttpRequest responses:** The MV3 service worker implementation currently returns `text` or `json` only (other response types are not supported).
- **Service worker lifecycle:** MV3 background logic runs in a service worker and can be suspended between events, so rely on persisted storage rather than in-memory state.

If you need MAIN-world behavior for a specific edge case, document the limitation and prefer USER_SCRIPT where possible.
