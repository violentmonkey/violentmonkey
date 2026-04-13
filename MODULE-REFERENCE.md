# Module Reference Guide

## Quick Navigation

This document provides a quick reference for understanding what each major module does and how they interact.

## Background Module (`src/background/*`)

### Core Orchestration

#### `index.js` (Entry Point)
**Purpose**: Service worker/background page initialization and command dispatch  
**Key Exports**:
- Entry point for all browser extension events
- Message handler setup for commands
- Error handling and permission checks

**Key Dependencies**:
- All background/utils modules
- Common event system

**Usage**: 
```javascript
// External code sends commands here
browser.runtime.sendMessage({
  cmd: 'CreateScript',
  data: scriptObj
});
// Handler in init.js processes it
```

---

### Database & Storage

#### `utils/db.js` (900 lines) ⚠️ NEEDS REFACTORING
**Purpose**: Script storage, retrieval, parsing, and metadata management  
**Key Exports**:
- `getScriptsByURL(url, isTop, errors)` - Query scripts by page URL (expensive)
- `parseScript(source)` - Parse userscript source code
- `updateScript(id, data)` - Update script data
- `removeScript(id)` - Delete script

**Key Functions**:
- `parseMetaWithErrors(source)` - Extract and validate @metablock
- `getScriptEnv(scripts)` - Build injection environment
- `readEnvironmentData(scripts)` - Gather @require, values, cache

**Performance Characteristics**:
- `getScriptsByURL()` is O(n*m) where n=scripts, m=URL patterns
- Metadata parsing happens during script creation (cached)
- Should be split into: `db-storage.js`, `db-parser.js`, `db-query.js`

**Example Usage**:
```javascript
// In preinject.js
const env = db.getScriptsByURL(url, isTop, errors);
// Returns: { allIds, SCRIPTS, CODE, CACHE, VALUES }
```

---

#### `utils/storage.js` (200 lines)
**Purpose**: IndexedDB abstraction layer  
**Key Exports**:
- `saveScript(id, data)` - Store script in IDB
- `removeScript(id)` - Delete script from IDB
- `getScript(id)` - Retrieve script from IDB
- `Store` class - Typed storage access

**Note**: Keys prefixed with `S_` (e.g., `S_CODE`, `S_CACHE`) are storage layer constants

**Example**:
```javascript
const script = await Store.scripts.get(scriptId);
```

---

#### `utils/cache.js` (15 lines)
**Purpose**: Runtime cache factory for performance  
**Key Exports**:
- Factory function for creating caches with TTL

**Usage**:
```javascript
const cache = initCache({
  size: 100,
  ttl: 60000 // 1 minute
});
cache.put(key, value);
```

---

#### `utils/storage-cache.js`
**Purpose**: Reactive cache that updates when storage changes  
**Key Features**:
- Listens to storage.onChanged events
- Invalidates cache entries automatically
- Prevents stale data

---

### Injection Pipeline

#### `utils/preinject.js` (800 lines) ⚠️ NEEDS REFACTORING
**Purpose**: Script preparation, environment building, and injection orchestration  
**Key Exports**:
- `getScriptsByURL()` wrapper with caching
- `toggleHeaderInjector()` - Firefox MV2 webRequest setup
- `normalizeRealm()` - Select PAGE vs CONTENT realm

**Complex Functions**:
- `prepare()` - Initial script collection [100+ lines]
- `prepareBag()` - Build injection payload [100+ lines]
- `prepareScript()` - Wrap individual script [150+ lines]
- `prepareXhrBlob()` - Package XHR response [50 lines]

**Should Be Split Into**:
- `meta-normalizer.js` - Metadata handling
- `injection-builder.js` - Payload building
- `preinject-core.js` - Core logic (keep as is)

**Key Concepts**:
- **Bag**: Complete injection payload for a page/frame
- **Realm**: PAGE (web context) vs CONTENT (content script)
- **Wrapping**: Userscript code wrapped in function for scope isolation

