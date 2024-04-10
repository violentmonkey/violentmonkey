import bridge from './bridge';
import { GM_API, gmGetResourceURL, gmXmlHttpRequest } from './gm-api';
import { makeGlobalWrapper } from './gm-global-wrapper';
import { makeComponentUtils, safeAssign } from './util';

/** Name in Greasemonkey4 -> name in GM, all methods are context-bound */
const GM4_ALIAS = {
  __proto__: null,
  getResourceUrl: gmGetResourceURL,
  xmlHttpRequest: gmXmlHttpRequest,
};
/** Also includes GM4_ALIAS */
const GM4_ASYNC = {
  __proto__: null,
  download: 1,
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
  for (let name of grant) {
    let fn, fnGm4, gmName, gm4name;
    if (name::slice(0, 3) === 'GM.' && (gm4name = name::slice(3)) && (fnGm4 = GM4_ALIAS[gm4name])
    || (fn = GM_API.bound[gmName = gm4name ? `GM_${gm4name}` : name])) {
      fn = safeBind(fnGm4 || fn,
        fnGm4 || gm4name in GM4_ASYNC
          ? contextAsync || (contextAsync = assign(createNullObj(), { async: true }, context))
          : context);
    } else if (!(fn = GM_API.free[gmName]) && (
      fn = name === 'window.close' && sendTabClose
        || name === 'window.focus' && sendTabFocus
    )) {
      name = name::slice(7); // 'window.'.length
    }
    if (fn) {
      if (gm4name) gm4[gm4name] = fn;
      else gm[name] = fn;
    }
  }
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

