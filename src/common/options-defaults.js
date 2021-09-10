import { INJECT_AUTO } from './consts';

export default {
  isApplied: true,
  autoUpdate: 1, // days, 0 = disable
  // ignoreGrant: false,
  lastUpdate: 0,
  lastModified: 0,
  /** @typedef {'unique' | 'total' | ''} VMBadgeMode */
  /** @type VMBadgeMode */
  showBadge: 'unique',
  badgeColor: '#880088',
  badgeColorBlocked: '#888888',
  exportValues: true,
  expose: { // use percent-encoding for '.'
    'greasyfork%2Eorg': true,
    'sleazyfork%2Eorg': false,
  },
  closeAfterInstall: false,
  trackLocalFile: false,
  autoReload: false,
  features: null,
  blacklist: null,
  syncScriptStatus: true,
  sync: null,
  customCSS: null,
  importScriptData: true,
  importSettings: true,
  notifyUpdates: false,
  notifyUpdatesGlobal: false, // `true` ignores script.config.notifyUpdates
  version: null,
  /** @type {'auto' | 'page' | 'content'} */
  defaultInjectInto: INJECT_AUTO,
  filters: {
    /** @type {'name' | 'code' | 'all'} */
    searchScope: 'name',
    /** @type boolean */
    showOrder: false,
    /** @type {'exec' | 'alpha' | 'update'} */
    sort: 'exec',
    /** @type boolean */
    viewSingleColumn: false,
    /** @type boolean */
    viewTable: false,
  },
  filtersPopup: {
    /** @type {'exec' | 'alpha'} */
    sort: 'exec',
    enabledFirst: false,
    /** @type {'' | 'hide' | 'group'} where '' = show */
    hideDisabled: '',
  },
  editor: {
    lineWrapping: false,
    indentWithTabs: false,
    indentUnit: 2,
    tabSize: 2,
    undoDepth: 200,
  },
  editorTheme: '',
  editorThemeName: null,
  editorWindow: false, // whether popup opens editor in a new window
  editorWindowPos: {}, // { left, top, width, height }
  editorWindowSimple: true, // whether to open a simplified popup or a normal browser window
  scriptTemplate: `\
// ==UserScript==
// @name        New script {{name}}
// @namespace   Violentmonkey Scripts
// @match       {{url}}
// @grant       none
// @version     1.0
// @author      -
// @description {{date}}
// ==/UserScript==
`,
  // Enables automatic updates to the default template with new versions of VM
  /** @type {?Boolean} this must be |null| for template-hook.js upgrade routine */
  scriptTemplateEdited: null,
};
