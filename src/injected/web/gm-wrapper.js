import { INJECT_PAGE, INJECT_CONTENT, METABLOCK_RE } from '#/common/consts';
import bridge from './bridge';
import {
  forEach, includes, match, objectKeys, map, defineProperties, filter, defineProperty,
} from '../utils/helpers';
import { createGmApiProps, propertyFromValue } from './gm-api';

const { startsWith } = String.prototype;

let wrapperInfo = {
  [INJECT_CONTENT]: { unsafeWindow: global },
  [INJECT_PAGE]: { unsafeWindow: window },
  // store the initial eval now (before the page scripts run) just in case
  eval: {
    [INJECT_CONTENT]: global.eval, // eslint-disable-line no-eval
    [INJECT_PAGE]: window.eval, // eslint-disable-line no-eval
  },
};

let gmApi;

export function deletePropsCache() {
  // let GC sweep the no longer necessary stuff
  gmApi = null;
  wrapperInfo = null;
  bridge.props = null;
}

export function wrapGM(script, code, cache) {
  const { unsafeWindow } = wrapperInfo[bridge.mode];
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
    gm.window = thisObj;
  }
  if (grant::includes('window.close')) {
    gm.window.close = () => {
      bridge.post({ cmd: 'TabClose' });
    };
  }
  const resources = script.meta.resources || {};
  const gmInfo = {
    uuid: script.props.uuid,
    scriptMetaStr: code::match(METABLOCK_RE)[1] || '',
    scriptWillUpdate: !!script.config.shouldUpdate,
    scriptHandler: 'Violentmonkey',
    version: bridge.version,
    injectInto: bridge.mode,
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
  };
  const grantedProps = {
    unsafeWindow: propertyFromValue(unsafeWindow),
    GM_info: propertyFromValue(gmInfo),
  };
  let selfData;
  if (!gmApi) gmApi = createGmApiProps();
  grant::forEach((name) => {
    let prop = gmApi.boundProps[name];
    if (prop) {
      const gmFunction = prop.value;
      prop = { ...prop };
      prop.value = (...args) => gmFunction.apply(selfData, args);
      selfData = true;
    } else {
      prop = gmApi.props[name];
    }
    if (prop) grantedProps[name] = prop;
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
  return {
    thisObj,
    wrapper: defineProperties(gm, grantedProps),
    keys: objectKeys(grantedProps),
  };
}

function createWrapperMethods(info) {
  const { unsafeWindow } = info;
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
    const method = unsafeWindow[name];
    if (method) {
      methods[name] = (...args) => method.apply(unsafeWindow, args);
    }
  });
  info.methods = methods;
}

/**
 * @desc Wrap helpers to prevent unexpected modifications.
 */
function getWrapper() {
  const info = wrapperInfo[bridge.mode];
  const { unsafeWindow } = info;
  if (!info.methods) createWrapperMethods(info);
  // http://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects
  // http://developer.mozilla.org/docs/Web/API/Window
  const wrapper = {
    // Block special objects
    browser: undefined,
    // `eval` should be called directly so that it is run in current scope
    eval: wrapperInfo.eval[bridge.mode],
    ...info.methods,
  };
  if (!info.propsToWrap) {
    info.propsToWrap = bridge.props::filter(p => !(p in wrapper));
    bridge.props = null;
  }

  function defineProtectedProperty(name) {
    let modified = false;
    let value;
    defineProperty(wrapper, name, {
      get() {
        if (!modified) value = unsafeWindow[name];
        return value === unsafeWindow ? wrapper : value;
      },
      set(val) {
        modified = true;
        value = val;
      },
    });
  }

  function defineReactedProperty(name) {
    defineProperty(wrapper, name, {
      get() {
        const value = unsafeWindow[name];
        return value === unsafeWindow ? wrapper : value;
      },
      set(val) {
        unsafeWindow[name] = val;
      },
    });
  }

  // Wrap properties
  // A major GC may hit here no matter how we define props
  // all at once, in batches of 10, 100, 500, or one by one.
  // TODO: try Proxy API if userscripts wouldn't notice the difference
  info.propsToWrap::forEach((name) => {
    if (name::startsWith('on')) {
      defineReactedProperty(name);
    } else {
      defineProtectedProperty(name);
    }
  });
  return wrapper;
}
