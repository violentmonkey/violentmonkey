import {
  compareVersion, dataUri2text, i18n, getScriptHome, isDataUri,
  getScriptName, getScriptUpdateUrl, isRemote, sendCmd, trueJoin,
  getScriptPrettyUrl, getScriptRunAt, makePause, isValidHttpUrl, normalizeTag,
  ignoreChromeErrors,
} from '@/common';
import { FETCH_OPTS, INFERRED, TIMEOUT_24HOURS, TIMEOUT_WEEK, TL_AWAIT } from '@/common/consts';
import { deepSize, forEachEntry, forEachKey, forEachValue } from '@/common/object';
import pluginEvents from '../plugin/events';
import { getDefaultCustom, getNameURI, inferScriptProps, newScript, parseMeta } from './script';
import { testBlacklist, testerBatch, testScript } from './tester';
import { getImageData } from './icon';
import { addOwnCommands, addPublicCommands, commands, resolveInit } from './init';
import patchDB from './patch-db';
import { getOption, initOptions, kOptions, kVersion, setOption } from './options';
import storage, {
  S_CACHE, S_CODE, S_REQUIRE, S_SCRIPT, S_VALUE,
  S_CACHE_PRE, S_CODE_PRE, S_MOD_PRE, S_REQUIRE_PRE, S_SCRIPT_PRE, S_VALUE_PRE,
  getStorageKeys,
} from './storage';
import { dbKeys, storageCacheHas } from './storage-cache';
import { reloadTabForScript } from './tabs';
import { vetUrl } from './url';

let maxScriptId = 0;
let maxScriptPosition = 0;
/** @type {{ [url:string]: number }} */
export let scriptSizes = {};
/** @type {{ [id: string]: VMScript }} */
const scriptMap = {};
/** @type {VMScript[]} */
const aliveScripts = [];
/** @type {VMScript[]} */
const removedScripts = [];
/** Ensuring slow icons don't prevent installation/update */
const ICON_TIMEOUT = 1000;
/** Same order as in SIZE_TITLES and getSizes */
export const sizesPrefixRe = RegExp(
  `^(${S_CODE_PRE}|${S_SCRIPT_PRE}|${S_VALUE_PRE}|${S_REQUIRE_PRE}|${S_CACHE_PRE}${S_MOD_PRE})`);
/** @type {{ [type: 'cache' | 'require']: { [url: string]: Promise<?> } }} */
const pendingDeps = { [S_CACHE]: {}, [S_REQUIRE]: {} };
const depsPorts = {};

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
  GetData: getData,
  GetMoreIds({ url, [kTop]: isTop, [IDS]: ids }) {
    return getScriptsByURL(url, isTop, null, ids);
  },
  /** @return {VMScript} */
  GetScript: getScript,
  GetSizes: getSizes,
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
  ParseMetaErrors: data => parseMetaWithErrors(data).errors,
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

(async () => {
  /** @type {string[]} */
  let allKeys, keys;
  if (getStorageKeys) {
    allKeys = await getStorageKeys();
    keys = allKeys.filter(key => {
      dbKeys.set(key, 1);
      return key.startsWith(S_SCRIPT_PRE);
    });
    keys.push(kOptions);
  }
  const lastVersion = (!getStorageKeys || dbKeys.has(kVersion))
    && await storage.base.getOne(kVersion);
  const version = process.env.VM_VER;
  if (!lastVersion) await patchDB();
  if (version !== lastVersion) storage.base.set({ [kVersion]: version });
  const data = await storage.base.getMulti(keys);
  const uriMap = {};
  const defaultCustom = getDefaultCustom();
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
      const {pathMap} = script.custom = Object.assign({}, defaultCustom, script.custom);
      // Patching the bug in 2.27.0 where data: URI was saved as invalid in pathMap
      if (pathMap) for (const url in pathMap) if (isDataUri(url)) delete pathMap[url];
      maxScriptId = Math.max(maxScriptId, id);
      maxScriptPosition = Math.max(maxScriptPosition, getInt(script.props.position));
      (script.config.removed ? removedScripts : aliveScripts).push(script);
      // listing all known resource urls in order to remove unused mod keys
      const {
        meta = script.meta = {},
      } = script;
      if (!meta.require) meta.require = [];
      if (!meta.resources) meta.resources = {};
      if (TL_AWAIT in meta) meta[TL_AWAIT] = true; // a string if the script was saved in old VM
      meta.grant = [...new Set(meta.grant || [])]; // deduplicate
    }
  });
  initOptions(data);
  // Switch defaultInjectInto from `page` to `auto` when upgrading VM2.12.7 or older
  if (version !== lastVersion
  && IS_FIREFOX
  && getOption('defaultInjectInto') === PAGE
  && compareVersion(lastVersion, '2.12.7') <= 0) {
    setOption('defaultInjectInto', AUTO);
  }
  if (process.env.DEBUG) {
    console.info('store:', {
      aliveScripts, removedScripts, maxScriptId, maxScriptPosition, scriptMap, scriptSizes,
    });
  }
  sortScripts();
  setTimeout(async () => {
    if (allKeys?.length) {
      const set = new Set(keys); // much faster lookup
      const data2 = await storage.base.getMulti(allKeys.filter(k => !set.has(k)));
      Object.assign(data, data2);
    }
    vacuum(data);
  }, 100);
  checkRemove();
  setInterval(checkRemove, TIMEOUT_24HOURS);
  resolveInit();
})();

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

