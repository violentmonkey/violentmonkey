# Project Setup and Key Files

## Core Project Files

### Configuration Files
- `package.json` - Node.js project configuration, dependencies, and scripts
- `jsconfig.json` - JavaScript/TypeScript configuration
- `babel.config.js` - Babel transpilation settings
- `.eslintrc.js` - ESLint code style and quality rules
- `.postcssrc.js` - PostCSS configuration for CSS processing
- `.browserslistrc` - Target browser compatibility settings
- `.editorconfig` - Editor formatting settings
- `gulpfile.js` - Build system configuration

### Source Code Structure (`src/`)
- `manifest.yml` - Browser extension manifest defining permissions and entry points
- `types.d.ts` - TypeScript type definitions
- `background/` - Extension's background service worker
  - `index.js` - Main background script entry point
  - `sync/` - Cloud synchronization implementations
  - `utils/` - Utility functions for background operations
  - `plugin/` - Plugin system implementation
- `popup/` - Extension popup UI
- `options/` - Settings page
- `injected/` - Content scripts for webpage injection
- `common/` - Shared utilities and components
- `_locales/` - Internationalization files
- `resources/` - Static resources and assets

### Build and Utility Scripts (`scripts/`)
- `webpack.conf.js` - Main webpack configuration
- `webpack-base.js` - Base webpack configuration shared across builds
- `webpack-util.js` - Webpack utility functions
- `manifest-helper.js` - Manifest processing utilities
- `i18n.js` - Internationalization build tools
- `release-helper.mjs` - Release automation
- `amo-upload.mjs` - Mozilla Add-ons (AMO) deployment
- `transifex.mjs` - Translation management
- `common.js` - Shared build utilities

## Development Workflow

### Key Commands
- `yarn dev` - Start development environment
- `yarn build` - Production build
- `yarn test` - Run test suite
- `yarn lint` - Code quality checks
- `yarn i18n` - Update translations

### Build System
The project uses a combination of:
- Gulp for task orchestration
- Webpack for module bundling
- Babel for JavaScript transpilation
- PostCSS for CSS processing
- TypeScript for type checking

### Extension Architecture
- **Background Script**: Persistent service worker (`src/background/index.js`)
- **Popup UI**: Browser action popup interface
- **Options Page**: Full-page settings interface
- **Content Scripts**: Webpage injection and userscript execution
- **Sync System**: Cloud storage integration (WebDAV, Google Drive)

## Development Guidelines

### Code Style
- Use ESLint and Prettier for code formatting
- Follow TypeScript type definitions
- Maintain browser compatibility per `.browserslistrc`

### Testing
- Jest for unit testing
- Test files located alongside source code
- Run `yarn test` before commits

### Internationalization
- Use `_locales` for all user-facing strings
- Manage translations via Transifex
- Run `yarn i18n` to update language files

### Version Control
- Husky pre-commit hooks for quality checks
- Conventional commit messages
- Automated release process via GitHub Actions

## Rebranding Requirements
The following text replacements need to be made to rebrand from Violentmonkey to MCPMonkey:

### Package Configuration
- `package.json`:
  - `"name": "violentmonkey"` → `"name": "mcpmonkey"`
  - `"description": "Violentmonkey"` → `"description": "MCPMonkey"`
  - All GitHub URLs from `violentmonkey/violentmonkey` to new repository
  - NPM package `@violentmonkey/shortcut` may need forking/replacement
  - NPM package `@violentmonkey/types` may need forking/replacement

### Manifest and Build Scripts
- `scripts/manifest-helper.js`:
  - Update GitHub URLs for updates
  - Replace "Violentmonkey BETA" with "MCPMonkey BETA"

### JavaScript Source Files
- `src/common/safe-globals-shared.js`:
  - Update `VIOLENTMONKEY` constant to `'MCPMonkey'`
- `src/common/consts.js`:
  - Update `VM_HOME` URL
- `src/common/options-defaults.js`:
  - Update export template and namespace template
- `src/background/sync/base.js`:
  - Update metaFile constant and compatibility comments
- `src/background/sync/googledrive.js`:
  - Update boundary string
- `src/background/sync/webdav.js`:
  - Update WebDAV directory name
- `src/background/utils/options.js`:
  - Update default namespace
- All files using `VIOLENTMONKEY` constant:
  - Update error messages
  - Update logging messages
  - Update API references
  - Update IndexedDB database name

### Localization Files
All `src/_locales/*/messages.yml` files need updating:
- Replace "Violentmonkey" with "MCPMonkey" in:
  - Extension name
  - About page title
  - Settings references
  - Website links
  - Status messages
  - Error messages
  - Blacklist references
  - Button descriptions
  - Menu items
  - Tooltips

### Additional Considerations
- Review and update any documentation files
- Check for any hardcoded URLs in the codebase
- Update browser extension IDs and store listings
- Review and update any browser-specific configurations
- Consider creating new NPM organization/scope for forked packages
- Update GitHub issue references in comments
- Review and update any browser extension manifest IDs
- Consider impact on existing user data (IndexedDB, storage)
- Plan migration path for existing users if needed
