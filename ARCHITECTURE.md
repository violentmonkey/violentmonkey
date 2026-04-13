# Feature Injector Architecture

## Overview

Feature Injector is a browser extension that enables userscripts (Greasemonkey/Tampermonkey scripts) to run in modern browsers. The extension operates on **Manifest V3 (Chrome)** and **Manifest V2 (Firefox)**, with different code paths for each platform.

### Core Execution Flow

```
User Script Installation
    ↓
Background Service Worker / Background Page
    ↓
 Database (IndexedDB)
    ↓
Content Script (Per Tab/Frame)
    ↓
Web Realm Injection (Sandbox)
    ↓
User Script Execution
```

## Project Structure

### `/src`
The source code directory containing all extension code.

#### `/src/background`
**Responsibility**: Core extension logic, script management, and injection orchestration.

- **`index.js`** - Service worker/background page entry point
  - Command message handler setup
  - Central dispatch for all background operations
  - Permission and error handling
  
- **`plugin/`** - Feature modules
  - `gm-value.js` - GM_setValue/getValue storage
  - `gm-require.js` -@require dependency fetching
  - `clipboard.js` - Clipboard access via GM_setClipboard
  
- **`sync/`** - Data synchronization
  - `base.js` - Sync orchestration and conflict resolution
  - Firefox-specific sync handling
  
- **`utils/`** - Utility modules (26 files)
  - **Database & Storage**
    - `db.js` (900L) - Script storage, retrieval, metadata parsing [REFACTORING CANDIDATE]
    - `storage.js` - IDB abstraction layer
    - `cache.js` - Runtime cache for performance
    - `storage-cache.js` - Reactive storage updates
    
  - **Injection Pipeline**
    - `preinject.js` (800L) - Script preparation, environment building [REFACTORING CANDIDATE]
    - `tabs.js` - Tab/frame management for injection
    - `init.js` - Initialization and command setup
    
  - **HTTP/XHR Interception**
    - `requests-core.js` - WebRequest API interception (Firefox MV2 only)
    - `requests.js` - XHR implementation for GM_xmlHttpRequest
    - `cookies.js` - Cookie management
    
  - **Resources**
    - `icon.js` - Badge management and script icons
    - `script.js` - Script CRUD operations
    - `icon-loader.js` - Icon download and cache
    
  - **Other**
    - `options.js` - Configuration management
    - `notifications.js` - Popup notification system
    - `popup-tracker.js` - Popup state management
    - `values.js` - GM_Value storage
    - `ua.js` - User agent detection
    - `url.js` - URL validation and utilities

#### `/src/common`
**Responsibility**: Shared utilities and constants used across the extension.

- **`browser.js`** - Browser API normalization (Chrome vs Firefox)
- **`consts.js`** - Global constants (inject realms, metadata keys, etc.)
- **`cache.js`** - Generic cache factory
- **`events.js`** - Event bus for inter-module communication
- **`handlers.js`** - Common event handlers
- **`object.js`** - Object utilities (deepEqual, forEachEntry, etc.)
- **`string.js`** - String manipulation utilities
- **`date.js`** - Date utilities
- **`download.js`** - File download functionality
- **`keyboard.js`** - Keyboard shortcut utilities
- **`tld.js`** - Top-level domain utilities
- **`zip.js`** - ZIP archive handling
- **`options-defaults.js`** - Default extension settings

#### `/src/injected`
**Responsibility**: Code injected into web pages (runs in web realm, not extension context).

- **`index.js`** - Entry point for injected scripts
- **`safe-globals.js`** - Safe references to global objects (protected from page override)
- **`content/`** - Content script bridge
  - `index.js` - Content script setup
  - `inject.js` - Script injection orchestration
  - `requests.js` - XHR/fetch interception for content realm
  - `util.js` - Utility functions
  - `inject.js` - Script realm bootstrap
  
- **`web/`** - Web realm code (injected into page)
  - `gm-api.js` - GM_* API implementations
  - `gm-global-wrapper.js` - Global scope wrapper
  - `requests.js` - Web realm XHR/fetch
  - `util.js` - Web realm utilities

