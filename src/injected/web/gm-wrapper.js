import { hasOwnProperty } from '#/common';
import { INJECT_CONTENT } from '#/common/consts';
import { assign, defineProperty, describeProperty, objectKeys } from '#/common/object';
import bridge from './bridge';
import {
  filter, forEach, includes, map, slice,
  addEventListener, removeEventListener,
} from '../utils/helpers';
import { makeGmApi, vmOwnFunc } from './gm-api';

const {
  Proxy,
  Set, // 2x-3x faster lookup than object::has
  Symbol: { toStringTag, iterator: iterSym },
  Map: { prototype: { get: mapGet, has: mapHas, [iterSym]: mapIter } },
  Set: { prototype: { delete: setDelete, has: setHas, [iterSym]: setIter } },
  Object: { getOwnPropertyNames, getOwnPropertySymbols },
} = global;
/** A bound function won't be stepped-into when debugging.
 * Destructuring a random function reference instead of the long `Function.prototype` */
const { bind } = Proxy;
const { concat, slice: arraySlice } = [];
const { startsWith } = '';

let gmApi;
let gm4Api;
let componentUtils;
// making a local copy to avoid using webpack's import wrappers as .has() is invoked **a lot**
const has = hasOwnProperty;
const IS_TOP = window.top === window;

export function wrapGM(script) {
  // Add GM functions
  // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
  const grant = script.meta.grant || [];
  if (grant.length === 1 && grant[0] === 'none') {
    grant.length = 0;
  }
  const id = script.props.id;
  const resources = script.meta.resources || {};
  const context = {
    id,
    script,
    resources,
    pathMap: script.custom.pathMap || {},
    urls: {},
  };
  const gmInfo = makeGmInfo(script, resources);
  const gm = {
    GM: { info: gmInfo },
    GM_info: gmInfo,
    unsafeWindow: global,
  };
  if (!componentUtils) {
    componentUtils = makeComponentUtils();
  }
  // not using ...spread as it calls Babel's polyfill that calls unsafe Object.xxx
  assign(gm, componentUtils);
  if (grant::includes('window.close')) {
    gm.close = vmOwnFunc(() => bridge.post('TabClose'));
  }
  if (grant::includes('window.focus')) {
    gm.focus = vmOwnFunc(() => bridge.post('TabFocus'));
  }
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
  const metaCopy = {};
  objectKeys(meta)::forEach((key) => {
    let val = meta[key];
    switch (key) {
    case 'match': // -> matches
    case 'excludeMatch': // -> excludeMatches
      key += 'e';
    // fallthrough
    case 'exclude': // -> excludes
    case 'include': // -> includes
      key += 's';
      val = val::arraySlice(); // not using [...val] as it can be broken via Array#Symbol.iterator
      break;
    default:
    }
    metaCopy[key] = val;
  });
  [
    'description',
    'name',
    'namespace',
    'runAt',
    'version',
  ]::forEach((key) => {
    if (!metaCopy[key]) metaCopy[key] = '';
  });
  metaCopy.resources = objectKeys(resources)::map(name => ({
    name,
    url: resources[name],
  }));
  metaCopy.unwrap = false; // deprecated, always `false`
  return {
    uuid: script.props.uuid,
    scriptMetaStr: script.metaStr,
    scriptWillUpdate: !!script.config.shouldUpdate,
    scriptHandler: 'Violentmonkey',
    version: process.env.VM_VER,
    injectInto: bridge.mode,
    platform: assign({}, bridge.ua),
    script: metaCopy,
  };
}

function makeGmMethodCaller(gmMethod, context, isAsync) {
  // keeping the native console.log intact
  return gmMethod === gmApi.GM_log ? gmMethod : vmOwnFunc(
    isAsync
      ? (async (...args) => context::gmMethod(...args))
      : gmMethod::bind(context),
  );
}

