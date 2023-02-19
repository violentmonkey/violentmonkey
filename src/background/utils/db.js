import {
  compareVersion, dataUri2text, i18n, getScriptHome, isDataUri, makeDataUri,
  getFullUrl, getScriptName, getScriptUpdateUrl, isRemote, sendCmd, trueJoin,
  getScriptPrettyUrl, getScriptRunAt, makePause, isHttpOrHttps, noop,
} from '@/common';
import { INFERRED, TIMEOUT_WEEK } from '@/common/consts';
import { deepSize, forEachEntry, forEachKey, forEachValue } from '@/common/object';
import pluginEvents from '../plugin/events';
import { getDefaultCustom, getNameURI, inferScriptProps, newScript, parseMeta } from './script';
import { testScript, testBlacklist, testerBatch } from './tester';
import { preInitialize } from './init';
import { addOwnCommands, addPublicCommands, commands } from './message';
import patchDB from './patch-db';
import { setOption } from './options';
import storage, {
  S_CACHE, S_CODE, S_REQUIRE, S_SCRIPT, S_VALUE,
  S_CACHE_PRE, S_CODE_PRE, S_MOD_PRE, S_REQUIRE_PRE, S_SCRIPT_PRE, S_VALUE_PRE,
} from './storage';

let maxScriptId = 0;
let maxScriptPosition = 0;
/** @type {{ [url:string]: number }} */
export let scriptSizes = {};
/** @type {Object<string,VMScript[]>} */
export const scriptMap = {};
/** @type {VMScript[]} */
const aliveScripts = [];
/** @type {VMScript[]} */
const removedScripts = [];
/** Same order as in SIZE_TITLES and getSizes */
export const sizesPrefixRe = RegExp(
  `^(${S_CODE_PRE}|${S_SCRIPT_PRE}|${S_VALUE_PRE}|${S_REQUIRE_PRE}|${S_CACHE_PRE}${S_MOD_PRE})`);

addPublicCommands({
  GetScriptVer(opts) {
    const script = getScript(opts);
    return script
      ? script.meta.version
      : null;
  },
});

addOwnCommands({
  CheckPosition: sortScripts,
  CheckRemove: checkRemove,
  RemoveScripts: removeScripts,
  /** @return {VMScript} */
  GetScript: getScript,
  /** @return {Promise<{ items: VMScript[], values? }>} */
  async ExportZip({ values }) {
    const scripts = getScripts();
    const ids = scripts.map(getPropsId);
    const codeMap = await storage[S_CODE].getMulti(ids);
    return {
      items: scripts.map(script => ({ script, code: codeMap[script.props.id] })),
      values: values ? await storage[S_VALUE].getMulti(ids) : undefined,
    };
  },
  /** @return {Promise<string>} */
  GetScriptCode(id) {
    return storage[S_CODE][Array.isArray(id) ? 'getMulti' : 'getOne'](id);
  },
  /** @return {Promise<void>} */
  async MarkRemoved({ id, removed }) {
    if (!removed) {
      const script = getScriptById(id);
      const conflict = getScript({ meta: script.meta });
      if (conflict) throw i18n('msgNamespaceConflictRestore');
    }
    await updateScriptInfo(id, {
      config: { removed: removed ? 1 : 0 },
      props: { lastModified: Date.now() },
    });
    const list = removed ? aliveScripts : removedScripts;
    const i = list.findIndex(script => script.props.id === id);
    const [script] = list.splice(i, 1);
    (removed ? removedScripts : aliveScripts).push(script);
  },
  /** @return {Promise<number>} */
  Move({ id, offset }) {
    const script = getScriptById(id);
    const index = aliveScripts.indexOf(script);
    aliveScripts.splice(index, 1);
    aliveScripts.splice(index + offset, 0, script);
    return normalizePosition();
  },
  ParseMeta: parseMetaWithErrors,
  ParseScript: parseScript,
  /** @return {Promise<void>} */
  UpdateScriptInfo({ id, config, custom }) {
    return updateScriptInfo(id, {
      config,
      custom,
      props: { lastModified: Date.now() },
    });
  },
  /** @return {Promise<number>} */
  Vacuum: vacuum,
});

