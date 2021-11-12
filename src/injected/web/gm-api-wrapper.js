import bridge from './bridge';
import { makeGmApi } from './gm-api';
import { makeGlobalWrapper } from './gm-global-wrapper';
import { makeComponentUtils, safeConcat } from './util-web';

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
 * @param {VMScript & VMInjectedScript} script
 * @returns {Object}
 */
export function makeGmApiWrapper(script) {
  // Add GM functions
  // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
  const { meta } = script;
  const grant = meta.grant;
  if (grant.length === 1 && grant[0] === 'none') {
    grant.length = 0;
  }
  const { id } = script.props;
  const resources = assign(createNullObj(), meta.resources);
  /** @namespace VMInjectedScript.Context */
  const context = {
    id,
    script,
    resources,
    dataKey: script.dataKey,
    resCache: createNullObj(),
  };
  const gmInfo = makeGmInfo(script, resources);
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
  if (!gmApi && grant.length) gmApi = makeGmApi();
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
  return grant.length ? makeGlobalWrapper(gm) : gm;
}

function makeGmInfo(script, resources) {
  // TODO: move into background.js
  const { meta } = script;
  const metaCopy = createNullObj();
  let val;
  objectKeys(meta)::forEach((key) => {
    val = meta[key];
    switch (key) {
    case 'match': // -> matches
    case 'excludeMatch': // -> excludeMatches
      key += 'e';
      // fallthrough
    case 'exclude': // -> excludes
    case 'include': // -> includes
      key += 's';
      val = safeConcat([], val);
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
  val = objectKeys(resources);
  val::forEach((name, i) => {
    val[i] = { name, url: resources[name] };
  });
  metaCopy.resources = val;
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
      ? (async (...args) => gmMethod::apply(context, args))
      : gmMethod::bind(context),
  );
}
