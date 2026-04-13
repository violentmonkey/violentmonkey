# Development Guide

> For architecture overview, see [ARCHITECTURE.md](./ARCHITECTURE.md)  
> For MV3 details, see [MV3-MIGRATION.md](./MV3-MIGRATION.md)  
> For module reference, see [MODULE-REFERENCE.md](./MODULE-REFERENCE.md)

## Quick Start

1. **Install**:
   ```bash
   yarn install
   yarn dev  # Watch mode
   ```

2. **Load extension**:
   - **Chrome**: `chrome://extensions` → Load unpacked → Select `dist/`
   - **Firefox**: `about:debugging` → Load Temporary Add-on → Select `dist/manifest.yml`

3. **Debug**:
   - **Chrome**: chrome://extensions → Background page → DevTools
   - **Firefox**: about:debugging → Inspect

## Debugging Script Injection

### Check if script runs:
1. Click extension icon → see script in popup
2. Open DevTools on the page
3. Look for injected `<script>` tag in HTML

### Common injection issues:

| Symptom | Check |
|---------|-------|
| Script doesn't appear | @match/@include pattern |
| Script runs wrong time | @run_at directive |
| Permission denied | @grant directive |
| CSP error | Page Content-Security-Policy |

### See injection details:

```javascript
// In background console:
// Set breakpoint in preinject.js:getScriptsByURL()
// Check console logs

// Or check what's in the injection payload:
// Look for GetInjected command response
```

## UI & Icons

### Icons

All icons from [Iconify's MDI set](https://icon-sets.iconify.design/mdi/) can be used with [unplugin-icons](https://github.com/unplugin/unplugin-icons).

Icons follow the pattern: `~icons/mdi/{icon-name}` where `{icon-name}` matches the MDI icon name (e.g., `mdi/home`, `mdi/account-circle`).

```vue
<script setup>
import IconSync from '~icons/mdi/sync';
</script>

<template>
  <IconSync />
</template>
```

## Common Tasks

### Testing on both browsers

```bash
# Chrome (MV3)
yarn dev
# Load dist/ in chrome://extensions

# Firefox (MV2)
# Same dist/ works via about:debugging
```

### Running tests

```bash
yarn test
```

### Building for release

```bash
# Chrome
yarn build

# Firefox  
yarn build:firefox

# Self-hosted
yarn build:selfHosted
```

## MV3 vs MV2 Differences

### Chrome (MV3)

- Service worker unloads → cache resets
- No `webRequest` API → limited header modification
- `userScripts.execute()` for arbitrary code injection
- Stricter CSP in extension context

### Firefox (MV2)

- Background page persists → state survives
- Full `webRequest` API → complete header modification
- `tabs.executeScript()` with arbitrary code
- More permissive CSP

## Browser Console Debugging

### Background (Service Worker / Background Page)

```javascript
// Chrome: DevTools for service worker
// Firefox: DevTools for background page

// Check script environment
const allScripts = await browser.storage.local.get();

// Check if webRequest available (Firefox only)
console.log(!!browser.webRequest?.onBeforeSendHeaders);

// Monitor background messages
browser.runtime.onMessage.addListener((msg) => {
  console.log('Message received:', msg);
});
```

### Content Script

```javascript
// Right-click page → Inspect → Console

// See what was injected
console.log(window.__ViolentMonkey);

// Send message to background
const result = await browser.runtime.sendMessage({
  cmd: 'GetOption',
  data: keyName
});
console.log('Got option:', result);
```

### Injected Script (Web Realm)

```javascript
// Userscript running in page context
console.log('I am GM script:', typeof GM_setValue === 'function');

// Call GM functions
const val = GM_getValue('key', 'default');
GM_setValue('key', 'newValue');

// Make XHR
GM_xmlHttpRequest({
  method: 'GET',
  url: 'https://example.com',
  onload: (resp) => console.log('Got:', resp.responseText);
});
```

## Troubleshooting

### Scripts not appearing in options

1. Check console for parse errors
2. Verify script has `@match` or `@include`
3. Check IndexedDB quota (DevTools → Storage → IndexedDB)

### Script created but doesn't run

1. Check URL patterns
2. Check @grant permissions
3. Check browser console for errors
4. Try different @run_at

### XHR fails

1. Check @grant includes 'GM_xmlHttpRequest'
2. Know: Chrome can't modify headers (MV3 limitation)
3. Firefox can modify headers (has webRequest)

### Service worker unload issues (Chrome)

1. Go to chrome://extensions/
2. Click reload on Feature Injector
3. Check if cache properly recreated

## Testing Checklist

Before committing:
- [ ] No console errors
- [ ] Works on Chrome AND Firefox
- [ ] Popup shows correct state
- [ ] Injection happens correctly
- [ ] Service worker reload works

## References

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design
- [MV3-MIGRATION.md](./MV3-MIGRATION.md) - Chrome MV3 specifics
- [MODULE-REFERENCE.md](./MODULE-REFERENCE.md) - File-by-file guide