preInitialize.push(async () => {
  const lastVersion = await storage.base.getOne('version');
  const version = process.env.VM_VER;
  if (!lastVersion) await patchDB();
  if (version !== lastVersion) storage.base.set({ version });
  const data = await storage.base.getMulti();
  const uriMap = {};
  data::forEachEntry(([key, script]) => {
    const id = +storage[S_SCRIPT].toId(key);
    if (id && script) {
      const uri = getNameURI(script);
      // Only check ID/namespace conflicts for scripts not removed
      if (!script.config.removed) {
        if (scriptMap[id] && scriptMap[id] !== script) {
          // ID conflicts!
          // Should not happen, discard duplicates.
          return;
        }
        if (uriMap[uri]) {
          // Namespace conflicts!
          // Should not happen, discard duplicates.
          return;
        }
        uriMap[uri] = script;
      }
      script.props = {
        ...script.props,
        id,
        uri,
      };
      script.custom = {
        ...getDefaultCustom(),
        ...script.custom,
      };
      maxScriptId = Math.max(maxScriptId, id);
      maxScriptPosition = Math.max(maxScriptPosition, getInt(script.props.position));
      (script.config.removed ? removedScripts : aliveScripts).push(script);
      // listing all known resource urls in order to remove unused mod keys
      const {
        meta = script.meta = {},
      } = script;
      if (!meta.require) meta.require = [];
      if (!meta.resources) meta.resources = {};
      meta.grant = [...new Set(meta.grant || [])]; // deduplicate
    }
  });
  // Switch defaultInjectInto from `page` to `auto` when upgrading VM2.12.7 or older
  if (version !== lastVersion
  && IS_FIREFOX
  && data.options?.defaultInjectInto === PAGE
  && compareVersion(lastVersion, '2.12.7') <= 0) {
    setOption('defaultInjectInto', AUTO);
  }
  if (process.env.DEBUG) {
    console.info('store:', {
      aliveScripts, removedScripts, maxScriptId, maxScriptPosition, scriptMap, scriptSizes,
    });
  }
  sortScripts();
  vacuum(data);
});

/** @return {number} */
function getInt(val) {
  return +val || 0;
}

/** @return {?number} */
function getPropsId(script) {
  return script?.props.id;
}

/** @return {void} */
function updateLastModified() {
  setOption('lastModified', Date.now());
}

/** @return {Promise<boolean>} */
export async function normalizePosition() {
  const updates = aliveScripts.reduce((res, script, index) => {
    const { props } = script;
    const position = index + 1;
    if (props.position !== position) {
      props.position = position;
      (res || (res = {}))[props.id] = script;
    }
    return res;
  }, null);
  maxScriptPosition = aliveScripts.length;
  if (updates) {
    await storage[S_SCRIPT].set(updates);
    updateLastModified();
  }
  return !!updates;
}

/** @return {Promise<number>} */
export async function sortScripts() {
  aliveScripts.sort((a, b) => getInt(a.props.position) - getInt(b.props.position));
  const changed = await normalizePosition();
  sendCmd('ScriptsUpdated', null);
  return changed;
}

/** @return {?VMScript} */
export function getScriptById(id) {
  return scriptMap[id];
}

export function getScriptsByIdsOrAll(ids) {
  return ids?.map(getScriptById) ?? [...aliveScripts, ...removedScripts];
}

/** @return {?VMScript} */
export function getScript({ id, uri, meta, removed }) {
  let script;
  if (id) {
    script = getScriptById(id);
  } else {
    if (!uri) uri = getNameURI({ meta, id: '@@should-have-name' });
    script = (removed ? removedScripts : aliveScripts).find(({ props }) => uri === props.uri);
  }
  return script;
}

/** @return {VMScript[]} */
export function getScripts() {
  return [...aliveScripts];
}