const globalKeys = getOwnPropertyNames(window).filter(key => !isFrameIndex(key, true));
/* Chrome and FF page mode: `global` is `window`
   FF content mode: `global` is different, some props e.g. `isFinite` are defined only there */
if (global !== window) {
  const set = new Set(globalKeys);
  getOwnPropertyNames(global).forEach(key => {
    if (!isFrameIndex(key) && !set.has(key)) {
      globalKeys.push(key);
    }
  });
}
// FF doesn't expose wrappedJSObject as own property so we add it explicitly
if (global.wrappedJSObject) {
  globalKeys.push('wrappedJSObject');
}
const inheritedKeys = new Set([
  ...getOwnPropertyNames(EventTarget.prototype),
  ...getOwnPropertyNames(Object.prototype),
]);
inheritedKeys.has = setHas;

/* These can be redefined but can't be assigned, see sandbox-globals.html */
const readonlyKeys = [
  'applicationCache',
  'caches',
  'closed',
  'crossOriginIsolated',
  'crypto',
  'customElements',
  'frameElement',
  'history',
  'indexedDB',
  'isSecureContext',
  'localStorage',
  'mozInnerScreenX',
  'mozInnerScreenY',
  'navigator',
  'sessionStorage',
  'speechSynthesis',
  'styleMedia',
  'trustedTypes',
].filter(key => key in global); // not using global[key] as some of these (caches) may throw

/* These can't be redefined, see sandbox-globals.html */
const unforgeables = new Map([
  'Infinity',
  'NaN',
  'document',
  'location',
  'top',
  'undefined',
  'window',
].map(name => {
  let thisObj;
  const info = (
    describeProperty(thisObj = global, name)
    || describeProperty(thisObj = window, name)
  );
  if (info) {
    // currently only `document`
    if (info.get) info.get = info.get::bind(thisObj);
    // currently only `location`
    if (info.set) info.set = info.set::bind(thisObj);
  }
  return info && [name, info];
}).filter(Boolean));
unforgeables.has = mapHas;
unforgeables[iterSym] = mapIter;

/* ~50 methods like alert/fetch/moveBy that need `window` as `this`, see sandbox-globals.html */
const boundMethods = new Map([
  'addEventListener',
  'alert',
  'atob',
  'blur',
  'btoa',
  'cancelAnimationFrame',
  'cancelIdleCallback',
  'captureEvents',
  'clearInterval',
  'clearTimeout',
  'close',
  'confirm',
  'createImageBitmap',
  'dispatchEvent',
  'dump',
  'fetch',
  'find',
  'focus',
  'getComputedStyle',
  'getDefaultComputedStyle',
  'getSelection',
  'matchMedia',
  'moveBy',
  'moveTo',
  'open',
  'openDatabase',
  'postMessage',
  'print',
  'prompt',
  'queueMicrotask',
  'releaseEvents',
  'removeEventListener',
  'requestAnimationFrame',
  'requestIdleCallback',
  'resizeBy',
  'resizeTo',
  'scroll',
  'scrollBy',
  'scrollByLines',
  'scrollByPages',
  'scrollTo',
  'setInterval',
  'setResizable',
  'setTimeout',
  'sizeToContent',
  'stop',
  'updateCommands',
  'webkitCancelAnimationFrame',
  'webkitRequestAnimationFrame',
  'webkitRequestFileSystem',
  'webkitResolveLocalFileSystemURL',
]
.map((key) => {
  const value = global[key];
  return typeof value === 'function' && [key, value::bind(global)];
})
.filter(Boolean));
boundMethods.get = mapGet;

/**
 * @desc Wrap helpers to prevent unexpected modifications.
 */
