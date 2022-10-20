import bridge from './bridge';
import { makeGmApi } from './gm-api';
import { makeGlobalWrapper } from './gm-global-wrapper';
import { makeComponentUtils } from './util';

/** Name in Greasemonkey4 -> name in GM */
const GM4_ALIAS = {
  __proto__: null,
  getResourceUrl: 'getResourceURL',
  xmlHttpRequest: 'xmlhttpRequest',
};
const GM4_ASYNC = {
  __proto__: null,
  getResourceUrl: 1,
  getValue: 1,
  deleteValue: 1,
  setValue: 1,
  listValues: 1,
};
let gmApi;
let componentUtils;

/**
 * @param {VMInjection.Script} script
 * @returns {Object}
 */
export function makeGmApiWrapper(script) {
  // Add GM functions
  // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
  const { meta } = script;
  const grant = meta.grant;
  let wrapper;
  let numGrants = grant.length;
  if (numGrants === 1 && grant[0] === 'none') {
    numGrants = 0;
    grant.length = 0;
  }
  const { id } = script.props;
  const resources = createNullObj(meta.resources);
  const context = {
    id,
    script,
    resources,
    dataKey: script.dataKey,
    resCache: createNullObj(),
  };
  const gmInfo = makeGmInfo(script.gmInfo, meta, resources);
  const gm = {
    __proto__: null,
    GM: {
      __proto__: null,
      info: gmInfo,
    },
    GM_info: gmInfo,
    unsafeWindow: global,
  };
  if (!componentUtils) {
    componentUtils = makeComponentUtils();
  }
  assign(gm, componentUtils);
  if (grant::indexOf(WINDOW_CLOSE) >= 0) {
    gm.close = vmOwnFunc(() => bridge.post('TabClose', 0, context));
  }
  if (grant::indexOf(WINDOW_FOCUS) >= 0) {
    gm.focus = vmOwnFunc(() => bridge.post('TabFocus', 0, context));
  }
  if (!gmApi && numGrants) gmApi = makeGmApi();
  grant::forEach((name) => {
    const gm4name = name::slice(0, 3) === 'GM.' && name::slice(3);
    const fn = gmApi[gm4name ? `GM_${GM4_ALIAS[gm4name] || gm4name}` : name];
    if (fn) {
      if (gm4name) {
        gm.GM[gm4name] = makeGmMethodCaller(fn, context, GM4_ASYNC[gm4name]);
      } else {
        gm[name] = makeGmMethodCaller(fn, context);
      }
    }
  });
  if (numGrants) {
    wrapper = makeGlobalWrapper(gm);
    /* Exposing the fast cache of resolved properties,
     * using a name that'll never be added to the web platform */
    gm.c = gm;
  }
  return { gm, wrapper };
}

function makeGmInfo(gmInfo, meta, resources) {
  const resourcesArr = objectKeys(resources);
  resourcesArr::forEach((name, i) => {
    resourcesArr[i] = { name, url: resources[name] };
  });
  // No __proto__:null because these are standard objects for userscripts
  setOwnProp(meta, 'resources', resourcesArr);
  setOwnProp(gmInfo, 'injectInto', bridge.mode);
  setOwnProp(gmInfo, 'script', meta);
  return gmInfo;
}

function makeGmMethodCaller(gmMethod, context, isAsync) {
  // keeping the native console.log intact
  if (gmMethod === gmApi.GM_log) return gmMethod;
  if (isAsync) context = assign({ __proto__: null, async: true }, context);
  return vmOwnFunc(safeBind(gmMethod, context));
}
