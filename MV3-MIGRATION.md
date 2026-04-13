# Chrome Manifest V3 Migration Guide

## Overview

Feature Injector has been migrated from **Manifest V2 to Manifest V3** for Chrome while maintaining **Manifest V2 for Firefox**. This document explains the key changes, challenges, and current workarounds.

## What Changed in Manifest V3

### 1. Service Workers Replace Background Pages

**MV2**: Background scripts ran in a persistent page context.
**MV3**: Background scripts run in service workers that:
- Unload after 5 minutes of inactivity
- Don't have persistent memory (globals are reset on reload)
- Have limited DOM access
- Are event-driven

**Feature Injector Impact**:
- Cannot rely on runtime state persisting
- Cache needs to be recreated on each service worker activation
- State must be managed carefully

### 2. webRequest API Removed

**MV2**: `chrome.webRequest` API for intercepting HTTP headers.
**MV3**: Removed entirely, replaced with `declarativeNetRequest`.

**Feature Injector Impact**:
- Cannot intercept/modify XHR headers from extension realm (Firefox still can)
- Background module uses `browser.webRequest` checks for Firefox detection
- Chrome users cannot use XHR header manipulation via @grant headers

**Current Status**: 
- Firefox: Still uses webRequest for header interception ✓
- Chrome: XHR requests go through content script without header modification

### 3. Content Scripts Can't Execute Arbitrary Code

**MV2**: `tabs.executeScript(code)` could run any JavaScript.
**MV3**: `scripting.executeScript()` only supports:
  - File-based scripts (`{files: ['script.js']}`)\
  - Function-based scripts (`{function: myFn}`)
  - Not raw code strings

**Feature Injector Impact**:
- Cannot inject arbitrary userscript code via scripting API
- Solution: Use `browser.userScripts.execute()` (Chrome MV3 specific)

### 4. Stricter Content Security Policy (CSP)

**MV3**: 
- No inline script execution (`<script>alert(1)</script>`)
- No `eval()` in extension context
- No `Function()` constructor

**Feature Injector Impact**:
- Page realm injection must use `<script src="data:...">` or script tags
- Wrapped scripts injected via `browser.userScripts.execute()` instead

### 5. Persistent State Moved to Storage APIs

**MV2**: Background page global variables.
**MV3**: Must use:
- `chrome.storage.local`
- `chrome.storage.session`
- `IndexedDB`
- `Service Worker globals` (reset on unload)

**Feature Injector Impact**:
- Script data still in IndexedDB ✓ (same as MV2)
- Runtime cache rebuilt on service worker restart
- No change to storage layer needed

## Feature Injector's MV3 Workarounds

### Challenge 1: Arbitrary Content Injection

**Problem**: Cannot run `tabs.executeScript(code)`

**Solution**: Use `browser.userScripts.execute()`

```javascript
// Chrome MV3 only
const result = await browser.userScripts.execute({
  target: { tabId, frameId },
  files: ['injected-script.js'],  // File-based injection
  world: 'MAIN',                  // 'MAIN' for page realm, not specified for content
});

// Alternative: Manual script tag injection
const blobUrl = URL.createObjectURL(new Blob([code]));
await browser.scripting.executeScript({
  target: { tabId },
  function: () => {
    const script = document.createElement('script');
    script.src = blobUrl; // Created in extension context
    document.head.appendChild(script);
  }
});
```

**Current Implementation** (`tabs.js`):
- For userscript code: Uses `browser.userScripts.execute(code, world: 'MAIN')`
- For simple operations: Uses `chrome.scripting.executeScript()` with functions
- Fallback: Marks scripts as "bad realm" if neither works

### Challenge 2: Detecting Injection Capabilities

**Problem**: Need to know if page allows extension injections (CSP issue)

**Solution**: Track via `GetInjected` response and trial-and-error

```javascript
// In content script initialization
const canInjectArbitrary = await checkInjectionCapability();
if (!canInjectArbitrary) {
  // Use wrapped scripts or mark as unsupported
}
```

**Current Implementation** (`tabs.js`):
```javascript
export async function canExecuteArbitraryCodeInTab() {
  // Returns false for strict CSP pages that don't allow extension origin
  // Cached per tabId to avoid repeated checks
}
```

### Challenge 3: Service Worker Persistence

**Problem**: Cannot rely on background service worker staying alive

**Solution**: Rebuild cache on demand

**Current Implementation**:
- `preinject.js` checks `isApplied` flag
- Recompiles script environment if needed
- Cache (`cache.js`) can be destroyed/rebuilt
- Storage layer persists data independently

### Challenge 4: UserScripts API Limitations

**Problem**: `browser.userScripts.execute()` is Chrome-specific and limited

**Limitations**:
- Can only execute in MAIN (page) or USER_SCRIPT (content) world, not both simultaneously
- Cannot access arbitrary function scope (unlike Firefox MV2 `tabs.executeScript()`)
- Requires `"userScripts": ["*://*/*"]` permission

**Current Workarounds**:
1. For automethod scripts: inject via userScripts API directly
2. For arbitrary code: wrap in function ands inject via userScripts
3. For unreachable code: mark as "bad realm" with error message