function makeGlobalWrapper(local) {
  const events = {};
  const scopeSym = Symbol.unscopables;
  const globals = new Set(globalKeys);
  globals[iterSym] = setIter;
  globals.delete = setDelete;
  globals.has = setHas;
  const readonlys = new Set(readonlyKeys);
  readonlys.delete = setDelete;
  readonlys.has = setHas;
  /* Browsers may return [object Object] for Object.prototype.toString(window)
     on our `window` proxy so jQuery libs see it as a plain object and throw
     when trying to clone its recursive properties like `self` and `window`. */
  defineProperty(local, toStringTag, { get: () => 'Window' });
  const wrapper = new Proxy(local, {
    defineProperty(_, name, desc) {
      const isString = typeof name === 'string';
      if (!isFrameIndex(name, isString)) {
        defineProperty(local, name, desc);
        if (isString) maybeSetEventHandler(name);
        readonlys.delete(name);
      }
      return true;
    },
    deleteProperty(_, name) {
      if (!unforgeables.has(name) && delete local[name]) {
        globals.delete(name);
        return true;
      }
    },
    get(_, name) {
      if (name !== 'undefined' && name !== scopeSym) {
        const value = local[name];
        return value !== undefined || local::has(name)
          ? value
          : resolveProp(name);
      }
    },
    getOwnPropertyDescriptor(_, name) {
      const ownDesc = describeProperty(local, name);
      const desc = ownDesc || globals.has(name) && describeProperty(global, name);
      if (!desc) return;
      if (desc.value === window) desc.value = wrapper;
      // preventing spec violation by duplicating ~10 props like NaN, Infinity, etc.
      if (!ownDesc && !desc.configurable) {
        const { get } = desc;
        if (typeof get === 'function') {
          desc.get = get::bind(global);
        }
        defineProperty(local, name, mapWindow(desc));
      }
      return desc;
    },
    has(_, name) {
      return name === 'undefined' || local::has(name) || globals.has(name);
    },
    ownKeys() {
      return [...globals]::concat(
        // using ::concat since array spreading can be broken via Array.prototype[Symbol.iterator]
        getOwnPropertyNames(local)::filter(notIncludedIn, globals),
        getOwnPropertySymbols(local)::filter(notIncludedIn, globals),
      );
    },
    preventExtensions() {},
    set(_, name, value) {
      const isString = typeof name === 'string';
      if (!readonlys.has(name) && !isFrameIndex(name, isString)) {
        local[name] = value;
        if (isString) maybeSetEventHandler(name, value);
      }
      return true;
    },
  });
  for (const [name, desc] of unforgeables) {
    if (name === 'window' || name === 'top' && IS_TOP) {
      delete desc.get;
      delete desc.set;
      desc.value = wrapper;
    }
    defineProperty(local, name, mapWindow(desc));
  }
  function mapWindow(desc) {
    if (desc && desc.value === window) {
      desc = assign({}, desc);
      desc.value = wrapper;
    }
    return desc;
  }
  function resolveProp(name) {
    let value = boundMethods.get(name);
    const canCopy = value || inheritedKeys.has(name) || globals.has(name);
    if (!value && (canCopy || isFrameIndex(name, typeof name === 'string'))) {
      value = global[name];
    }
    if (value === window) {
      value = wrapper;
    }
    if (canCopy && (
      typeof value === 'function'
      || typeof value === 'object' && value && name !== 'event'
      // window.event contains the current event so it's always different
    )) {
      local[name] = value;
    }
    return value;
  }
  function maybeSetEventHandler(name, value) {
    if (!name::startsWith('on') || !globals.has(name)) {
      return;
    }
    name = name::slice(2);
    window::removeEventListener(name, events[name]);
    if (typeof value === 'function') {
      // the handler will be unique so that one script couldn't remove something global
      // like console.log set by another script
      window::addEventListener(name, events[name] = value::bind(window));
    } else {
      delete events[name];
    }
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

/* The index strings that look exactly like integers can't be forged
   but for example '011' doesn't look like 11 so it's allowed */
function isFrameIndex(key, isString) {
  return isString && key >= 0 && key <= 0xFFFF_FFFE && key === `${+key}`;
}

/** @this {Set} */
function notIncludedIn(key) {
  return !this.has(key);
}
