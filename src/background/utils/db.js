import {
  compareVersion, dataUri2text, i18n, getScriptHome, makeDataUri,
  getFullUrl, getScriptName, getScriptUpdateUrl, isRemote, sendCmd, trueJoin,
} from '@/common';
import { INJECT_PAGE, INJECT_AUTO, TIMEOUT_WEEK } from '@/common/consts';
import { forEachEntry, forEachKey, forEachValue } from '@/common/object';
import storage from '@/common/storage';
import pluginEvents from '../plugin/events';
import { getNameURI, parseMeta, newScript, getDefaultCustom } from './script';
import { testScript, testBlacklist } from './tester';
import { preInitialize } from './init';
import { commands } from './message';
import patchDB from './patch-db';
import { setOption } from './options';

export const store = {
  /** @type VMScript[] */
  scripts: [],
  /** @type Object<string,VMScript[]> */
  scriptMap: {},
  storeInfo: {
    id: 0,
    position: 0,
  },
};

Object.assign(commands, {
  CheckPosition: sortScripts,
  CheckRemove: checkRemove,
  /** @return {VMScript} */
  GetScript: getScript,
  /** @return {Promise<{ items: VMScript[], values? }>} */
  async ExportZip({ values }) {
    const scripts = getScripts();
    const ids = scripts.map(getPropsId);
    const codeMap = await storage.code.getMulti(ids);
    return {
      items: scripts.map(script => ({ script, code: codeMap[script.props.id] })),
      values: values ? await storage.value.getMulti(ids) : undefined,
    };
  },
  /** @return {Promise<string>} */
  GetScriptCode(id) {
    return storage.code.getOne(id);
  },
  GetScriptVer(opts) {
    const script = getScript(opts);
    return script && !script.config.removed
      ? script.meta.version
      : null;
  },
  /** @return {Promise<void>} */
  MarkRemoved({ id, removed }) {
    return updateScriptInfo(id, {
      config: { removed: removed ? 1 : 0 },
      props: { lastModified: Date.now() },
    });
  },
  /** @return {Promise<number>} */
  Move({ id, offset }) {
    const script = getScriptById(id);
    const index = store.scripts.indexOf(script);
    store.scripts.splice(index, 1);
    store.scripts.splice(index + offset, 0, script);
    return normalizePosition();
  },
  /** @return {Promise<void>} */
  async RemoveScript(id) {
    const i = store.scripts.indexOf(getScriptById(id));
    if (i >= 0) {
      store.scripts.splice(i, 1);
      await storage.base.remove([
        storage.script.toKey(id),
        storage.code.toKey(id),
        storage.value.toKey(id),
      ]);
    }
    return sendCmd('RemoveScript', id);
  },
  ParseMeta: parseMeta,
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
  const { scripts, storeInfo, scriptMap } = store;
  const uriMap = {};
  const mods = [];
  const resUrls = new Set();
  /** @this VMScriptCustom.pathMap */
  const rememberUrl = function _(url) { resUrls.add(this[url] || url); };
  data::forEachEntry(([key, script]) => {
    let id = +storage.script.toId(key);
    if (id) {
      if (scriptMap[id] && scriptMap[id] !== script) {
        // ID conflicts!
        // Should not happen, discard duplicates.
        return;
      }
      const uri = getNameURI(script);
      if (uriMap[uri]) {
        // Namespace conflicts!
        // Should not happen, discard duplicates.
        return;
      }
      uriMap[uri] = script;
      script.props = {
        ...script.props,
        id,
        uri,
      };
      script.custom = {
        ...getDefaultCustom(),
        ...script.custom,
      };
      storeInfo.id = Math.max(storeInfo.id, id);
      storeInfo.position = Math.max(storeInfo.position, getInt(script.props.position));
      scripts.push(script);
      // listing all known resource urls in order to remove unused mod keys
      const {
        custom: { pathMap = {} } = {},
        meta = script.meta = {},
      } = script;
      const {
        require = meta.require = [],
        resources = meta.resources = {},
      } = meta;
      meta.grant = [...new Set(meta.grant || [])]; // deduplicate
      require.forEach(rememberUrl, pathMap);
      resources::forEachValue(rememberUrl, pathMap);
      pathMap::rememberUrl(meta.icon);
      getScriptUpdateUrl(script, true)?.forEach(rememberUrl, pathMap);
    } else if ((id = storage.mod.toId(key))) {
      mods.push(id);
    }
  });
  storage.mod.remove(mods.filter(url => !resUrls.has(url)));
  // Switch defaultInjectInto from `page` to `auto` when upgrading VM2.12.7 or older
  if (version !== lastVersion
  && IS_FIREFOX
  && data.options?.defaultInjectInto === INJECT_PAGE
  && compareVersion(lastVersion, '2.12.7') <= 0) {
    setOption('defaultInjectInto', INJECT_AUTO);
  }
  if (process.env.DEBUG) {
    console.log('store:', store); // eslint-disable-line no-console
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
  const updates = store.scripts.reduce((res, script, index) => {
    const { props } = script;
    const position = index + 1;
    if (props.position !== position) {
      props.position = position;
      (res || (res = {}))[props.id] = script;
    }
    return res;
  }, null);
  store.storeInfo.position = store.scripts.length;
  if (updates) {
    await storage.script.set(updates);
    updateLastModified();
  }
  return !!updates;
}

/** @return {Promise<number>} */
export async function sortScripts() {
  store.scripts.sort((a, b) => getInt(a.props.position) - getInt(b.props.position));
  const changed = await normalizePosition();
  sendCmd('ScriptsUpdated', null);
  return changed;
}

/** @return {?VMScript} */
export function getScriptById(id) {
  return store.scriptMap[id];
}

/** @return {?VMScript} */
export function getScript({ id, uri, meta }) {
  let script;
  if (id) {
    script = getScriptById(id);
  } else {
    if (!uri) uri = getNameURI({ meta, id: '@@should-have-name' });
    script = store.scripts.find(({ props }) => uri === props.uri);
  }
  return script;
}

/** @return {VMScript[]} */
export function getScripts() {
  return store.scripts.filter(script => !script.config.removed);
}

export const ENV_CACHE_KEYS = 'cacheKeys';
export const ENV_REQ_KEYS = 'reqKeys';
export const ENV_SCRIPTS = 'scripts';
export const ENV_VALUE_IDS = 'valueIds';
const GMVALUES_RE = /^GM[_.](listValues|([gs]et|delete)Value)$/;
const RUN_AT_RE = /^document-(start|body|end|idle)$/;
/**
 * @desc Get scripts to be injected to page with specific URL.
 */
export function getScriptsByURL(url, isTop) {
  const allScripts = testBlacklist(url)
    ? []
    : store.scripts.filter(script => (
      !script.config.removed
      && (isTop || !(script.custom.noframes ?? script.meta.noframes))
      && testScript(url, script)
    ));
  return getScriptEnv(allScripts);
}

/**
 * @param {VMScript[]} scripts
 * @param {boolean} [sizing]
 * @return {VMScriptByUrlData}
 */
function getScriptEnv(scripts, sizing) {
  const disabledIds = [];
  /** @namespace VMScriptByUrlData */
  const [envStart, envDelayed] = [0, 1].map(() => ({
    ids: [],
    depsMap: {},
    sizing,
    [ENV_CACHE_KEYS]: [],
    [ENV_REQ_KEYS]: [],
    [ENV_SCRIPTS]: [],
    [ENV_VALUE_IDS]: [],
  }));
  scripts.forEach((script) => {
    const { id } = script.props;
    if (!sizing && !script.config.enabled) {
      disabledIds.push(id);
      return;
    }
    const { meta, custom } = script;
    const { pathMap = buildPathMap(script) } = custom;
    const runAt = `${custom.runAt || meta.runAt || ''}`.match(RUN_AT_RE)?.[1] || 'end';
    const env = sizing || runAt === 'start' || runAt === 'body' ? envStart : envDelayed;
    const { depsMap } = env;
    env.ids.push(id);
    if (meta.grant.some(GMVALUES_RE.test, GMVALUES_RE)) {
      env[ENV_VALUE_IDS].push(id);
    }
    for (const [list, name] of [
      [meta.require, ENV_REQ_KEYS],
      [Object.values(meta.resources), ENV_CACHE_KEYS],
    ]) {
      list.forEach(key => {
        key = pathMap[key] || key;
        if (key && !(name === ENV_CACHE_KEYS && envStart[name].includes(key))) {
          env[name].push(key);
          (depsMap[key] || (depsMap[key] = [])).push(id);
        }
      });
    }
    /** @namespace VMInjectedScript */
    env[ENV_SCRIPTS].push(sizing ? script : { ...script, runAt });
  });
  envStart.promise = readEnvironmentData(envStart);
  if (envDelayed.ids.length) {
    envDelayed.promise = readEnvironmentData(envDelayed);
  }
  return Object.assign(envStart, { disabledIds, envDelayed });
}

/**
 * Object keys == areas in `storage` module.
 * @namespace VMScriptByUrlData
 */
const STORAGE_ROUTES = Object.entries({
  cache: ENV_CACHE_KEYS,
  code: 'ids',
  require: ENV_REQ_KEYS,
  value: ENV_VALUE_IDS,
});
const retriedStorageKeys = {};

async function readEnvironmentData(env, isRetry) {
  const keys = [];
  STORAGE_ROUTES.forEach(([area, srcIds]) => {
    env[srcIds].forEach(id => {
      if (!/^data:/.test(id)) {
        keys.push(storage[area].toKey(id));
      }
    });
  });
  const data = await storage.base.getMulti(keys);
  const badScripts = new Set();
  for (const [area, srcIds] of STORAGE_ROUTES) {
    env[area] = {};
    for (const id of env[srcIds]) {
      const val = /^data:/.test(id)
        ? area !== 'require' && id || dataUri2text(id)
        : data[storage[area].toKey(id)];
      env[area][id] = val;
      if (val == null && area !== 'value' && !env.sizing && retriedStorageKeys[area + id] !== 2) {
        retriedStorageKeys[area + id] = isRetry ? 2 : 1;
        if (!isRetry) {
          console.warn(`The "${area}" storage is missing "${id}"! Vacuuming...`);
          if ((await vacuum()).fixes) {
            return readEnvironmentData(env, true);
          }
        }
        if (area === 'code') {
          badScripts.add(id);
        } else {
          env.depsMap[id]?.forEach(scriptId => badScripts.add(scriptId));
        }
      }
    }
  }
  if (badScripts.size) {
    const title = i18n('msgMissingResources');
    const text = i18n('msgReinstallScripts')
      + [...badScripts].map(id => `\n#${id}: ${getScriptName(getScriptById(id))}`).join('');
    console.error(`${title} ${text}`);
    await commands.Notification({ title, text }, undefined, {
      onClick() {
        badScripts.forEach(id => commands.OpenEditor(id));
      },
    });
  }
  return env;
}

/**
 * @desc Get data for dashboard.
 * @return {Promise<{ scripts: VMScript[], cache: Object }>}
 */
export async function getData(ids) {
  const scripts = ids ? ids.map(getScriptById) : store.scripts;
  return {
    scripts,
    cache: await getIconCache(scripts),
  };
}

/**
 * @param {VMScript[]} scripts
 * @return {Promise<{}>}
 */
function getIconCache(scripts) {
  return storage.cache.getMulti(
    scripts.reduce((res, { custom, meta: { icon } }) => {
      if (isRemote(icon)) res.push(custom.pathMap?.[icon] || icon);
      return res;
    }, []),
    makeDataUri,
  );
}

export async function getSizes(ids) {
  const scripts = ids ? ids.map(getScriptById) : store.scripts;
  const { cache, code, value, require } = await getScriptEnv(scripts, true).promise;
  return scripts.map(({
    meta,
    custom: { pathMap = {} },
    props: { id },
  }, index) => /** @namespace VMScriptSizeInfo */ ({
    c: code[id]?.length,
    i: JSON.stringify(scripts[index]).length - 2,
    v: JSON.stringify(value[id] || {}).length - 2,
    '@require': meta.require.reduce((len, v) => len + (require[pathMap[v] || v]?.length || 0), 0),
    '@resource': Object.values(meta.resources)
    .reduce((len, v) => len + (cache[pathMap[v] || v]?.length || 0), 0),
  }));
}

/** @return {?Promise<void>} only if something was removed, otherwise undefined */
export function checkRemove({ force } = {}) {
  const now = Date.now();
  const toKeep = [];
  const toRemove = [];
  store.scripts.forEach(script => {
    const { id, lastModified } = script.props;
    if (script.config.removed && (force || now - getInt(lastModified) > TIMEOUT_WEEK)) {
      toRemove.push(storage.code.toKey(id),
        storage.script.toKey(id),
        storage.value.toKey(id));
    } else {
      toKeep.push(script);
    }
  });
  if (toRemove.length) {
    store.scripts = toKeep;
    return storage.base.remove(toRemove);
  }
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
    store.storeInfo.id += 1;
    props.id = store.storeInfo.id;
  } else {
    oldScript = store.scriptMap[props.id];
  }
  props.uri = getNameURI(script);
  props.uuid = props.uuid || crypto.randomUUID?.() || getUUID();
  // Do not allow script with same name and namespace
  if (store.scripts.some(({ props: { id, uri } = {} }) => props.id !== id && props.uri === uri)) {
    throw i18n('msgNamespaceConflict');
  }
  if (oldScript) {
    script.config = { ...oldScript.config, ...config };
    script.props = { ...oldScript.props, ...props };
    const index = store.scripts.indexOf(oldScript);
    store.scripts[index] = script;
  } else {
    if (!props.position) {
      store.storeInfo.position += 1;
      props.position = store.storeInfo.position;
    } else if (store.storeInfo.position < props.position) {
      store.storeInfo.position = props.position;
    }
    script.config = config;
    script.props = props;
    store.scripts.push(script);
  }
  return storage.base.set({
    [storage.script.toKey(props.id)]: script,
    [storage.code.toKey(props.id)]: code,
  });
}

/** @return {Promise<void>} */
export async function updateScriptInfo(id, data) {
  const script = store.scriptMap[id];
  if (!script) throw null;
  script.props = { ...script.props, ...data.props };
  script.config = { ...script.config, ...data.config };
  script.custom = { ...script.custom, ...data.custom };
  await storage.script.setOne(id, script);
  return sendCmd('UpdateScript', { where: { id }, update: script });
}

/** @return {Promise<{ isNew?, update, where }>} */
export async function parseScript(src) {
  const meta = parseMeta(src.code);
  if (!meta.name) throw `${i18n('msgInvalidScript')}\n${i18n('labelNoName')}`;
  const result = {
    update: {
      message: src.message == null ? i18n('msgUpdated') : src.message || '',
    },
  };
  let script;
  const oldScript = await getScript({ id: src.id, meta });
  if (oldScript) {
    if (src.isNew) throw i18n('msgNamespaceConflict');
    script = { ...oldScript };
  } else {
    ({ script } = newScript());
    result.isNew = true;
    result.update.message = i18n('msgInstalled');
  }
  script.config = {
    ...script.config,
    ...src.config,
    removed: 0, // force reset `removed` since this is an installation
  };
  script.custom = {
    ...script.custom,
    ...src.custom,
  };
  script.props = {
    ...script.props,
    lastModified: Date.now(),
    lastUpdated: Date.now(),
    ...src.props,
  };
  script.meta = meta;
  if (!getScriptHome(script) && isRemote(src.from)) {
    script.custom.homepageURL = src.from;
  }
  if (isRemote(src.url)) script.custom.lastInstallURL = src.url;
  if (src.position) script.props.position = +src.position;
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
    url = pathMap[url] || url;
    const contents = resourceCache?.[type]?.[url];
    return contents != null && !validator
      ? storage[type].setOne(url, contents) && null
      : storage[type].fetch(url, reqOptions, validator).catch(err => err);
  };
  const errors = await Promise.all([
    ...meta.require.map(url => url && snatch(url, 'require')),
    ...Object.values(meta.resources).map(url => url && snatch(url, 'cache')),
    isRemote(meta.icon) && snatch(meta.icon, 'cache', validateImage),
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
  let numFixes = 0;
  let resolveSelf;
  _vacuuming = new Promise(r => { resolveSelf = r; });
  const result = {};
  const toFetch = [];
  const keysToRemove = [
    'editorThemeNames', // TODO: remove in 2022
  ];
  const valueKeys = {};
  const cacheKeys = {};
  const requireKeys = {};
  const codeKeys = {};
  const mappings = [
    [storage.value, valueKeys],
    [storage.cache, cacheKeys],
    [storage.require, requireKeys],
    [storage.code, codeKeys],
  ];
  if (!data) data = await storage.base.getMulti();
  data::forEachKey((key) => {
    mappings.some(([substore, map]) => {
      const id = substore.toId(key);
      // -1 for untouched, 1 for touched, 2 for missing
      if (id) map[id] = -1;
      return id;
    });
  });
  const touch = (obj, key, scriptId) => {
    if (obj[key] < 0) {
      obj[key] = 1;
    } else if (!obj[key]) {
      obj[key] = 2 + scriptId;
    }
  };
  store.scripts.forEach((script) => {
    const { id } = script.props;
    touch(codeKeys, id, id);
    touch(valueKeys, id, id);
    if (!script.custom.pathMap) buildPathMap(script);
    const { pathMap } = script.custom;
    script.meta.require.forEach((url) => {
      if (url) touch(requireKeys, pathMap[url] || url, id);
    });
    script.meta.resources::forEachValue((url) => {
      if (url) touch(cacheKeys, pathMap[url] || url, id);
    });
    const { icon } = script.meta;
    if (isRemote(icon)) {
      const fullUrl = pathMap[icon] || icon;
      touch(cacheKeys, fullUrl, id);
    }
  });
  mappings.forEach(([substore, map]) => {
    map::forEachEntry(([key, value]) => {
      if (value < 0) {
        // redundant value
        keysToRemove.push(substore.toKey(key));
        numFixes += 1;
      } else if (value >= 2 && substore.fetch) {
        // missing resource
        keysToRemove.push(storage.mod.toKey(key));
        toFetch.push(substore.fetch(key).catch(err => `${
          getScriptName(getScriptById(value - 2))
        }: ${
          formatHttpError(err)
        }`));
        numFixes += 1;
      }
    });
  });
  if (numFixes) {
    await storage.base.remove(keysToRemove); // Removing `mod` before fetching
    result.errors = (await Promise.all(toFetch)).filter(Boolean);
  }
  _vacuuming = null;
  result.fixes = numFixes;
  resolveSelf(result);
  return result;
}

/** @typedef VMScript
 * @property {VMScriptConfig} config
 * @property {VMScriptCustom} custom
 * @property {VMScriptMeta} meta
 * @property {VMScriptProps} props
 */
/** @typedef VMScriptConfig *
 * @property {Boolean} enabled - stored as 0 or 1
 * @property {Boolean} removed - stored as 0 or 1
 * @property {Boolean} shouldUpdate - stored as 0 or 1
 * @property {Boolean | null} notifyUpdates - stored as 0 or 1 or null (default) which means "use global setting"
 */
/** @typedef VMScriptCustom *
 * @property {string} name
 * @property {string} downloadURL
 * @property {string} homepageURL
 * @property {string} lastInstallURL
 * @property {string} updateURL
 * @property {'auto' | 'page' | 'content'} injectInto
 * @property {null | 1 | 0} noframes - null or absence == default (script's value)
 * @property {string[]} exclude
 * @property {string[]} excludeMatch
 * @property {string[]} include
 * @property {string[]} match
 * @property {boolean} origExclude
 * @property {boolean} origExcludeMatch
 * @property {boolean} origInclude
 * @property {boolean} origMatch
 * @property {Object} pathMap
 * @property {VMScriptRunAt} runAt
 */
/** @typedef VMScriptMeta *
 * @property {string} description
 * @property {string} downloadURL
 * @property {string[]} exclude
 * @property {string[]} excludeMatch
 * @property {string[]} grant
 * @property {string} homepageURL
 * @property {string} icon
 * @property {string[]} include
 * @property {'auto' | 'page' | 'content'} injectInto
 * @property {string[]} match
 * @property {string} namespace
 * @property {string} name
 * @property {boolean} noframes
 * @property {string[]} require
 * @property {Object} resources
 * @property {VMScriptRunAt} runAt
 * @property {string} supportURL
 * @property {string} version
 */
/** @typedef VMScriptProps *
 * @property {number} id
 * @property {number} lastModified
 * @property {number} lastUpdated
 * @property {number} position
 * @property {string} uri
 * @property {string} uuid
 */
/**
 * @typedef {
   'document-start' | 'document-body' | 'document-end' | 'document-idle'
 } VMScriptRunAt
 */
