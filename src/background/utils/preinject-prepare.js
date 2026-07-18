import { getScriptName, getScriptPrettyUrl, getUniqId, leaseBlobUrl } from '@/common';
import {
  __CODE, CACHE_KEYS, HOMEPAGE_URL, KNOWN_INJECT_INTO, kOrigTag, kTag, META_STR, METABLOCK_RE,
  NEWLINE_END_RE, PROMISE, TL_AWAIT, UNWRAP,
} from '@/common/consts';
import { forEachValue, mapEntry, objectPick } from '@/common/object';
import { getScriptsByURL, kTryVacuuming } from './db';
import { registerDnrBlob } from './dnr';
import { inIncognitoContext } from './init';
import {
  cache, contentScriptsAPI, CSAPI_REG, expose, ffInject, injectContentRealm, injectInto, isApplied,
  makeXhrHeader, propsToClear, registerScriptData, xhrInject,
} from './preinject-core';
import { S_CACHE, S_CODE, S_REQUIRE, S_SCRIPT_PRE, S_VALUE } from './storage';
import { ua } from './ua';

const sessionId = getUniqId();
const SKIP_COMMENTS_RE = /^\s*(?:\/\*[\s\S]*?\*\/|\/\/.*[\r\n]+|\s+)*/u;
const isIncognito = __.MV3 && inIncognitoContext;
/** Not using a combined regex to check for the chars to avoid catastrophic backtracking */
const isUnsafeConcat = s => (s = s.charCodeAt(s.match(SKIP_COMMENTS_RE)[0].length)) === 45/*"-"*/
  || s === 43/*"+"*/
  || s === 91/*"["*/
  || s === 40/*"("*/;
/** These bags are reused in cache to reduce memory usage,
 * CACHE_KEYS is for removeStaleCacheEntry */
const BAG_NOOP = { [INJECT]: {}, [CACHE_KEYS]: [] };
const BAG_NOOP_EXPOSE = { ...BAG_NOOP, [INJECT]: { [EXPOSE]: true, [kSessionId]: sessionId } };
// KEY_XXX for hooked options
const GRANT_NONE_VARS = '{GM,GM_info}';
const META_KEYS_TO_ENSURE = [
  'description',
  'name',
  'namespace',
  [RUN_AT],
  'version',
];
const META_KEYS_TO_ENSURE_FROM = [
  [HOMEPAGE_URL, 'homepage'],
];
const META_KEYS_TO_PLURALIZE_RE = /^(?:(m|excludeM)atch|(ex|in)clude|tag)$/;
const pluralizeMetaKey = (s, consonant) => s + (consonant ? 'es' : 's');
const pluralizeMeta = key => key.replace(META_KEYS_TO_PLURALIZE_RE, pluralizeMetaKey);
export const normalizeRealm = val => (
  KNOWN_INJECT_INTO[val] ? val : injectInto || AUTO
);
export const normalizeScriptRealm = (custom, meta) => (
  normalizeRealm(custom[INJECT_INTO] || meta[INJECT_INTO])
);
const isContentRealm = (val, force) => (
  val === CONTENT || val === AUTO && force
);

/**
 * @param {chrome.webRequest.WebRequestDetails} info
 * @param {VMInjection.Bag} bag
 */
export function prepareXhrBlob({ [kResponseHeaders]: responseHeaders, frameId, tabId, url }, bag) {
  triageRealms(bag[INJECT][SCRIPTS], bag[FORCE_CONTENT], tabId, frameId, bag);
  const blob = new Blob([JSON.stringify(bag[INJECT])]);
  if (__.MV3) {
    registerDnrBlob(blob, url, tabId, frameId);
  } else {
    responseHeaders.push(makeXhrHeader('name', leaseBlobUrl(blob)));
    return { [kResponseHeaders]: responseHeaders };
  }
}

export function prepare(cacheKey, url, isTop) {
  const shouldExpose = isTop && url.startsWith('https://')
    ? expose[url.split('/', 3)[2]]
    : null;
  const bagNoOp = shouldExpose != null ? BAG_NOOP_EXPOSE : BAG_NOOP;
  BAG_NOOP_EXPOSE[INJECT][EXPOSE] = shouldExpose;
  if (!isApplied) {
    return bagNoOp;
  }
  const errors = [];
  // TODO: teach `getScriptEnv` to skip prepared scripts in cache
  const env = getScriptsByURL(url, isTop, errors);
  const res = env || bagNoOp;
  cache.put(cacheKey, res); // must be called before prepareBag overwrites it synchronously
  if (env) {
    env[PROMISE] = prepareBag(cacheKey, url, isTop,
      env, shouldExpose != null ? { [EXPOSE]: shouldExpose } : {}, errors
    ).catch(() => (env[PROMISE] = null));
  }
  return res;
}

