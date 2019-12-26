import {
  INJECT_INTERNAL_PAGE, INJECT_INTERNAL_CONTENT, METABLOCK_RE,
} from '#/common/consts';
import bridge from './bridge';
import {
  forEach, includes, match, objectKeys, map, defineProperties, filter, defineProperty, slice,
} from '../utils/helpers';
import { createGmApiProps, propertyFromValue } from './gm-api';

const { startsWith } = String.prototype;

// - Chrome, `global === window`
// - Firefox, `global` is a sandbox, `global.window === window`:
//   - some properties (like `isFinite`) are defined in `global` but not `window`
//   - all `window` properties can be accessed from `global`

// store the initial eval now (before the page scripts run) just in case
let wrapperInfo = {
  global,
  eval: global.eval, // eslint-disable-line no-eval
  unsafeWindow: {
    // run script in page context
    // `unsafeWindow === pageWindow === pageGlobal`
    [INJECT_INTERNAL_PAGE]: global,
    // run script in content context
    // `unsafeWindow === contentGlobal, contentGlobal.window === contentWindow`
    [INJECT_INTERNAL_CONTENT]: global,
  },
};

let gmApi;

export function deletePropsCache() {
  // let GC sweep the no longer necessary stuff
  gmApi = null;
  wrapperInfo = null;
  bridge.props = null;
}

export function wrapGM(script, code, cache, injectInto) {
  const unsafeWindow = wrapperInfo.unsafeWindow[injectInto];
  // Add GM functions
  // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
  const gm = {};
  const grant = script.meta.grant || [];
  let thisObj = gm;
  if (!grant.length || (grant.length === 1 && grant[0] === 'none')) {
    // @grant none
    grant.length = 0;
    gm.window = unsafeWindow;
  } else {
    thisObj = getWrapper();
    thisObj.wrappedJSObject = window.wrappedJSObject;
    gm.window = thisObj;
  }
  if (grant::includes('window.close')) {
    gm.window.close = () => {
      bridge.post({ cmd: 'TabClose' });
    };
  }
  const resources = script.meta.resources || {};
  const gmInfo = propertyFromValue({
    uuid: script.props.uuid,
    scriptMetaStr: code::match(METABLOCK_RE)[1] || '',
    scriptWillUpdate: !!script.config.shouldUpdate,
    scriptHandler: 'Violentmonkey',
    version: bridge.version,
    injectInto,
    platform: { ...bridge.ua },
    script: {
      description: script.meta.description || '',
      excludes: [...script.meta.exclude],
      includes: [...script.meta.include],
      matches: [...script.meta.match],
      name: script.meta.name || '',
      namespace: script.meta.namespace || '',
      resources: objectKeys(resources)::map(name => ({
        name,
        url: resources[name],
      })),
      runAt: script.meta.runAt || '',
      unwrap: false, // deprecated, always `false`
      version: script.meta.version || '',
    },
  });
  const gm4props = { info: gmInfo };
  const grantedProps = {
    unsafeWindow: propertyFromValue(unsafeWindow),
    GM_info: gmInfo,
    GM: propertyFromValue({}),
  };
  let selfData;
  if (!gmApi) gmApi = createGmApiProps();
  grant::forEach((name) => {
    const gm4name = name::startsWith('GM.') && name::slice(3);
    const gm4 = gmApi.gm4[gm4name];
    if (gm4) name = `GM_${gm4.alias || gm4name}`;
    let prop = gmApi.boundProps[name];
    if (prop) {
      const gmFunction = prop.value;
      prop = { ...prop };
      prop.value = gm4 && gm4.async
        ? (async (...args) => gmFunction.apply(selfData, args))
        : ((...args) => gmFunction.apply(selfData, args));
      selfData = true;
    } else {
      prop = gmApi.props[name];
    }
    if (!prop) return;
    if (gm4) gm4props[gm4name] = prop;
    else grantedProps[name] = prop;
  });
  if (selfData) {
    selfData = {
      cache,
      script,
      resources,
      id: script.props.id,
      pathMap: script.custom.pathMap || {},
      urls: {},
    };
  }
  defineProperties(grantedProps.GM.value, gm4props);
  return {
    thisObj,
    wrapper: defineProperties(gm, grantedProps),
    keys: objectKeys(grantedProps),
  };
}

function createWrapperMethods(info) {
  const { global } = info;
  const methods = {};
  [
    // 'uneval',
    'isFinite',
    'isNaN',
    'parseFloat',
    'parseInt',
    'decodeURI',
    'decodeURIComponent',
    'encodeURI',
    'encodeURIComponent',

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
  ]::forEach((name) => {
    const method = global[name];
    if (method) {
      methods[name] = (...args) => method.apply(global, args);
    }
  });
  info.methods = methods;
}

/**
 * @desc Wrap helpers to prevent unexpected modifications.
 */
function getWrapper() {
  const { global } = wrapperInfo;
  if (!wrapperInfo.methods) createWrapperMethods(wrapperInfo);
  // http://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects
  // http://developer.mozilla.org/docs/Web/API/Window
  const wrapper = {
    // `eval` should be called directly so that it is run in current scope
    eval: wrapperInfo.eval,
    ...wrapperInfo.methods,
  };
  if (!wrapperInfo.propsToWrap) {
    wrapperInfo.propsToWrap = bridge.props::filter(p => !(p in wrapper));
    bridge.props = null;
  }

  function wrapWindowValue(value) {
    // Return the window wrapper if the original value is the real `window`
    // so that libraries depending on `window` will work as expected.
    return value === window ? wrapper : value;
  }

  function defineProtectedProperty(name) {
    let modified = false;
    let value;
    defineProperty(wrapper, name, {
      get() {
        if (!modified) value = wrapWindowValue(global[name]);
        return value;
      },
      set(val) {
        modified = true;
        value = val;
      },
      // Allow `defineProperty` and its family members
      configurable: true,
    });
  }

  function defineReactedProperty(name) {
    defineProperty(wrapper, name, {
      get() {
        return wrapWindowValue(global[name]);
      },
      set(val) {
        global[name] = val;
      },
    });
  }

  // Wrap properties
  // A major GC may hit here no matter how we define props
  // all at once, in batches of 10, 100, 500, or one by one.
  // TODO: try Proxy API if userscripts wouldn't notice the difference
  wrapperInfo.propsToWrap::forEach((name) => {
    if (name::startsWith('on')) {
      defineReactedProperty(name);
    } else {
      defineProtectedProperty(name);
    }
  });
  return wrapper;
}