export function updateScriptMap(key, val) {
  const id = +storage[S_SCRIPT].toId(key);
  if (!id) return;
  if (val) {
    const oldScript = scriptMap[id];
    const i1 = aliveScripts.indexOf(oldScript);
    const i2 = removedScripts.indexOf(oldScript);
    if (i1 >= 0) aliveScripts[i1] = val;
    if (i2 >= 0) removedScripts[i2] = val;
    scriptMap[id] = val;
  } else {
    delete scriptMap[id];
  }
  return true;
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

/** @return {Promise<Boolean>} */
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
    if (!uri) uri = getNameURI({ meta, props: { id: '@@should-have-name' } });
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
const GMVALUES_RE = /^GM[_.](listValues|([gs]et|delete)Values?)$/;
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
 * @param {Object} [prevIds] - used by the popup to return an object with only new ids
 *   (disabled, newly installed, non-matching due to SPA navigation)
 * @return {VMInjection.EnvStart | VMInjection.EnvDelayed | Object | void }
 */
export function getScriptsByURL(url, isTop, errors, prevIds) {
  if (testBlacklist(url)) return;
  const allIds = {};
  const isDelayed = !errors;
  /** @type {VMInjection.EnvStart} */
  let envStart;
  /** @type {VMInjection.EnvDelayed} */
  let envDelayed;
  let clipboardChecked = isDelayed || !IS_FIREFOX;
  testerBatch(errors || true);
  for (const script of aliveScripts) {
    const {
      config: { enabled },
      custom,
      meta,
      props: { id },
    } = script;
    if ((prevIds ? id in prevIds : !enabled)
    || !((isTop || !(custom.noframes ?? meta.noframes)) && testScript(url, script))) {
      continue;
    }
    if (prevIds) {
      allIds[id] = enabled ? MORE : 0;
      continue;
    }
    allIds[id] = 1;
    if (!envStart) {
      envStart = makeEnv();
      envDelayed = makeEnv();
      for (const [areaName, listName] of STORAGE_ROUTES_ENTRIES) {
        envStart[areaName] = {}; envDelayed[areaName] = {};
        envStart[listName] = []; envDelayed[listName] = [];
      }
    }
    const { pathMap = buildPathMap(script) } = custom;
    const runAt = getScriptRunAt(script);
    const env = runAt === 'start' || runAt === 'body' ? envStart : envDelayed;
    const { depsMap } = env;
    env[IDS].push(id);
    env[RUN_AT][id] = runAt;
    if (meta.grant.some(GMVALUES_RE.test, GMVALUES_RE)) {
      env[VALUE_IDS].push(id);
    }
    if (!clipboardChecked) {
      for (const g of meta.grant) {
        if (!clipboardChecked && (g === 'GM_setClipboard' || g === 'GM.setClipboard')) {
          clipboardChecked = envStart.clipFF = true;
        }
      }
    }
    for (const [list, name, dataUriDecoder] of [
      [meta.require, S_REQUIRE, dataUri2text],
      [Object.values(meta.resources), S_CACHE],
    ]) {
      const listName = STORAGE_ROUTES[name];
      const envCheck = name === S_CACHE ? envStart : env; // envStart cache is reused in injected
      // eslint-disable-next-line no-shadow
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
  }
  testerBatch();
  if (prevIds) {
    return allIds;
  }
  if (!envStart) {
    return;
  }
  if (isDelayed) {
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
      // {} enables tracking in addValueOpener
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
  commands.Notification({
    title,
    text,
    onclick() {
      ids.forEach(id => commands.OpenEditor(id));
    },
  });
}

/**
 * @desc Get data for dashboard.
 * @return {Promise<{ scripts: VMScript[], cache: Object }>}
 */
export async function getData({ id, ids, sizes }) {
  if (id) ids = [id];
  const res = {};
  const scripts = ids
    // Some ids shown in popup/editor may have been hard-deleted
    ? getScriptsByIdsOrAll(ids).filter(Boolean)
    : getScriptsByIdsOrAll();
  scripts.forEach(inferScriptProps);
  res[SCRIPTS] = scripts;
  if (sizes) res.sizes = getSizes(ids);
  if (!id) res.cache = await getIconCache(scripts);
  if (!id && sizes) res.sync = commands.SyncGetStates();
  return res;
}

/**
 * Returns only own icon and the already cached icons.
 * The rest are prefetched in background and will be used by loadScriptIcon.
 * @param {VMScript[]} scripts
 * @return {Promise<{}>}
 */
async function getIconCache(scripts) {
  // data uri for own icon to load it instantly in Chrome when there are many images
  const toGet = [`${ICON_PREFIX}38.png`];
  const toPrime = [];
  const res = {};
  for (let { custom, meta } of scripts) {
    let icon = custom.icon || meta.icon;
    if (isValidHttpUrl(icon)) {
      icon = custom.pathMap[icon] || icon;
      toGet.push(icon);
      if (!storageCacheHas(S_CACHE_PRE + icon)) toPrime.push(icon);
    }
  }
  if (toPrime.length) {
    await storage[S_CACHE].getMulti(toPrime);
  }
  for (let i = 0, d, url; i < toGet.length; i++) {
    url = toGet[i];
    d = getImageData(url);
    if (!isObject(d) || !i && (d = await d)) {
      res[url] = d;
    }
  }
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
const getUUID = crypto.randomUUID ? crypto.randomUUID.bind(crypto) : () => {
  const rnd = new Uint16Array(8);
  window.crypto.getRandomValues(rnd);
  // xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx
  // We're using UUIDv4 variant 1 so N=4 and M=8
  // See format_uuid_v3or5 in https://tools.ietf.org/rfc/rfc4122.txt
  rnd[3] = rnd[3] & 0x0FFF | 0x4000; // eslint-disable-line no-bitwise
  rnd[4] = rnd[4] & 0x3FFF | 0x8000; // eslint-disable-line no-bitwise
  return '01-2-3-4-567'.replace(/\d/g, i => (rnd[i] + 0x1_0000).toString(16).slice(-4));
};

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
  const errors = [];
  const meta = parseMeta(isObj ? src.code : src, { errors });
  if (meta) {
    testerBatch(errors);
    testScript('', { meta, custom });
    testerBatch();
  } else {
    errors.push(i18n('labelNoName')); // used by confirm app
  }
  return {
    meta,
    errors: errors.length ? errors : null,
  };
}

/**
 * @param {VMScriptSourceOptions} src
 * @return {Promise<{
 *   errors: string[],
 *   isNew: boolean,
 *   update: VMScript & { message: string },
 *   where: { id: number },
 * }>}
 */
export async function parseScript(src) {
  const { meta, errors } = src.meta ? src : parseMetaWithErrors(src);
  if (!meta.name) throw `${i18n('msgInvalidScript')}\n${i18n('labelNoName')}`;
  const update = {
    message: src.message == null ? i18n('msgUpdated') : src.message || '',
  };
  const result = { errors, update };
  const { [S_CODE]: code, update: srcUpdate } = src;
  const now = Date.now();
  let { id } = src;
  let script;
  let oldScript = getScript({ id, meta });
  if (oldScript) {
    script = oldScript;
    id = script.props.id;
  } else {
    ({ script } = newScript());
    maxScriptId++;
    id = script.props.id = maxScriptId;
    result.isNew = true;
    update.message = i18n('msgInstalled');
    aliveScripts.push(script);
  }
  const { config, custom, props } = script;
  const uri = getNameURI({ meta, props: {id} });
  if (oldScript) {
    // Do not allow script with same name and namespace
    if (src.isNew || id && aliveScripts.some(({ props: p }) => uri === p.uri && id !== p.id)) {
      throw i18n('msgNamespaceConflict');
    }
    delete script[INFERRED];
  }
  props.lastModified = now;
  props.uuid = props.uuid || getUUID();
  // Overwriting inner data by `src`, deleting keys for which `src` specifies `null`
  for (const key of ['config', 'custom', 'props']) {
    const dst = script[key];
    src[key]::forEachEntry(([srcKey, srcVal]) => {
      if (srcVal == null) delete dst[srcKey];
      else dst[srcKey] = srcVal;
    });
  }
  const pos = +src.position;
  if (pos) {
    props.position = pos;
    maxScriptPosition = Math.max(maxScriptPosition, pos);
  } else if (!oldScript) {
    maxScriptPosition++;
    props.position = maxScriptPosition;
  }
  config.enabled = getInt(config.enabled);
  config.removed = 0; // force-resetting `removed` since this is an installation
  config.shouldUpdate = getInt(config.shouldUpdate);
  script.meta = meta;
  props.uri = getNameURI(script); // DANGER! Must be after props.position and meta assignments.
  delete custom.from; // remove the old installation URL if any
  if (!getScriptHome(script) && isRemote(src.from)) {
    custom.from = src.from; // to avoid overriding script's `meta` for homepage in a future version
  }
  // Allowing any http url including localhost as the user may keep multiple scripts there
  if (isValidHttpUrl(src.url)) custom.lastInstallURL = src.url;
  custom.tags = custom.tags?.split(/\s+/).map(normalizeTag).filter(Boolean).join(' ').toLowerCase();
  if (!srcUpdate) storage.mod.remove(getScriptUpdateUrl(script, { all: true }) || []);
  buildPathMap(script, src.url);
  const depsPromise = fetchResources(script, src);
  // DANGER! Awaiting here when all props are set to avoid modifications made by a "concurrent" call
  const codeChanged = !oldScript || code !== await storage[S_CODE].getOne(id);
  if (codeChanged && src.bumpDate) props.lastUpdated = now;
  // Installer has all the deps, so we'll put them in storage first
  if (src.cache) await depsPromise;
  await storage.base.set({
    [S_SCRIPT_PRE + id]: script,
    ...codeChanged && { [S_CODE_PRE + id]: code },
  });
  Object.assign(update, script, srcUpdate);
  result.where = { id };
  result[S_CODE] = src[S_CODE];
  sendCmd('UpdateScript', result);
  pluginEvents.emit('scriptChanged', result);
  if (src.reloadTab) reloadTabForScript(script);
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
      const fullUrl = vetUrl(key, baseUrl);
      if (fullUrl !== key) map[key] = fullUrl;
    }
    return map;
  }, {}) : {};
  script.custom.pathMap = pathMap;
  return pathMap;
}