export const CACHE_KEYS = 'cacheKeys';
export const REQ_KEYS = 'reqKeys';
export const VALUE_IDS = 'valueIds';
export const PROMISE = 'promise';
const makeEnv = () => ({
  depsMap: {},
  [RUN_AT]: {},
  [SCRIPTS]: [],
});
const GMCLIP_RE = /^GM[_.]setClipboard$/;
const GMVALUES_RE = /^GM[_.](listValues|([gs]et|delete)Value)$/;
const STORAGE_ROUTES = {
  [S_CACHE]: CACHE_KEYS,
  [S_CODE]: IDS,
  [S_REQUIRE]: REQ_KEYS,
  [S_VALUE]: VALUE_IDS,
};
const STORAGE_ROUTES_ENTRIES = Object.entries(STORAGE_ROUTES);
const notifiedBadScripts = new Set();

/**
 * @desc Get scripts to be injected to page with specific URL.
 * @param {string} url
 * @param {boolean} isTop
 * @param {Array} [errors] - omit to enable EnvDelayed mode
 * @return {VMInjection.EnvStart|Promise<VMInjection.EnvDelayed>}
 */
export function getScriptsByURL(url, isTop, errors) {
  testerBatch(errors || true);
  const allScripts = testBlacklist(url)
    ? []
    : aliveScripts.filter(script => (
      (isTop || !(script.custom.noframes ?? script.meta.noframes))
      && testScript(url, script)
    ));
  testerBatch();
  if (!allScripts[0]) return;
  let clipboardChecked = !IS_FIREFOX;
  const allIds = {};
  /** @type {VMInjection.EnvStart} */
  const envStart = makeEnv();
  /** @type {VMInjection.EnvDelayed} */
  const envDelayed = makeEnv();
  for (const [areaName, listName] of STORAGE_ROUTES_ENTRIES) {
    envStart[areaName] = {}; envDelayed[areaName] = {};
    envStart[listName] = []; envDelayed[listName] = [];
  }
  allScripts.forEach((script) => {
    const { id } = script.props;
    if (!(allIds[id] = +!!script.config.enabled)) {
      return;
    }
    const { meta, custom } = script;
    const { pathMap = buildPathMap(script) } = custom;
    const runAt = getScriptRunAt(script);
    const env = runAt === 'start' || runAt === 'body' ? envStart : envDelayed;
    const { depsMap } = env;
    env[IDS].push(id);
    env[RUN_AT][id] = runAt;
    if (meta.grant.some(GMVALUES_RE.test, GMVALUES_RE)) {
      env[VALUE_IDS].push(id);
    }
    if (!clipboardChecked && meta.grant.some(GMCLIP_RE.test, GMCLIP_RE)) {
      clipboardChecked = envStart.clipFF = true;
    }
    for (const [list, name, dataUriDecoder] of [
      [meta.require, S_REQUIRE, dataUri2text],
      [Object.values(meta.resources), S_CACHE],
    ]) {
      const listName = STORAGE_ROUTES[name];
      const envCheck = name === S_CACHE ? envStart : env; // envStart cache is reused in injected
      for (let url of list) {
        url = pathMap[url] || url;
        if (url) {
          if (isDataUri(url)) {
            if (dataUriDecoder) {
              env[name][url] = dataUriDecoder(url);
            }
          } else if (!envCheck[listName].includes(url)) {
            env[listName].push(url);
            (depsMap[url] || (depsMap[url] = [])).push(id);
          }
        }
      }
    }
    env[SCRIPTS].push(script);
  });
  if (!errors) {
    envDelayed[PROMISE] = readEnvironmentData(envDelayed);
    return envDelayed;
  }
  if (envStart[IDS].length) {
    envStart[PROMISE] = readEnvironmentData(envStart);
  }
  if (envDelayed[IDS].length) {
    envDelayed[PROMISE] = makePause().then(readEnvironmentData.bind(null, envDelayed));
  }
  return Object.assign(envStart, { allIds, [MORE]: envDelayed });
}

