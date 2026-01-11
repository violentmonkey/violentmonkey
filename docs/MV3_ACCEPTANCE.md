# MV3 Acceptance Criteria

## Phase 1: “Working” definition
1. Builds a loadable unpacked Chrome MV3 extension.
2. Service worker runs with no runtime errors.
3. Can run a trivial user script on https://example.com using `chrome.userScripts`.
   - In chrome://extensions, open the extension Details page, enable “Allow user scripts”, then reload the extension.
4. Supports `GM_getValue` and `GM_setValue`.
5. Supports a minimal `GM_xmlhttpRequest` implemented via `fetch` in the service worker.
