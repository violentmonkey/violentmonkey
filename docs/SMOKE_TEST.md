# MV3 Smoke Test (Chrome 143, macOS)

This smoke test validates the MV3 build end-to-end using `https://example.com/`.

## Prerequisites

- Chrome 143 on macOS
- MV3 build already produced via `yarn run build:mv3`
- Extension loaded from `dist/chrome-mv3`
- “Allow user scripts” enabled on the extension details page
- `docs/MV3_GM_API_TEST.user.js` installed/enabled

## Smoke test steps

### Step 1: Verify the internal MV3 smoke script

1. Open `https://example.com/` in a new tab.
2. Open the Service Worker console for the extension:
   - `chrome://extensions` → Violentmonkey MV3 → **Service worker** link.
3. Confirm you see logs similar to:
   - `VM MV3 SMOKE: ran https://example.com/`
   - `VM MV3 SMOKE: result { ... ok: true, ... }`

### Step 2: Verify GM value storage

1. Ensure `docs/MV3_GM_API_TEST.user.js` is installed/enabled.
2. Reload `https://example.com/`.
3. Check the page console for:
   - `VM3 GM API: getValue ok`

### Step 3: Verify GM_xmlhttpRequest

1. With `docs/MV3_GM_API_TEST.user.js` enabled, reload `https://example.com/`.
2. Check the page console for:
   - `VM3 GM API: xhr status 200` (or another successful HTTP status)

### Step 4: Verify clipboard

1. With `docs/MV3_GM_API_TEST.user.js` enabled, reload `https://example.com/`.
2. Check the page console for:
   - `VM3 GM API: setClipboard attempted`
3. Optionally paste into a text field to confirm the clipboard text is:
   - `vm3 clipboard ok`

## Expected results

- **Step 1:** Service worker console shows the MV3 smoke logs with `ok: true`.
- **Step 2:** Page console shows `VM3 GM API: getValue ok` after reload.
- **Step 3:** Page console shows a successful HTTP status for `GM_xmlhttpRequest`.
- **Step 4:** Page console shows the clipboard log, and the clipboard contains `vm3 clipboard ok` if you paste it.