/**
 * @param {VMScript} script
 * @param {VMScriptSourceOptions} src
 * @return {Promise<?string>} error text
 */
export async function fetchResources(script, src) {
  const { custom, meta } = script;
  const { pathMap } = custom;
  const { resources } = meta;
  const icon = custom.icon || meta.icon;
  const jobs = [];
  for (const url of meta.require) {
    jobs.push([S_REQUIRE, url]);
  }
  for (const key in resources) {
    jobs.push([S_CACHE, resources[key]]);
  }
  if (isRemote(icon)) {
    jobs.push([S_CACHE, icon, ICON_TIMEOUT]);
  }
  for (let i = 0, type, url, timeout, res; i < jobs.length; i++) {
    [type, url, timeout] = jobs[i];
    if (!(res = pendingDeps[type][url])) {
      if (url && !isDataUri(url)) {
        url = pathMap[url] || url;
        if ((res = src[type]) && (res = res[url]) != null) {
          storage[type].setOne(url, res);
          res = '';
        } else {
          res = fetchResource(src, type, url);
          if (timeout) res = Promise.race([res, makePause(timeout)]);
          pendingDeps[type][url] = res;
        }
      }
    }
    jobs[i] = res;
  }
  const errors = await Promise.all(jobs);
  const error = errors.map(formatHttpError)::trueJoin('\n');
  if (error) {
    const message = i18n('msgErrorFetchingResource');
    sendCmd('UpdateScript', {
      update: { error, message },
      where: { id: getPropsId(script) },
    });
    return `${message}\n${error}`;
  }
}

