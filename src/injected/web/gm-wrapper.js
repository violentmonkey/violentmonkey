import { hasOwnProperty as has } from '#/common';
import { INJECT_CONTENT } from '#/common/consts';
import { defineProperty, describeProperty, objectKeys } from '#/common/object';
import bridge from './bridge';
import {
  concat, filter, forEach, includes, indexOf, map, push, slice,
  replace, addEventListener, removeEventListener,
} from '../utils/helpers';
import { makeGmApi, vmOwnFunc } from './gm-api';

const { Proxy } = global;
const { getOwnPropertyNames, getOwnPropertySymbols } = Object;
const { splice } = Array.prototype;
const { startsWith } = String.prototype;

let gmApi;
let gm4Api;
let componentUtils;
let windowClose;
const { toStringTag } = Symbol;
const vmSandboxedFuncToString = nativeFunc => () => (
  `${nativeFunc}`::replace('native code', 'Violentmonkey sandbox')
);

export function deletePropsCache() {
  // let GC sweep the no longer necessary stuff
  gmApi = null;
  gm4Api = null;
  componentUtils = null;
}

export function wrapGM(script) {
  // Add GM functions
  // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
  const grant = script.meta.grant || [];
  if (grant.length === 1 && grant[0] === 'none') {
    grant.length = 0;
  }
  const id = script.props.id;
  const resources = script.meta.resources || {};
  const gmInfo = makeGmInfo(script, resources);
  const gm = {
    GM: { info: gmInfo },
    GM_info: gmInfo,
    unsafeWindow: global,
    ...componentUtils || (componentUtils = makeComponentUtils()),
    ...grant::includes('window.close') && windowClose || (windowClose = {
      close: vmOwnFunc(() => bridge.post('TabClose')),
    }),
  };
  const context = {
    id,
    script,
    resources,
    pathMap: script.custom.pathMap || {},
    urls: {},
  };
  if (!gmApi) [gmApi, gm4Api] = makeGmApi();
  grant::forEach((name) => {
    const gm4name = name::startsWith('GM.') && name::slice(3);
    const gm4 = gm4Api[gm4name];
    const method = gmApi[gm4 ? `GM_${gm4.alias || gm4name}` : name];
    if (method) {
      const caller = makeGmMethodCaller(method, context, gm4?.async);
      if (gm4) gm.GM[gm4name] = caller;
      else gm[name] = caller;
    }
  });
  return grant.length ? makeGlobalWrapper(gm) : gm;
}

function makeGmInfo(script, resources) {
  const { meta } = script;
  return {
    uuid: script.props.uuid,
    scriptMetaStr: script.metaStr,
    scriptWillUpdate: !!script.config.shouldUpdate,
    scriptHandler: 'Violentmonkey',
    version: process.env.VM_VER,
    injectInto: bridge.mode,
    platform: { ...bridge.ua },
    script: {
      description: meta.description || '',
      excludes: [...meta.exclude],
      includes: [...meta.include],
      matches: [...meta.match],
      name: meta.name || '',
      namespace: meta.namespace || '',
      resources: objectKeys(resources)::map(name => ({
        name,
        url: resources[name],
      })),
      runAt: meta.runAt || '',
      unwrap: false, // deprecated, always `false`
      version: meta.version || '',
    },
  };
}

function makeGmMethodCaller(gmMethod, context, isAsync) {
  // keeping the native console.log intact
  return gmMethod === gmApi.GM_log ? gmMethod : vmOwnFunc(
    isAsync
      ? (async (...args) => context::gmMethod(...args))
      : ((...args) => context::gmMethod(...args)),
  );
}

// https://html.spec.whatwg.org/multipage/window-object.html#the-window-object
// https://w3c.github.io/webappsec-secure-contexts/#monkey-patching-global-object
// https://compat.spec.whatwg.org/#windoworientation-interface
const readonlyGlobals = [
  'applicationCache',
  'closed',
  'customElements',
  'frameElement',
  'history',
  'isSecureContext',
  'navigator',
  'orientation',
  'styleMedia',
];
// https://html.spec.whatwg.org/multipage/window-object.html
// https://w3c.github.io/webappsec-trusted-types/dist/spec/#extensions-to-the-window-interface
const unforgeableGlobals = [
  'document',
  'location',
  'top',
  'trustedTypes',
  'window',
];
// the index strings that look exactly like integers can't be forged
// but for example '011' doesn't look like 11 so it's allowed
const isUnforgeableFrameIndex = name => typeof name !== 'symbol' && /^(0|[1-9]\d+)$/.test(name);
// These can't run with an arbitrary object in `this` such as our wrapper
// https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects
// https://developer.mozilla.org/docs/Web/API/Window
const boundGlobals = [
  'addEventListener',
  'alert',
  'atob',
  'blur',
  'btoa',
  'clearInterval',
  'clearTimeout',
  'close',
  'confirm',
  'dispatchEvent',
  'fetch',
  'find',
  'focus',
  'getComputedStyle',
  'getDefaultComputedStyle', // Non-standard, Firefox only, used by jQuery
  'getSelection',
  'matchMedia',
  'moveBy',
  'moveTo',
  'open',
  'openDialog',
  'postMessage',
  'print',
  'prompt',
  'removeEventListener',
  'requestAnimationFrame',
  'resizeBy',
  'resizeTo',
  'scroll',
  'scrollBy',
  'scrollByLines',
  'scrollByPages',
  'scrollTo',
  'setInterval',
  'setTimeout',
  'stop',
];
const boundGlobalsRunner = (func, thisArg) => (...args) => thisArg::func(...args);
/**
 * @desc Wrap helpers to prevent unexpected modifications.
 */