async function prepareBag(cacheKey, url, isTop, env, inject, errors) {
  if (env[PROMISE]) await env[PROMISE];
  if (!isApplied) return; // the user disabled injection while we awaited
  cache.batch(true);
  const bag = { [INJECT]: inject };
  const { allIds, [MORE]: envDelayed } = env;
  const moreKey = envDelayed[IDS].length && getUniqId('more');
  Object.assign(inject, {
    [SCRIPTS]: prepareScripts(env),
    [INJECT_INTO]: injectInto,
    [MORE]: moreKey,
    [kSessionId]: sessionId,
    [IDS]: allIds,
    info: { ua, gmi: { isIncognito } },
    errors: errors.filter(err => allIds[err.split('#').pop()]).join('\n'),
  }, objectPick(env, [
    S_CACHE,
    'clipFF',
    'xhr',
  ]));
  propsToClear::forEachValue(val => {
    if (val !== true) bag[val] = env[val];
  });
  bag[MORE] = envDelayed;
  if (isTop && (__.MV3 ? chrome.userScripts : ffInject && !xhrInject && contentScriptsAPI)) {
    inject[PAGE] = env[PAGE] || triagePageRealm(envDelayed);
    try { bag[CSAPI_REG] = registerScriptData(inject, url); } catch {/*ignoring*/}
    bag.url = url;
  }
  if (moreKey) {
    cache.put(moreKey, envDelayed);
    envDelayed[MORE] = cacheKey;
  }
  cache.put(cacheKey, bag);
  cache.batch(false);
  return bag;
}

export function prepareScripts(env) {
  env[PROMISE] = null; // let GC have it
  const scripts = env[SCRIPTS];
  for (let i = 0, script, key, id; i < scripts.length; i++) {
    script = scripts[i];
    id = script.id;
    if (!script[__CODE]) {
      id = script.props.id;
      key = S_SCRIPT_PRE + id;
      script = cache.get(key) || cache.put(key, prepareScript(script, env));
      scripts[i] = script;
    }
    if (script[INJECT_INTO] !== CONTENT) {
      env[PAGE] = true; // for registerScriptData
    }
    script[VALUES] = env[S_VALUE][id] || null;
  }
  return scripts;
}

/**
 * @param {VMScript} script
 * @param {VMInjection.EnvStart} env
 * @return {VMInjection.Script}
 */