async function readEnvironmentData(env) {
  const keys = [];
  for (const [area, listName] of STORAGE_ROUTES_ENTRIES) {
    for (const id of env[listName]) {
      keys.push(storage[area].toKey(id));
    }
  }
  const data = await storage.base.getMulti(keys);
  const badScripts = new Set();
  for (const [area, listName] of STORAGE_ROUTES_ENTRIES) {
    for (const id of env[listName]) {
      let val = data[storage[area].toKey(id)];
      if (!val && area === S_VALUE) val = {};
      env[area][id] = val;
      if (val == null) {
        if (area === S_CODE) {
          badScripts.add(id);
        } else {
          env.depsMap[id]?.forEach(scriptId => badScripts.add(scriptId));
        }
      }
    }
  }
  if (badScripts.size) {
    reportBadScripts(badScripts);
  }
  env[PROMISE] = null; // indicating it's been processed
  return env;
}

/** @param {Set<number>} ids */
function reportBadScripts(ids) {
  const unnotifiedIds = [];
  const title = i18n('msgMissingResources');
  let toLog = i18n('msgReinstallScripts');
  let toNotify = toLog;
  let str;
  ids.forEach(id => {
    str = `\n#${id}: ${getScriptName(getScriptById(id))}`;
    toLog += str;
    if (!notifiedBadScripts.has(id)) {
      notifiedBadScripts.add(id);
      unnotifiedIds.push(id);
      toNotify += str;
    }
  });
  console.error(`${title} ${toLog}`);
  if (unnotifiedIds.length) {
    notifyToOpenScripts(title, toNotify, unnotifiedIds);
  }
}

export function notifyToOpenScripts(title, text, ids) {
  // FF doesn't show notifications of type:'list' so we'll use `text` everywhere
  commands.Notification({ title, text }, undefined, isClick => {
    if (isClick) ids.forEach(id => commands.OpenEditor(id));
  });
}

/**
 * @desc Get data for dashboard.
 * @return {Promise<{ scripts: VMScript[], cache: Object }>}
 */
export async function getData({ ids, sizes }) {
  const scripts = getScriptsByIdsOrAll(ids);
  scripts.forEach(inferScriptProps);
  return {
    scripts,
    cache: await getIconCache(scripts),
    sizes: sizes && getSizes(ids),
  };
}

/**
 * @param {VMScript[]} scripts
 * @return {Promise<{}>}
 */
async function getIconCache(scripts) {
  const urls = [];
  for (const { custom, meta: { icon } } of scripts) {
    if (isHttpOrHttps(icon)) {
      urls.push(custom.pathMap[icon] || icon);
    }
  }
  // Getting a data uri for own icon to load it instantly in Chrome when there are many images
  const ownPath = `${ICON_PREFIX}38.png`;
  const [res, ownUri] = await Promise.all([
    storage[S_CACHE].getMulti(urls, makeDataUri),
    commands.GetImageData(ownPath).catch(noop),
  ]);
  if (ownUri) res[ownPath] = ownUri;
  return res;
}

/**
 * @param {number[]} [ids]
 * @return {number[][]}
 */
export function getSizes(ids) {
  const scripts = getScriptsByIdsOrAll(ids);
  return scripts.map(({
    meta,
    custom: { pathMap = {} },
    props: { id },
  }, i) => [
    // Same order as SIZE_TITLES and sizesPrefixRe
    scriptSizes[S_CODE_PRE + id] || 0,
    deepSize(scripts[i]),
    scriptSizes[S_VALUE_PRE + id] || 0,
    meta.require.reduce(getSizeForRequires, { len: 0, pathMap }).len,
    Object.values(meta.resources).reduce(getSizeForResources, { len: 0, pathMap }).len,
  ]);
}

function getSizeForRequires(accum, url) {
  accum.len += (scriptSizes[S_REQUIRE_PRE + (accum.pathMap[url] || url)] || 0) + url.length;
  return accum;
}

function getSizeForResources(accum, url) {
  accum.len += (scriptSizes[S_CACHE_PRE + (accum.pathMap[url] || url)] || 0) + url.length;
  return accum;
}