function makeGlobalWrapper(local) {
  const events = {};
  const deleted = []; // using an array to skip building it in ownKeys()
  const scopeSym = Symbol.unscopables;
  /*
   - Chrome, `global === window`
   - Firefox, `global` is a sandbox, `global.window === window`:
     - some properties (like `isFinite`) are defined in `global` but not `window`
     - all `window` properties can be accessed from `global`
  */
  if (bridge.isFirefox) {
    // Firefox returns [object Object] so jQuery libs see our `window` proxy as a plain
    // object and try to clone its recursive properties like `self` and `window`.
    // Note that Chrome returns [object Window] so it's probably a bug in Firefox.
    defineProperty(local, toStringTag, { get: () => 'Window' });
  }
  const wrapper = new Proxy(local, {
    defineProperty(_, name, info) {
      if (typeof name !== 'symbol'
      && (unforgeableGlobals::includes(name) || isUnforgeableFrameIndex(name))) return false;
      defineProperty(local, name, info);
      if (typeof name === 'string' && name::startsWith('on')) {
        setEventHandler(name::slice(2));
      }
      undelete(name);
      return true;
    },
    deleteProperty(_, name) {
      if (unforgeableGlobals::includes(name)) return false;
      if (isUnforgeableFrameIndex(name) || deleted::includes(name)) return true;
      if (global::has(name)) deleted::push(name);
      return delete local[name];
    },
    get(_, name) {
      const value = local[name];
      return value !== undefined || name === scopeSym || deleted::includes(name) || local::has(name)
        ? value
        : resolveProp(name);
    },
    getOwnPropertyDescriptor(_, name) {
      if (!deleted::includes(name)) {
        const ownDesc = describeProperty(local, name);
        const desc = ownDesc || describeProperty(global, name);
        if (!desc) return;
        if (desc.value === window) desc.value = wrapper;
        // preventing spec violation by duplicating ~10 props like NaN, Infinity, etc.
        if (!ownDesc && !desc.configurable) {
          const { get } = desc;
          if (typeof get === 'function') {
            desc.get = (...args) => global::get(...args);
          }
          defineProperty(local, name, desc);
        }
        return desc;
      }
    },
    has(_, name) {
      return local::has(name)
        || !deleted::includes(name) && global::has(name);
    },
    ownKeys() {
      return []::concat(
        ...filterGlobals(getOwnPropertyNames),
        ...filterGlobals(getOwnPropertySymbols),
      );
    },
    preventExtensions() {},
    set(_, name, value) {
      if (unforgeableGlobals::includes(name)) return false;
      undelete(name);
      if (readonlyGlobals::includes(name) || isUnforgeableFrameIndex(name)) return true;
      local[name] = value;
      if (typeof name === 'string' && name::startsWith('on') && window::has(name)) {
        setEventHandler(name::slice(2), value);
      }
      return true;
    },
  });
  function filterGlobals(describer) {
    const globalKeys = describer(global);
    const localKeys = describer(local);
    return [
      deleted.length
        ? globalKeys::filter(key => !deleted::includes(key))
        : globalKeys,
      localKeys::filter(key => !globalKeys::includes(key)),
    ];
  }
  function resolveProp(name) {
    let value = global[name];
    if (value === window) {
      value = wrapper;
    } else if (boundGlobals::includes(name)) {
      value = vmOwnFunc(
        boundGlobalsRunner(value, global),
        vmSandboxedFuncToString(value),
      );
      local[name] = value;
    }
    return value;
  }
  function setEventHandler(name, value) {
    window::removeEventListener(name, events[name]);
    if (typeof value === 'function') {
      // the handler will be unique so that one script couldn't remove something global
      // like console.log set by another script
      window::addEventListener(name, events[name] = boundGlobalsRunner(value, window));
    } else {
      delete events[name];
    }
  }
  function undelete(name) {
    const i = deleted::indexOf(name);
    if (i >= 0) deleted::splice(i, 1);
  }
  return wrapper;
}

// Adding the polyfills in Chrome (always as it doesn't provide them)
// and in Firefox page mode (while preserving the native ones in content mode)
// for compatibility with many [old] scripts that use these utils blindly
function makeComponentUtils() {
  const source = bridge.mode === INJECT_CONTENT && global;
  return {
    cloneInto: source.cloneInto || vmOwnFunc(
      (obj) => obj,
    ),
    createObjectIn: source.createObjectIn || vmOwnFunc(
      (targetScope, { defineAs } = {}) => {
        const obj = {};
        if (defineAs) targetScope[defineAs] = obj;
        return obj;
      },
    ),
    exportFunction: source.exportFunction || vmOwnFunc(
      (func, targetScope, { defineAs } = {}) => {
        if (defineAs) targetScope[defineAs] = func;
        return func;
      },
    ),
  };
}