/**
 * @param {VMScriptSourceOptions} src
 * @param {string} type
 * @param {string} url
 * @return {Promise<?>}
 */
async function fetchResource(src, type, url) {
  if (!src.reuseDeps && !isRemote(url)
  || src.update
  || await storage[type].getOne(url) == null) {
    const { portId } = src;
    if (portId) postToPort(depsPorts, portId, [url]);
    try {
      await storage[type].fetch(url, src[FETCH_OPTS]);
    } catch (err) {
      return err;
    } finally {
      if (portId) postToPort(depsPorts, portId, [url, true]);
      delete pendingDeps[type][url];
    }
  }
}

function postToPort(ports, id, msg) {
  let p = ports[id];
  if (!p) {
    p = ports[id] = chrome.runtime.connect({ name: id });
    p.onDisconnect.addListener(() => {
      ignoreChromeErrors();
      delete ports[id];
    });
  }
  p.postMessage(msg);
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
      if (prefix === S_VALUE_PRE) {
        if ((sizes[key] = deepSize(data[key])) === 2) {
          // remove empty {}
          sizes[key] = 0;
          status[key] = -1;
        }
      } else if (prefix !== S_MOD_PRE) {
        sizes[key] = deepSize(data[key]) + key.length;
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
    const icon = script.custom.icon || meta.icon;
    const { id } = props;
    const pathMap = script.custom.pathMap || buildPathMap(script);
    const updUrls = getScriptUpdateUrl(script, { all: true });
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