function prepareScript(script, env) {
  const { custom, meta, props } = script;
  const { id } = props;
  const { [S_REQUIRE]: require, [RUN_AT]: runAt } = env;
  const code = env[S_CODE][id];
  const dataKey = getUniqId();
  const winKey = getUniqId();
  const plantKey = { data: dataKey, win: winKey };
  const displayName = getScriptName(script);
  const pathMap = custom.pathMap || {};
  const wrap = !meta[UNWRAP];
  const wrapTryCatch = wrap && IS_FIREFOX; // FF doesn't show errors in content script's console
  const { grant, [TL_AWAIT]: topLevelAwait } = meta;
  const startIIFE = topLevelAwait ? 'await(async' : '(';
  const grantNone = grant.includes('none');
  const shouldUpdate = !!script.config.shouldUpdate;
  // Storing slices separately to reuse JS-internalized strings for code in our storage cache
  const injectedCode = [];
  const metaCopy = meta::mapEntry(null, pluralizeMeta);
  const metaStrMatch = METABLOCK_RE.exec(code);
  let codeIndex;
  let tmp;
  for (const key of META_KEYS_TO_ENSURE) {
    if (metaCopy[key] == null) metaCopy[key] = '';
  }
  for (const [key, from] of META_KEYS_TO_ENSURE_FROM) {
    if (!metaCopy[key] && (tmp = metaCopy[from])) {
      metaCopy[key] = tmp;
    }
  }
  metaCopy.options = { // TM-compatibility
    check_for_updates: shouldUpdate,
    inject_into: custom[INJECT_INTO] || null,
    noframes: custom.noframes ?? null,
    override: {
      merge_excludes: custom.origExclude,
      merge_includes: custom.origInclude,
      merge_matches: custom.origMatch,
      merge_exclude_matches: custom.origExcludeMatch,
      merge_tags: custom[kOrigTag],
      use_excludes: custom.exclude || [],
      use_includes: custom.include || [],
      use_matches: custom.match || [],
      use_exclude_matches: custom.excludeMatch || [],
    },
    run_at: custom[RUN_AT] || null,
    tags: custom[kTag] || [],
    user_modified: script.props.lastModified || 0,
  };
  if (wrap) {
    // TODO: push winKey/dataKey as separate chunks so we can change them for each injection?
    injectedCode.push('window.', winKey, '=',
      wrapTryCatch && topLevelAwait ? 'async ' : '',
      'function ', dataKey, '(',
      // using a shadowed name to avoid scope pollution
      grantNone ? GRANT_NONE_VARS : 'GM',
      wrapTryCatch ? `,${dataKey}){try{` : '){',
      grantNone ? '' : 'with(this)with(c)delete c,',
      !topLevelAwait ? '(' : wrapTryCatch ? startIIFE : '(async',
      // hiding module interface from @require'd scripts so they don't mistakenly use it
      '(define,module,exports)=>{');
  }
  tmp = false;
  for (const url of meta[S_REQUIRE]) {
    const req = require[pathMap[url] || url] || `/* ${VIOLENTMONKEY} is missing @require ${
      url.replace(/\*\//g, '%2A/')
    }\n${kTryVacuuming} */`;
    if (/\S/.test(req)) {
      injectedCode.push(...[
        tmp && isUnsafeConcat(req) && ';',
        req,
        !NEWLINE_END_RE.test(req) && '\n',
      ].filter(Boolean));
      tmp = true;
    }
  }
  if (tmp && isUnsafeConcat(code)) {
    injectedCode.push(';');
  }
  codeIndex = injectedCode.length;
  injectedCode.push(code);
  // adding a new line in case the code ends with a line comment
  injectedCode.push(...[
    !NEWLINE_END_RE.test(code) && '\n',
    wrapTryCatch ? `})()}catch(e){${dataKey}(e)}}` : wrap && `})()}`,
    // 0 at the end to suppress errors about non-cloneable result of executeScript in FF
    IS_FIREFOX && ';0',
    '\n//# sourceURL=', getScriptPrettyUrl(script, displayName),
  ].filter(Boolean));
  return {
    code: '',
    displayName,
    gmi: {
      scriptWillUpdate: shouldUpdate,
      uuid: props.uuid,
    },
    id,
    key: plantKey,
    meta: metaCopy,
    pathMap,
    [__CODE]: injectedCode,
    [INJECT_INTO]: normalizeScriptRealm(custom, meta),
    [META_STR]: [
      '',
      codeIndex,
      tmp = metaStrMatch && (metaStrMatch.index + metaStrMatch[1].length),
      tmp + metaStrMatch?.[4].length,
    ],
    [RUN_AT]: runAt[id],
  };
}

export function triageRealms(scripts, forceContent, tabId, frameId, bag) {
  let code;
  let wantsPage;
  const toContent = [];
  for (const /**@type{VMInjection.Script}*/ scr of scripts) {
    const metaStr = scr[META_STR];
    if (isContentRealm(scr[INJECT_INTO], forceContent)) {
      if (!metaStr[0]) {
        const [, i, from, to] = metaStr;
        metaStr[0] = scr[__CODE][i].slice(from, to);
      }
      code = '';
      toContent.push([scr.id, scr.key.data]);
    } else {
      metaStr[0] = '';
      code = forceContent ? ID_BAD_REALM : scr[__CODE];
      if (!forceContent) wantsPage = true;
    }
    scr.code = code;
  }
  if (bag) {
    bag[INJECT][PAGE] = wantsPage || triagePageRealm(bag[MORE]);
  }
  if (toContent[0]) {
    // Processing known feedback without waiting for InjectionFeedback message.
    // Running in a separate task as executeScript may take a long time to serialize code.
    setTimeout(injectContentRealm, 0, toContent, tabId, frameId);
  }
}

export function triagePageRealm(env, forceContent) {
  return env?.[SCRIPTS].some(isPageRealmScript, forceContent || null);
}

/** @this {?} truthy = forceContent */
function isPageRealmScript(scr) {
  return !isContentRealm(scr[INJECT_INTO] || normalizeScriptRealm(scr.custom, scr.meta), this);
}
