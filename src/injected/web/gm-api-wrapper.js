import bridge from './bridge';
import { GM_API } from './gm-api';
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
const componentUtils = makeComponentUtils();
const sendTabClose = () => bridge.post('TabClose');
const sendTabFocus = () => bridge.post('TabFocus');

/**
 * @param {VMInjection.Script} script
 * @returns {Object}
 */
export function makeGmApiWrapper(script) {
  // Add GM functions
  // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
  const { id, meta } = script;
  const { grant } = meta;
  const resources = setPrototypeOf(meta.resources, null);
  /** @type {GMContext} */
  const context = {
    __proto__: null, // necessary for optional props like `async`
    id,
    script,
    resources,
    resCache: createNullObj(),
  };
  const gmInfo = makeGmInfo(script.gmi, meta, resources);
  const gm4 = {
    __proto__: null,
    info: gmInfo,
  };
  const gm = {
    __proto__: null,
    GM: gm4,
    GM_info: gmInfo,
    unsafeWindow: global,
  };
  let contextAsync;
  let wrapper;
  let numGrants = grant.length;
  if (numGrants === 1 && grant[0] === 'none') {
    numGrants = 0;
  }
  assign(gm, componentUtils);
  grant::forEach((name) => {
    const namePrefix = name::slice(0, 3);
    const gm4name = namePrefix === 'GM.' && name::slice(3);
    const gmName = gm4name ? `GM_${GM4_ALIAS[name = gm4name] || gm4name}` : name;
    const fnBound = GM_API.bound[gmName];
    let fn = fnBound || GM_API.free[gmName];
    if (fnBound) {
      fn = safeBind(fn,
        GM4_ASYNC[gm4name]
          ? contextAsync || (contextAsync = assign(createNullObj(), { async: true }, context))
          : context);
    } else if (!fn && (
      fn = name === 'window.close' && sendTabClose
        || name === 'window.focus' && sendTabFocus
    )) {
      name = name::slice(7); // 'window.'.length
    }
    if (fn) {
      (gm4name ? gm4 : gm)[name] = fn;
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
  meta.resources = resourcesArr;
  safeAssign(gmInfo, bridge.gmi);
  return safeAssign(gmInfo, {
    [INJECT_INTO]: bridge.mode,
    platform: safeAssign({}, bridge.ua),
    script: meta,
    scriptHandler: VIOLENTMONKEY,
    version: process.env.VM_VER,
  });
}

function safeAssign(dst, src) {
  for (const key of objectKeys(src)) {
    setOwnProp(dst, key, src[key]);
  }
  return dst;
}