#### `/src/options`
**Responsibility**: Options/settings UI.

- **`index.js`** - Options page entry point
- **`views/`** - Vue components for UI
  - `app.vue` - Main options page
  - `edit/` - Script editor
  - `confirm/` - Confirmation dialogs
  - Various setting panels

#### `/src/popup`
**Responsibility**: Popup UI shown when clicking extension icon.

- **`index.js`** - Popup entry point
- **`views/app.vue`** - Main popup UI

#### `/src/confirm`
**Responsibility**: Installation confirmation dialog.

#### `/src/_locales`
**Responsibility**: Internationalization (i18n).

- Language-specific message files (en, fr, es, de, ja, etc.)

### Key Files by Functionality

## Injection Pipeline: Detailed Flow

### 1. **Background Phase**: Script Preparation

```
User visits page
    ↓
content-script.js connects to background
    ↓
background/index.js sends GetInjected command
    ↓
preinject.js::getScriptsByURL(url, isTop)
    - Queries db.js for scripts matching URL
    - Builds environment with code, metadata, values
    ↓
normalization happens
    - Realm selection (PAGE vs CONTENT)
    - Metadata normalization
    ↓
Injection payload returned
```

### 2. **Content Script Phase**: Realm Selection

```
Payload received in content script
    ↓
content/inject.js::triageRealms()
    - Checks Chrome MV3 capabilities
    - Routes to appropriate injection method
    ↓
For CONTENT realm (content script sandbox):
    - Execute via chrome.scripting.executeScript()
    - Or browser.userScripts.execute() (Chrome)
    ↓
For PAGE realm (web page sandbox):
    - Create <script> tag with inline code
    - Or browser.userScripts.execute() with world:'MAIN'
```

### 3. **Web Realm Phase**: Script Execution

```
Script injected into page
    ↓
gm-api.js handles GM_* API calls
    ↓
Calls routed back to content script via postMessage
    ↓
Content script processes and responds
```

## Browser Compatibility

### Chrome / Chromium (Manifest V3)

**Manifest V3 Limitations**:
- No `webRequest` API - uses `declarativeNetRequest` instead (not used for userscripts)
- No arbitrary code execution via `scripting.executeScript(code)` - only files/functions
- No service worker persistence (unloads after 5 min idle)
- Solution: `browser.userScripts.execute()` with optional `world: 'MAIN'` for page realm injection

**Chrome-Specific Paths**:
- `tabs.js`: Uses `browser.userScripts.execute()` for arbitrary code injection
- `preinject.js`: Routes wrapped scripts through userScripts API
- Fallback: Mark unsupported realms as "bad realm" instead of crashing

### Firefox (Manifest V2)

**Advantages**:
- `webRequest` API available for header interception
- Can execute arbitrary code in any realm (`tabs.executeScript(code)`)
- Background page persists for entire user session
- Content Scripts API (newer path)

**Firefox-Specific Paths**:
- `requests-core.js`: Uses `browser.webRequest.onBeforeSendHeaders`/`onHeadersReceived`
- `preinject.js`: Can inject arbitrary code directly
- `base.js`: Different sync strategies

## Key Design Patterns

### 1. **Realms**

The extension operates in multiple **realms** with different security/capability levels:

- **Extension Realm** (`background/`, `src/options/`, `src/popup/`)
  - Full API access
  - Can access IDB, make XHR requests, access cookies
  - Safe from page tampering

- **Content Script Realm**
  - Limited API access
  - Can't access cookies, limited XHR
  - Isolated from page, but can be snooped
  - Used as bridge between extension and page

- **Web Page Realm** (`src/injected/web/`)
  - Full JavaScript capabilities
  - Can't access extension APIs directly
  - Subject to CSP and page sandbox
  - Can be tampered with by page scripts
  - Communicates via postMessage

### 2. **Environment Building**

Before injection, an "environment" object is built containing:

```javascript
{
  allIds: { [id]: true },           // Script IDs to inject
  [S_SCRIPTS]: [...scripts],         // Script metadata + code
  [S_CODE]: { [id]: code },          // Script source code
  [S_CACHE]: { ...cache },           // Cached @require scripts
  [S_VALUE]: { [id]: {...} },        // GM_Value storage for each script
  [INJECT_INTO]: 'page',             // Realm selection
  errors: 'error1\nerror2',          // Parse errors
}
```