export async function removeScripts(ids) {
  const idsToRemove = [];
  // Only those marked as removed can be removed permanently
  const newLen = 1 + removedScripts.reduce((iAlive, script, i) => {
    const id = getPropsId(script);
    if (ids.includes(id)) {
      idsToRemove.push(S_CODE_PRE + id, S_SCRIPT_PRE + id, S_VALUE_PRE + id);
      delete scriptMap[id];
    } else if (++iAlive < i) removedScripts[iAlive] = script;
    return iAlive;
  }, -1);
  if (removedScripts.length !== newLen) {
    removedScripts.length = newLen; // live scripts were moved to the beginning
    await storage.base.remove(idsToRemove);
    return sendCmd('RemoveScripts', ids);
  }
}

export function checkRemove({ force } = {}) {
  const now = Date.now();
  const ids = removedScripts.filter(script => {
    const { lastModified } = script.props;
    return script.config.removed && (force || now - getInt(lastModified) > TIMEOUT_WEEK);
  }).map(script => script.props.id);
  return removeScripts(ids);
}

/** @return {string} */
function getUUID() {
  const rnd = new Uint16Array(8);
  window.crypto.getRandomValues(rnd);
  // xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx
  // We're using UUIDv4 variant 1 so N=4 and M=8
  // See format_uuid_v3or5 in https://tools.ietf.org/rfc/rfc4122.txt
  rnd[3] = rnd[3] & 0x0FFF | 0x4000; // eslint-disable-line no-bitwise
  rnd[4] = rnd[4] & 0x3FFF | 0x8000; // eslint-disable-line no-bitwise
  return '01-2-3-4-567'.replace(/\d/g, i => (rnd[i] + 0x1_0000).toString(16).slice(-4));
}

/**
 * @param {VMScript} script
 * @param {string} code
 * @return {Promise<VMScript[]>}
 */
async function saveScript(script, code) {
  const config = script.config || {};
  config.enabled = getInt(config.enabled);
  config.shouldUpdate = getInt(config.shouldUpdate);
  const props = script.props || {};
  let oldScript;
  if (!props.id) {
    maxScriptId += 1;
    props.id = maxScriptId;
  } else {
    oldScript = scriptMap[props.id];
  }
  props.uri = getNameURI(script);
  props.uuid = props.uuid || crypto.randomUUID?.() || getUUID();
  // Do not allow script with same name and namespace
  if (aliveScripts.some(({ props: { id, uri } = {} }) => props.id !== id && props.uri === uri)) {
    throw i18n('msgNamespaceConflict');
  }
  if (oldScript) {
    script.config = { ...oldScript.config, ...config };
    script.props = { ...oldScript.props, ...props };
    const index = aliveScripts.indexOf(oldScript);
    aliveScripts[index] = script;
  } else {
    if (!props.position) {
      maxScriptPosition += 1;
      props.position = maxScriptPosition;
    } else if (maxScriptPosition < props.position) {
      maxScriptPosition = props.position;
    }
    script.config = config;
    script.props = props;
    aliveScripts.push(script);
  }
  return storage.base.set({
    [storage[S_SCRIPT].toKey(props.id)]: script,
    [storage[S_CODE].toKey(props.id)]: code,
  });
}

/** @return {Promise<void>} */
export async function updateScriptInfo(id, data) {
  const script = scriptMap[id];
  if (!script) throw null;
  script.props = { ...script.props, ...data.props };
  script.config = { ...script.config, ...data.config };
  script.custom = { ...script.custom, ...data.custom };
  await storage[S_SCRIPT].setOne(id, script);
  return sendCmd('UpdateScript', { where: { id }, update: script });
}

/**
 * @param {string | {code:string, custom:VMScript.Custom}} src
 * @return {{ meta: VMScript.Meta, errors: string[] }}
 */
function parseMetaWithErrors(src) {
  const isObj = isObject(src);
  const custom = isObj && src.custom || getDefaultCustom();
  const meta = parseMeta(isObj ? src.code : src);
  const errors = [];
  testerBatch(errors);
  testScript('', { meta, custom });
  testerBatch();
  return {
    meta,
    errors: errors.length ? errors : null,
  };
}

