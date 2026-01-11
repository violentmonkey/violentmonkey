# MV3 Smoke Test

## Steps
1. Build the MV3 bundle:
   - `yarn run build:mv3`
2. Load the unpacked extension:
   - Open `chrome://extensions`
   - Enable Developer mode
   - Click “Load unpacked” and select `dist/chrome-mv3`
3. Enable user scripts:
   - Open the extension Details page
   - Enable “Allow user scripts”
   - Reload the extension
4. Visit https://example.com and open the service worker console.
   - Confirm a log like: `VM MV3 SMOKE: result` with status info.
