import { INJECT_CONTENT, METABLOCK_RE } from '#/common/consts';
import bridge from './bridge';
import {
  filter, forEach, includes, map, match, slice, assign, defineProperty, defineProperties,
  describeProperty, objectKeys, addEventListener, removeEventListener,
} from '../utils/helpers';
import { makeGmApi } from './gm-api';

const { Proxy } = global;
const { hasOwnProperty: has } = Object.prototype;
const { startsWith } = String.prototype;

let gmApi;
let gm4Api;
let componentUtils;
const propertyToString = {
  toString: () => '[Violentmonkey property]',
};

export function deletePropsCache() {
  // let GC sweep the no longer necessary stuff
  gmApi = null;
  gm4Api = null;
  componentUtils = null;
}

export function wrapGM(script, code, cache, injectInto) {
  // Add GM functions
  // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
  const gm = {};
  const grant = script.meta.grant || [];
  let thisObj = gm;
  if (!grant.length || (grant.length === 1 && grant[0] === 'none')) {
    // @grant none
    grant.length = 0;
    gm.window = global;
  } else {
    thisObj = makeGlobalWrapper();
    gm.window = thisObj;
  }
  if (grant::includes('window.close')) {
    gm.window.close = () => bridge.post('TabClose');
  }
  const resources = script.meta.resources || {};
  const gmInfo = makeGmInfo(script, code, resources, injectInto);
  const gm4Props = { info: { value: gmInfo } };
  const gm4Object = {};
  const grantedProps = {
    ...componentUtils || (componentUtils = makeComponentUtils()),
    unsafeWindow: { value: global },
    GM_info: { value: gmInfo },
    GM: { value: gm4Object },
  };
  const context = {
    cache,
    script,
    resources,
    id: script.props.id,
    pathMap: script.custom.pathMap || {},
    urls: {},
  };
  if (!gmApi) [gmApi, gm4Api] = makeGmApi();
  grant::forEach((name) => {
    const gm4name = name::startsWith('GM.') && name::slice(3);
    const gm4 = gm4Api[gm4name];
    const method = gmApi[gm4 ? `GM_${gm4.alias || gm4name}` : name];
    if (method) {
      const prop = makeGmMethodProp(method, context, gm4?.async);
      if (gm4) gm4Props[gm4name] = prop;
      else grantedProps[name] = prop;
    }
  });
  defineProperties(gm4Object, gm4Props);
  defineProperties(gm, grantedProps);
  return { gm, thisObj, keys: objectKeys(grantedProps) };
}

function makeGmInfo({ config, meta, props }, code, resources, injectInto) {
  return {
    uuid: props.uuid,
    scriptMetaStr: code::match(METABLOCK_RE)[1] || '',
    scriptWillUpdate: !!config.shouldUpdate,
    scriptHandler: 'Violentmonkey',
    version: bridge.version,
    injectInto,
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

function makeGmMethodProp(gmMethod, context, isAsync) {
  return {
    // keeping the native console.log intact
    value: gmMethod === gmApi.GM_log ? gmMethod : assign(
      isAsync
        ? (async (...args) => context::gmMethod(...args))
        : ((...args) => context::gmMethod(...args)),
      propertyToString,
    ),
  };
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
const boundGlobalsRunner = {
  apply: (fn, thisArg, args) => fn.apply(global, args),
};
/**
 * @desc Wrap helpers to prevent unexpected modifications.
 */
function makeGlobalWrapper() {
  const props = {};
  const events = {};
  const deleted = {};
  // - Chrome, `global === window`
  // - Firefox, `global` is a sandbox, `global.window === window`:
  //   - some properties (like `isFinite`) are defined in `global` but not `window`
  //   - all `window` properties can be accessed from `global`
  const wrapper = new Proxy(props, {
    defineProperty(_, name, info) {
      if (unforgeableGlobals::includes(name) || isUnforgeableFrameIndex(name)) return false;
      defineProperty(props, name, info);
      if (name::startsWith('on')) {
        setEventHandler(name::slice(2));
      }
      delete deleted[name];
      return true;
    },
    deleteProperty(_, name) {
      if (unforgeableGlobals::includes(name) || deleted::has(name)) return false;
      if (isUnforgeableFrameIndex(name)) return true;
      if (global::has(name)) deleted[name] = 1;
      return delete props[name];
    },
    get(_, name) {
      if (!deleted::has(name)) {
        const value = props[name];
        return value !== undefined || props::has(name) ? value : resolveProp(name);
      }
    },
    getOwnPropertyDescriptor(_, name) {
      const desc = describeProperty(props, name) ?? describeProperty(wrapper[name]);
      if (desc?.value === window) desc.value = wrapper;
      return desc;
    },
    has(_, name) {
      return props::has(name)
        || !deleted::has(name) && global::has(name);
    },
    ownKeys() {
      const modifiedKeys = objectKeys(props);
      const deletedKeys = objectKeys(deleted);
      let keys = objectKeys(global);
      if (deletedKeys.length || modifiedKeys.length) {
        keys = keys::filter(k => !deletedKeys::includes(k) && !modifiedKeys::includes(k));
      }
      return modifiedKeys.length ? [...keys, ...modifiedKeys] : keys;
    },
    set(_, name, value) {
      if (unforgeableGlobals::includes(name)) return false;
      delete deleted[name];
      if (readonlyGlobals::includes(name) || isUnforgeableFrameIndex(name)) return true;
      props[name] = value;
      if (name::startsWith('on') && window::has(name)) {
        setEventHandler(name::slice(2), value);
      }
      return true;
    },
  });
  function resolveProp(name) {
    let value = global[name];
    if (value === window) {
      value = wrapper;
    } else if (boundGlobals::includes(name)) {
      value = new Proxy(value, boundGlobalsRunner);
      props[name] = value;
    }
    return value;
  }
  function setEventHandler(name, value) {
    window::removeEventListener(name, events[name]);
    if (typeof value === 'function') {
      // the handler will be unique so that one script couldn't remove something global
      // like console.log set by another script
      window::addEventListener(name, events[name] = (...args) => value.apply(window, args));
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
    cloneInto: {
      value: source.cloneInto || assign(
        (obj) => obj,
        propertyToString,
      ),
    },
    createObjectIn: {
      value: source.createObjectIn || assign(
        (targetScope, { defineAs } = {}) => {
          const obj = {};
          if (defineAs) targetScope[defineAs] = obj;
          return obj;
        },
        propertyToString,
      ),
    },
    exportFunction: {
      value: source.exportFunction || assign(
        (func, targetScope, { defineAs } = {}) => {
          if (defineAs) targetScope[defineAs] = func;
          return func;
        },
        propertyToString,
      ),
    },
  };
}