#### `utils/tabs.js`
**Purpose**: Tab/frame management and MV3-specific injection routing  
**Key Exports**:
- `canExecuteArbitraryCodeInTab(tabId)` - Check injection capability
- `executeArbitraryCodeInTab()` - Inject code (MV3 workaround)
- `getFrameDocId()` - Frame identifier

**MV3 Specific**:
- Uses `browser.userScripts.execute()` for arbitrary code
- Falls back to `chrome.scripting.executeScript()` with functions
- Handles Chrome CSP restrictions

**Example**:
```javascript
// Chrome MV3 fallback
const result = await browser.userScripts.execute({
  target: { tabId, frameId },
  func: myFunction,
  world: 'MAIN'
});
```

---

### HTTP/XHR Interception

#### `utils/requests-core.js` (200 lines)
**Purpose**: WebRequest API interception (Firefox MV2 only)  
**Key Exports**:
- `toggleHeaderInjector(reqId, headers)` - Enable/disable interception
- `kCookie`, `kSetCookie` - Header constants
- `FORBIDDEN_HEADER_RE` - Chrome forbidden headers regex

**Firefox MV2 Only**:
```javascript
if (hasWebRequest) {
  browser.webRequest.onBeforeSendHeaders.addListener(...)
}
```

**Chrome MV3**: No webRequest support, skipped entirely

---

#### `utils/requests.js` (300 lines)
**Purpose**: XHR/fetch implementation for GM_xmlHttpRequest  
**Key Exports**:
- `HttpRequest(opts, src)` - Create XHR request
- `AbortRequest(id)` - Cancel request
- Response callbacks

**Complex Logic**:
- Chunked response handling for large responses (>1MB)
- Blob URL creation for efficient transfer
- Cookie/header handling per @grant directives

---

#### `utils/cookies.js`
**Purpose**: Cookie management and storage  
**Exports**: Cookie get/set operations via `browser.cookies` API

---

### Resource Management

#### `utils/script.js` (350 lines)
**Purpose**: Script CRUD operations  
**Key Exports**:
- `CreateScript(code)` - Parse and create new script
- `UpdateScript(id, data)` - Update existing script
- `RemoveScript(id)` - Delete script
- `EnableScript(id)`, `DisableScript(id)` - Toggle enabled state

**Command Handler**: Part of public command API

---

#### `utils/icon.js` (350 lines)
**Purpose**: Script icon management and badge display  
**Key Exports**:
- `setBadge()` - Update extension icon badge
- Icon download and cache management

**Features**:
- Downloads @icon URLs as PNG/JPG
- Caches icons locally
- Updates badge with script count

---

#### `utils/values.js`
**Purpose**: GM_Value persistent storage  
**Exports**: Get/set value storage operations

---

### Configuration

#### `utils/options.js` (200 lines)
**Purpose**: Extension settings and preferences  
**Key Exports**:
- `getOption(key)` - Get setting value
- `setOption(key, value)` - Set setting value
- Default options load

**Handles**:
- Version migrations (legacy option cleanup)
- Setting defaults
- Preference persistence

---

#### `utils/notifications.js`
**Purpose**: Popup notification display system  
**Exports**: `Notification()` command for showing popups

---

#### `utils/popup-tracker.js`
**Purpose**: Popup state management across service worker reloads  
**Key Exports**:
- Track which tabs/frames have popup open
- Notify content scripts of popup state

---

### Utilities

#### `utils/ua.js`
**Purpose**: User agent detection and parsing  
**Key Exports**:
- `CHROME` - Chrome version number (or 0)
- `IS_FIREFOX` - Boolean flag
- Version comparisons

---

#### `utils/url.js`
**Purpose**: URL validation and utilities  
**Exports**: URL pattern matching and validation

---

### Data Synchronization

#### `sync/base.js`
**Purpose**: Cloud sync orchestration (Violentmonkey cloud)  
**Features**:
- Conflict resolution
- Incremental sync
- Error handling

**Firefox vs Chrome**: Different retry strategies due to MV3 limitations

---