/** @return {Promise<{ isNew?, update, where }>} */
export async function parseScript(src) {
  const { meta, errors } = parseMetaWithErrors(src);
  if (!meta.name) throw `${i18n('msgInvalidScript')}\n${i18n('labelNoName')}`;
  const result = {
    errors,
    update: {
      message: src.message == null ? i18n('msgUpdated') : src.message || '',
    },
  };
  let script;
  const oldScript = getScript({ id: src.id, meta });
  if (oldScript) {
    if (src.isNew) throw i18n('msgNamespaceConflict');
    script = { ...oldScript };
    delete script[INFERRED];
  } else {
    ({ script } = newScript());
    result.isNew = true;
    result.update.message = i18n('msgInstalled');
  }
  // Overwriting inner data by `src`, deleting keys for which `src` specifies `null`
  for (const key of ['config', 'custom', 'props']) {
    let dst = script[key];
    if (!isObject(dst)) dst = script[key] = {};
    if (key === 'props') dst.lastModified = dst.lastUpdated = Date.now();
    src[key]::forEachEntry(([srcKey, srcVal]) => {
      if (srcVal == null) delete dst[srcKey];
      else dst[srcKey] = srcVal;
    });
  }
  script.config.removed = 0; // force-resetting `removed` since this is an installation
  script.meta = meta;
  if (!getScriptHome(script) && isRemote(src.from)) {
    script.custom.homepageURL = src.from;
  }
  if (isRemote(src.url)) script.custom.lastInstallURL = src.url;
  if (src.position) script.props.position = +src.position;
  if (!src.update) storage.mod.remove(getScriptUpdateUrl(script, true) || []);
  buildPathMap(script, src.url);
  await saveScript(script, src.code);
  fetchResources(script, src);
  Object.assign(result.update, script, src.update);
  result.where = { id: script.props.id };
  sendCmd('UpdateScript', result);
  pluginEvents.emit('scriptChanged', result);
  return result;
}

/** @return {Object} */
function buildPathMap(script, base) {
  const { meta } = script;
  const baseUrl = base || script.custom.lastInstallURL;
  const pathMap = baseUrl ? [
    ...meta.require,
    ...Object.values(meta.resources),
    meta.icon,
  ].reduce((map, key) => {
    if (key) {
      const fullUrl = getFullUrl(key, baseUrl);
      if (fullUrl !== key) map[key] = fullUrl;
    }
    return map;
  }, {}) : {};
  script.custom.pathMap = pathMap;
  return pathMap;
}

/** @return {Promise<?string>} resolves to error text if `resourceCache` is absent */
export async function fetchResources(script, resourceCache, reqOptions) {
  const { custom: { pathMap }, meta } = script;
  const snatch = (url, type, validator) => {
    if (!url || isDataUri(url)) return;
    url = pathMap[url] || url;
    const contents = resourceCache?.[type]?.[url];
    return contents != null && !validator
      ? storage[type].setOne(url, contents) && null
      : storage[type].fetch(url, reqOptions, validator).catch(err => err);
  };
  const errors = await Promise.all([
    ...meta.require.map(url => snatch(url, S_REQUIRE)),
    ...Object.values(meta.resources).map(url => snatch(url, S_CACHE)),
    isRemote(meta.icon) && snatch(meta.icon, S_CACHE, validateImage),
  ]);
  if (!resourceCache?.ignoreDepsErrors) {
    const error = errors.map(formatHttpError)::trueJoin('\n');
    if (error) {
      const message = i18n('msgErrorFetchingResource');
      sendCmd('UpdateScript', {
        update: { error, message },
        where: { id: script.props.id },
      });
      return `${message}\n${error}`;
    }
  }
}

/** @return {Promise<void>} resolves on success, rejects on error */
function validateImage(url, buf, type) {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(new Blob([buf], { type }));
    const onDone = (e) => {
      URL.revokeObjectURL(blobUrl);
      if (e.type === 'load') resolve();
      else reject(`IMAGE_ERROR: ${url}`);
    };
    const image = new Image();
    image.onload = onDone;
    image.onerror = onDone;
    image.src = blobUrl;
  });
}