**Implementation** (`preinject.js` + `tabs.js`):
```javascript
if (isChromeMV3 && supportsUserScripts) {
  // Route wrapped scripts through userScripts.execute()
  await executeArbitraryCodeInTab(tabId, wrappedCode, frameId, runAt, 'MAIN');
} else if (isChromeMV3) {
  // Fallback: scripting.executeScript() with files
  // Limited functionality
} else {
  // Firefox: Direct tab.executeScript(code)
  // Full functionality
}
```

### Challenge 5: Popup Diagnostics

**Problem**: Service worker reloads lose popup state

**Issue**: When popup shows injection errors, the badge state might not survive service worker unload

**Solution**: Always notify content scripts about popup state

**Current Implementation** (`popup-tracker.js`):
- Sends `PopupShown` command to content scripts even if badge state missing
- Content scripts cache error state locally

## Manifest Differences Summary

| Feature | MV2 | MV3 |
|---------|-----|-----|
| Background Context | Persistent Page | Service Worker |
| webRequest API | ✓ Chrome & FF | ✗ Chrome only (FF MV2 has it) |
| executeScript(code) | ✓ Full code  | ✗ Functions/files only |
| Inline Scripts | ✓ Allowed | ✗ Forbidden by CSP |
| storage.* API | ✓ Available | ✓ Available |
| userScripts.execute() | N/A | ✓ Chrome only |
| Background persistence | Unlimited | 5 min inactivity timeout |

## Browser Compatibility Matrix

| Feature | Chrome MV3 | Firefox MV2 |
|---------|-----------|-----------|
| Script storage | ✓ IndexedDB | ✓ IndexedDB |
| Arbitrary injection | Partial (userScripts) | ✓ Full |
| Page realm injection | ✓ userScripts MAIN | ✓ direct |
| Content realm injection | ✓ scripting API | ✓ direct |
| XHR headers (GM_xmlHttpRequest) | ✗ Limited | ✓ Full (webRequest) |
| Cookies access | Handled via content script | Handled via webRequest |
| Service worker persistence | ✗ 5min timeout | N/A |
| CSP bypass | Limited | Better |

## Known Chrome MV3 Limitations

### 1. Strict CSP Pages

Pages with strict CSP that explicitly block `script-src 'self'` cannot be reliably injected.

**Current Behavior**:
- Marked as "bad_realm" with error message
- User sees notification in popup

### 2. Large Script Delays

Large userscripts serialized for content script transfer cause slight delay.

**Optimization**: Blob URLs for response data (not script code)

### 3. No Header Manipulation

Cannot modify request/response headers for XHR (Chrome limitation).

**Workaround**: Content script acts as proxy, but limited

### 4. Timing Sensitivity

Scripts must be injected at `document_start` for `@run_at document_start` compatibility.

**Current**: Uses `browser.userScripts.execute()` with timing preserved

## Firefox MV2 Features (Chrome Doesn't Have)

### 1. webRequest API

Full HTTP header interception:
```javascript
browser.webRequest.onBeforeSendHeaders.addListener(
  (event) => {
    event.requestHeaders.push({ name: 'SM', value: '1' });
    return { requestHeaders: event.requestHeaders };
  }
);
```

### 2. Direct Code Execution

Full arbitrary code execution:
```javascript
browser.tabs.executeScript(tabId, { code: 'alert("any code")' });
```

### 3. Longer Time Budget

Service worker concept doesn't apply; background page persists indefinitely.

## Migration Checklist for Future Changes

When modifying injection code:

- [ ] Test on Chrome (MV3) with userScripts API in mind
- [ ] Test on Firefox (MV2) with full capabilities
- [ ] Check `hasWebRequest` flag before using webRequest
- [ ] Check `canExecuteArbitraryCodeInTab()` before using arbitrary code
- [ ] Wrap code in try-catch for MV3 compatibility
- [ ] Document Chrome MV3 limitations in comments
- [ ] Test with strict CSP pages
- [ ] Verify service worker survival scenarios

## Testing MV3 Scenarios

### 1. Strict CSP Page

```html
<!-- Should fail gracefully -->
<meta http-equiv="Content-Security-Policy" 
      content="script-src 'none'">
```

### 2. Extension Origin in CSP

```html
<!-- Should work -->
<meta http-equiv="Content-Security-Policy" 
      content="script-src 'self' chrome-extension://*">
```

### 3. Large Script Injection

```javascript
// Time monitoring for injection delays
console.time('userscript-inject');
// Script runs
console.timeEnd('userscript-inject'); // Should be <100ms
```

### 4. Service Worker Reload

```javascript
// In Chrome DevTools
// 1. Go to chrome://extensions/?id=...
// 2. Click "Unload" to unload service worker
// 3. Navigate to userscript page
// 4. Service worker auto-reloads and re-injects
```

## Future Improvements

1. **Chrome MV3 Transition**: Eventually full Chrome MV3 support without workarounds
   - Wait for better arbitrary code execution support
   - Or use `userScripts` API more extensively

2. **Firefox MV3**: When Firefox ships MV3 (removing MV2)
   - May need to use `content_scripts` instead of userScripts API
   - webRequest won't be available

3. **Persistent State**: Find workaround for service worker reload
   - Don't rely on runtime cache
   - Or use service worker globals + IDB hybrid

## References

- [Chrome MV3 Migration Guide](https://developer.chrome.com/en/docs/extensions/mv3/)
- [Firefox WebExtensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/)
- [userScripts API](https://developer.chrome.com/en/docs/extensions/reference/userScripts/)
- [Chrome Issue Tracker](https://bugs.chromium.org/)