## Common Module (`src/common/*`)

### Critical Shared Constants

#### `consts.js`
**Purpose**: Global constants used throughout the extension

**Realms**:
```javascript
const PAGE = 'page';           // Web page context
const CONTENT = 'content';     // Content script context
const AUTO = 'auto';           // Auto-select (default)
```

**Metadata Keys**:
```javascript
const INJECT_INTO = 'injectInto';
const S_REQUIRE = 'require';   // Storage key for @require
const S_CODE = 'code';         // Storage key for script code
const S_VALUE = 'values';      // Storage key for GM_Value
```

**Injection Payload Keys**:
```javascript
const SCRIPTS = 'scripts';
const INJECT = 'inject';
const MORE = 'more';
const CACHE_KEYS = 'cacheKeys';
```

---

### Utilities

#### `object.js`
**Purpose**: Object manipulation utilities  
**Exports**:
- `deepCopy(obj)` - Recursive clone
- `forEachEntry(obj, fn)` - Iterate object entries
- `mapEntry(obj, fn)` - Transform object
- `objectPick(obj, keys)` - Select subset of keys

---

#### `string.js`
**Purpose**: String manipulation  
**Exports**: String utilities

---

#### `browser.js`
**Purpose**: Browser API normalization (Chrome vs Firefox)  
**Exports**:
- Normalized API access
- Feature detection

---

#### `events.js`
**Purpose**: Event bus for inter-module communication  
**Usage**: Publish/subscribe pattern for module coordination

---

#### `download.js`
**Purpose**: File download functionality  
**Exports**: `downloadBlob()`, etc.

---

#### `cache.js`
**Purpose**: Generic cache factory with TTL  
**Usage**:
```javascript
const cache = initCache();
cache.put(key, value);
const val = cache.get(key);
```

---

## Injected Module (`src/injected/*`)

### Injection Entry Points

#### `index.js`
**Purpose**: Injected script initialization  
**Runs**: In web page realm
**Connections**: Receives injection payloads from content script

---

#### `safe-globals.js`
**Purpose**: Safe references to global objects protected from page tampering  
**Key Exports**:
- `SafePromise`, `SafeObject`, `SafeArray` - Protected builtins
- Proto validation to detect override attempts

**Critical**: These prevent userscript pages from breaking the extension

---

### Content Script Bridge

#### `content/index.js`
**Purpose**: Content script setup and command handling  
**Responsibilities**:
- Receive GetInjected command
- Route to injected scripts
- Bridge messages between web realm and extension

---

#### `content/inject.js`
**Purpose**: Script injection orchestration  
**Key Functions**:
- `triageRealms()` - Select and route to appropriateinjection method
- Realm-specific injection logic

---

#### `content/requests.js`
**Purpose**: XHR/fetch interception in content script realm  
**Functionality**:
- Intercept XHR calls
- Route to background extension realm
- Return responses

---

### Web Realm API

#### `web/gm-api.js` (∞ lines)
**Purpose**: GM_* API implementations in web realm  
**Implements**:
- `GM_setValue()`, `GM_getValue()` - Persistent storage
- `GM_xmlHttpRequest()` - XHR with special permissions
- `GM_setClipboard()` - Clipboard access
- `GM_info` - Script metadata
- ... and 15+ other GM functions

**Note**: These run in web realm so must communicate back to extension for actual operations

---

#### `web/gm-global-wrapper.js`
**Purpose**: Global scope management  
**Functionality**:
- Wraps userscript global in Proxy
- Isolates from page scripts
- Catches unsafe operations

---

## UI Modules

### Options Page (`src/options/*`)

#### `views/app.vue`
**Purpose**: Main options UI  
**Sections**:
- Script editor
- Settings panel
- Script list with search/filter

---

### Popup (`src/popup/*`)

#### `views/app.vue`
**Purpose**: Quick popup when extension icon clicked  
**Shows**:
- Enabled/disabled scripts for current page
- Quick toggles
- Status indicators

---

## Data Flow Diagram