function formatHttpError(e) {
  return e && [e.status && `HTTP${e.status}`, e.url]::trueJoin(' ') || e;
}

let _vacuuming;
/**
 * @param {Object} [data]
 * @return {Promise<{errors:string[], fixes:number}>}
 */
export async function vacuum(data) {
  if (_vacuuming) return _vacuuming;
  let resolveSelf;
  _vacuuming = new Promise(r => { resolveSelf = r; });
  const noFetch = data && [];
  const sizes = {};
  const result = {};
  const toFetch = [];
  const keysToRemove = [];
  /** -1=untouched, 1=touched, 2(+scriptId)=missing */
  const status = {};
  const prefixRe = RegExp(`^(${[
    S_VALUE_PRE,
    S_CACHE_PRE,
    S_REQUIRE_PRE,
    S_CODE_PRE,
    S_MOD_PRE,
  ].join('|')})`);
  const prefixIgnoreMissing = [
    S_VALUE_PRE,
    S_MOD_PRE,
  ];
  const downloadUrls = {};
  const touch = (prefix, id, scriptId, pathMap) => {
    if (!id || pathMap && isDataUri(id)) {
      return 0;
    }
    const key = prefix + (pathMap?.[id] || id);
    const val = status[key];
    if (val < 0) {
      status[key] = 1;
      if (id !== scriptId) {
        status[S_MOD_PRE + id] = 1;
      }
      if (prefix !== S_MOD_PRE) {
        sizes[key] = deepSize(data[key]) + (prefix === S_VALUE_PRE ? 0 : key.length);
      }
    } else if (!val && !prefixIgnoreMissing.includes(prefix)) {
      status[key] = 2 + scriptId;
    }
  };
  if (!data) data = await storage.base.getMulti();
  data::forEachKey((key) => {
    if (prefixRe.test(key)) {
      status[key] = -1;
    }
  });
  scriptSizes = sizes;
  getScriptsByIdsOrAll().forEach((script) => {
    const { meta, props } = script;
    const { icon } = meta;
    const { id } = props;
    const pathMap = script.custom.pathMap || buildPathMap(script);
    const updUrls = getScriptUpdateUrl(script, true);
    if (updUrls) {
      updUrls.forEach(url => touch(S_MOD_PRE, url, id));
      downloadUrls[id] = updUrls[0];
    }
    touch(S_CODE_PRE, id, id);
    touch(S_VALUE_PRE, id, id);
    meta.require.forEach(url => touch(S_REQUIRE_PRE, url, id, pathMap));
    meta.resources::forEachValue(url => touch(S_CACHE_PRE, url, id, pathMap));
    if (isRemote(icon)) touch(S_CACHE_PRE, icon, id, pathMap);
  });
  status::forEachEntry(([key, value]) => {
    if (value < 0) {
      // Removing redundant value
      keysToRemove.push(key);
    } else if (value >= 2) {
      // Downloading the missing code or resource
      const area = storage.forKey(key);
      const id = area.toId(key);
      const url = area.name === S_CODE ? downloadUrls[id] : id;
      if (noFetch) {
        noFetch.push(url || +id && getScriptPrettyUrl(getScriptById(id)) || key);
      } else if (url && area.fetch) {
        keysToRemove.push(S_MOD_PRE + url);
        toFetch.push(area.fetch(url).catch(err => `${
          getScriptName(getScriptById(+id || value - 2))
        }: ${
          formatHttpError(err)
        }`));
      }
    }
  });
  if (keysToRemove.length) {
    await storage.base.remove(keysToRemove); // Removing `mod` before fetching
    result.errors = (await Promise.all(toFetch)).filter(Boolean);
  }
  if (noFetch && noFetch.length) {
    console.warn('Missing required resources. Try vacuuming database in options.', noFetch);
  }
  _vacuuming = null;
  result.fixes = toFetch.length + keysToRemove.length;
  resolveSelf(result);
  return result;
}