This environment is serialized and sent to the content script, which injects it.

### 3. **Script Metadata Normalization**

Every userscript has metadata (from `// @` directives):

```javascript
{
  match: ['https://example.com/*'],
  exclude: ['https://example.com/admin/*'],
  grant: ['GM_setValue', 'GM_getValue'],
  run_at: 'document_end',
  inject_into: 'page',               // @inject_into directive
}
```

Normalization ensures:
- @match patterns are properly compiled
- Conflicting directives are resolved (e.g., @exclude vs @excludeMatch)
- Defaults are applied if missing
- Timestamp validation for caching

### 4. **Caching Strategy**

Multiple cache layers for performance:

- **Script Cache** (`cache.js`): Runtime cache of prepared scripts
- **Storage Cache** (`storage-cache.js`): Reactive updates from IDB
- **Icon Cache** (`icon-loader.js`): Downloaded script icons
- **HTTP Blob Cache** (`requests.js`): Large response blob URLs

## Critical Flow Paths

### Adding a Script

```
Options Page (UI)
    ↓
script.js::CreateScript() command
    ↓
db.js::saveScript()
    - Persists to IDB
    - Parses metadata
    ↓
Notifications sent
    - background/index updates badge
    - Popup refreshed
```

### XHR Interception (GM_xmlHttpRequest)

```
Web realm → GM_xmlHttpRequest()
    ↓
content/requests.js (bridges to extension)
    ↓
requests.js::HttpRequest() command
    ↓
XMLHttpRequest made in extension realm
    (has access to cookies, no CORS)
    ↓
Response filtered through requests-core.js
    - Headers manipulated if @grant includes headers
    - Cookies handled per settings
    ↓
Response sent back to web realm
    ↓
GM_xmlHttpRequest callback fired
```

## Data Structures

### VMScript Schema

```typescript
interface VMScript {
  props: {
    id: number;
    uuid: string;
    lastModified: number;
  };
  meta: {
    match: string[];
    grant: string[];
    run_at: 'document-start'|'document-end'|'document-idle';
    inject_into: 'page'|'content'|'auto';
    // ... and 20+ other metadata fields
  };
  custom: {
    include: string[];
    exclude: string[];
    scriptData: any;
    // User customizations
  };
}
```

### Injection Payload Schema

```typescript
interface InjectionPayload {
  [SCRIPTS]: VMInjection.Script[];
  [INJECT_INTO]: 'page'|'content';
  [IDS]: { [id]: true };
  [S_CACHE]: { [url]: scriptCode };
  [S_VALUE]: { [id]: { [key]: value } };
  errors: string;
  ua: string;
}
```

## Performance Considerations

1. **Lazy Loading**: Scripts aren't fetched until page load matches
2. **Blob URLs**: Large responses stored as blob URLs to avoid memory overhead
3. **Incremental Sync**: Only changed scripts synced to cloud
4. **Cached Metadata**: Don't re-parse unchanged scripts
5. **Service Worker Reactivation**: Efficient startup on Chrome MV3

## Testing

Tests are located in `/test`:

- **Unit Tests**: Jest-based tests for utilities and core logic
- **Mock Environment**: `mock/env.js` provides browser API mocks
- **Integration Tests**: Limited (extension model hard to test)

## Troubleshooting

### Script Not Running

1. Check URL patterns (@match/@include)
2. Check @run_at timing
3. Check @grant permissions
4. Check if realm is accessible (CSP issue?)
5. Check popup for injection errors

### Performance Issues

1. Check cache sizes in DevTools
2. Check for huge @require scripts (causes serialization delay)
3. Check for infinite loops in scripts

## Future Improvements

1. Split `db.js` into separate modules (parser, query, storage)
2. Extract `preinject.js` metadata logic
3. Refactor large Vue components into smaller pieces
4. Add more comprehensive test coverage
5. Consider using MV3-compatible service worker APIs for persistence