```
┌─────────────────┐
│  Web Page      │
│  (userscript)   │
└────────|────────┘
         │ GM_* call (postMessage)
         ↓
┌─────────────────┐
│ Content Script  │
│ (content realm)  │
└────────|────────┘
         │ Chrome.runtime.sendMessage
         ↓
┌──────────────────────────┐
│ Background Service       │
│ Worker / Background      │→ ┌────────────┐
│ (extension realm)        │  │ IndexedDB  │
│                          │  │  (Storage) │
│ - requests.js (XHR)      │  └────────────┘
│ - db.js (Scripts)        │
│ - preinject.js (Inject)  │
└────────|────────────────┘
         │ chrome.runtime.sendMessage
         ↓
┌─────────────────┐
│ Content Script  │
│ (responds)      │
└─────────────────┘
```

## Import Patterns

### Background Module Imports

```javascript
// Constants
import { SCRIPTS, INJECT, FORCE_CONTENT } from '@/common/consts';

// Storage
import { getScript, saveScript } from './storage';

// Utilities
import { deepCopy, forEachEntry } from '@/common/object';

// Other background utils
import { setBadge } from './icon';
import { sendTabCmd } from '@/common'; // Send to content script
```

### Injected Module Imports

```javascript
// Safe globals (CRITICAL - protects from page tampering)
import { SafePromise, SafeArray } from '../safe-globals';

// Constants
import { GRANT_NONE } from '@/common/consts';

// Utilities (CAREFUL - may be spoofed by page)
import { isEmpty, objectPick } from '@/common/object';
```

**Warning**: In injected realm, all imports might be spoofed by page. Use safe-globals for protection.

---

## Testing Module Interactions

### Example: Creating a Script

1. **User fills form in Options UI** (options/views/edit/index.vue)
2. **Vue component calls**:
   ```javascript
   await browser.runtime.sendMessage({
     cmd: 'CreateScript',
     data: { code: '...', meta: {...} }
   });
   ```

3. **Background handler** (background/index.js) →
   **Routed to** (background/utils/init.js → script.js)

4. **script.js::CreateScript** →
   - Calls `db.parseScript()` to validate
   - Calls `storage.saveScript()` to store in IDB
   - Notifies UI of success

5. **bg/icon.js** updates badge

6. **bg/preinject.js** invalidates cache

7. **Next page load** → getScriptsByURL includes new script

---

## Debugging Tips

### Finding Where a Script Runs

1. Add breakpoint in `preinject.js::getScriptsByURL()`
2. Check if script matched patterns
3. Check realm selection in `prepareScript()`

### Checking XHR Interception

1. Look in `requests.js::HttpRequest` for request setup
2. Check `requests-core.js` for header manipulation (Firefox only)
3. Verify content script bridging in `content/requests.js`

### Service Worker Reload Issues (Chrome)

1. Go to chrome://extensions/
2. Click "Unload" for extension
3. Reload page → Service worker auto-reloads
4. Check if cache properly rebuilt

---

## Common Gotchas

1. **Async Storage** - All IDB operations are async, remember `.then()` or `await`
2. **Realm Boundaries** - Can't directly access web realm from content script
3. **Service Worker Unload** - Global variables reset, use IDB for persistence
4. **webRequest Only on Firefox** - Always check `hasWebRequest` before using
5. **CSP Restrictions** - Some pages don't allow extension injection at all

---

## Contributing Guidelines

When modifying modules:

1. **Don't cross realm boundaries** without message passing
2. **Use safe-globals** in injected scripts
3. **Cache aggressively** in background (service worker reloads often)
4. **Document MV3 limitations** in comments
5. **Test on both Chrome and Firefox** when possible
6. **Keep files <300 lines** - split larger modules
7. **Use existing utilities** from common/ - don't duplicate

---

## Further Reading

- See [ARCHITECTURE.md](./ARCHITECTURE.md) for system overview
- See [MV3-MIGRATION.md](./MV3-MIGRATION.md) for Chrome MV3 details
- Check `/test` for example usage patterns
