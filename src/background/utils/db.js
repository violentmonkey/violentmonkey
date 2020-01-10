import {
  i18n, getFullUrl, isRemote, getRnd4, sendCmd,
} from '#/common';
import { CMD_SCRIPT_ADD, CMD_SCRIPT_UPDATE, TIMEOUT_WEEK } from '#/common/consts';
import storage from '#/common/storage';
import pluginEvents from '../plugin/events';
import {
  getNameURI, parseMeta, newScript, getDefaultCustom,
} from './script';
import { testScript, testBlacklist } from './tester';
import { preInitialize } from './init';
import { commands } from './message';
import patchDB from './patch-db';
import { setOption } from './options';

const store = {};

storage.script.onDump = (item) => {
  store.scriptMap[item.props.id] = item;
};

Object.assign(commands, {
  CheckPosition: sortScripts,
  CheckRemove: checkRemove,
  CheckScript({ name, namespace }) {
    const script = getScript({ meta: { name, namespace } });
    return script && !script.config.removed
      ? script.meta.version
      : null;
  },
  ExportZip({ values }) {
    return getExportData(values);
  },
  GetScriptCode: getScriptCode,
  GetMetas: getScriptByIds,
  MarkRemoved({ id, removed }) {
    return markRemoved(id, removed);
  },
  Move({ id, offset }) {
    return moveScript(id, offset);
  },
  RemoveScript(id) {
    return removeScript(id);
  },
  ParseMeta: parseMeta,
  ParseScript: parseScript,
  UpdateScriptInfo({ id, config }) {
    return updateScriptInfo(id, {
      config,
      props: { lastModified: Date.now() },
    });
  },
  Vacuum: vacuum,
});

preInitialize.push(async () => {
  const { version: lastVersion } = await browser.storage.local.get('version');
  const { version } = browser.runtime.getManifest();
  if (!lastVersion) await patchDB();
  if (version !== lastVersion) browser.storage.local.set({ version });
  const data = await browser.storage.local.get();
  const scripts = [];
  const storeInfo = {
    id: 0,
    position: 0,
  };
  const idMap = {};
  const uriMap = {};
  Object.entries(data).forEach(([key, script]) => {
    if (key.startsWith('scr:')) {
      // {
      //   meta,
      //   custom,
      //   props: { id, position, uri },
      //   config: { enabled, shouldUpdate },
      // }
      const id = getInt(key.slice(4));
      if (!id || idMap[id]) {
        // ID conflicts!
        // Should not happen, discard duplicates.
        return;
      }
      idMap[id] = script;
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
    }
  });
  Object.assign(store, {
    scripts,
    storeInfo,
    scriptMap: scripts.reduce((map, item) => {
      map[item.props.id] = item;
      return map;
    }, {}),
  });
  if (process.env.DEBUG) {
    console.log('store:', store); // eslint-disable-line no-console
  }
  return sortScripts();
});

/** @return {number} */
function getInt(val) {
  return +val || 0;
}

/** @return {void} */
function updateLastModified() {
  setOption('lastModified', Date.now());
}

/** @return {Promise<number>} */
export async function normalizePosition() {
  const updates = store.scripts.filter(({ props }, index) => {
    const position = index + 1;
    const res = props.position !== position;
    if (res) props.position = position;
    return res;
  });
  store.storeInfo.position = store.scripts.length;
  if (updates.length) {
    await storage.script.dump(updates);
    updateLastModified();
  }
  return updates.length;
}

/** @return {Promise<number>} */
export async function sortScripts() {
  store.scripts.sort((a, b) => getInt(a.props.position) - getInt(b.props.position));
  const changed = await normalizePosition();
  sendCmd('ScriptsUpdated', null);
  return changed;
}

/** @return {VMScript} */
export function getScriptById(id) {
  return store.scriptMap[id];
}

/** @return {VMScript} */
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

/** @return {VMScript[]} */
export function getScriptByIds(ids) {
  return ids.map(getScriptById).filter(Boolean);
}

/** @return {Promise<string>} */
export function getScriptCode(id) {
  return storage.code.getOne(id);
}

/**
 * @desc Load values for batch updates.
 * @param {number[]} ids
 * @return {Promise}
 */
export function getValueStoresByIds(ids) {
  return storage.value.getMulti(ids);
}

/**
 * @desc Dump values for batch updates.
 * @param {Object} valueDict { id1: value1, id2: value2, ... }
 * @return {Promise}
 */
export async function dumpValueStores(valueDict) {
  if (process.env.DEBUG) console.info('Update value stores', valueDict);
  await storage.value.dump(valueDict);
  return valueDict;
}

/** @return {Promise<Object|undefined>} */
export async function dumpValueStore(where, valueStore) {
  const id = where.id || getScript(where)?.props.id;
  return id && dumpValueStores({ [id]: valueStore });
}

const gmValues = [
  'GM_getValue', 'GM.getValue',
  'GM_setValue', 'GM.setValue',
  'GM_listValues', 'GM.listValues',
  'GM_deleteValue', 'GM.deleteValue',
];

/**
 * @desc Get scripts to be injected to page with specific URL.
 * @return {Promise}
 */
export async function getScriptsByURL(url) {
  const scripts = testBlacklist(url)
    ? []
    : store.scripts.filter(script => !script.config.removed && testScript(url, script));
  const reqKeys = {};
  const cacheKeys = {};
  scripts.forEach((script) => {
    if (script.config.enabled) {
      if (!script.custom.pathMap) buildPathMap(script);
      const { pathMap } = script.custom;
      script.meta.require.forEach((key) => {
        reqKeys[pathMap[key] || key] = 1;
      });
      Object.values(script.meta.resources).forEach((key) => {
        cacheKeys[pathMap[key] || key] = 1;
      });
    }
  });
  const enabledScripts = scripts
  .filter(script => script.config.enabled);
  const scriptsWithValue = enabledScripts
  .filter(script => script.meta.grant?.some(gm => gmValues.includes(gm)));
  const [require, cache, values, code] = await Promise.all([
    storage.require.getMulti(Object.keys(reqKeys)),
    storage.cache.getMulti(Object.keys(cacheKeys)),
    storage.value.getMulti(scriptsWithValue.map(script => script.props.id), {}),
    storage.code.getMulti(enabledScripts.map(script => script.props.id)),
  ]);
  return {
    scripts,
    require,
    cache,
    values,
    code,
  };
}

/** @return {string[]} */
function getIconUrls() {
  return store.scripts.reduce((res, script) => {
    const { icon } = script.meta;
    if (isRemote(icon)) {
      res.push(script.custom.pathMap?.[icon] || icon);
    }
    return res;
  }, []);
}

/**
 * @desc Get data for dashboard.
 * @return {Promise}
 */
export async function getData() {
  return {
    scripts: store.scripts,
    cache: await storage.cache.getMulti(getIconUrls()),
  };
}

/** @return {number} */
export function checkRemove({ force } = {}) {
  const now = Date.now();
  const toRemove = store.scripts.filter(script => script.config.removed && (
    force || now - getInt(script.props.lastModified) > TIMEOUT_WEEK
  ));
  if (toRemove.length) {
    store.scripts = store.scripts.filter(script => !script.config.removed);
    const ids = toRemove.map(script => script.props.id);
    storage.script.removeMulti(ids);
    storage.code.removeMulti(ids);
    storage.value.removeMulti(ids);
  }
  return toRemove.length;
}

/** @return {Promise} */
export async function removeScript(id) {
  const i = store.scripts.indexOf(getScriptById(id));
  if (i >= 0) {
    store.scripts.splice(i, 1);
    await Promise.all([
      storage.script.remove(id),
      storage.code.remove(id),
      storage.value.remove(id),
    ]);
  }
  return sendCmd('RemoveScript', id);
}

/** @return {Promise} */
export function markRemoved(id, removed) {
  return updateScriptInfo(id, {
    config: {
      removed: removed ? 1 : 0,
    },
    props: {
      lastModified: Date.now(),
    },
  });
}

/** @return {Promise<number>} */
export function moveScript(id, offset) {
  const index = store.scripts.indexOf(getScriptById(id));
  const step = offset > 0 ? 1 : -1;
  const indexStart = index;
  const indexEnd = index + offset;
  const offsetI = Math.min(indexStart, indexEnd);
  const offsetJ = Math.max(indexStart, indexEnd);
  const updated = store.scripts.slice(offsetI, offsetJ + 1);
  if (step > 0) {
    updated.push(updated.shift());
  } else {
    updated.unshift(updated.pop());
  }
  store.scripts = [
    ...store.scripts.slice(0, offsetI),
    ...updated,
    ...store.scripts.slice(offsetJ + 1),
  ];
  return normalizePosition();
}

/** @return {string} */
function getUUID(id) {
  const idSec = (id + 0x10bde6a2).toString(16).slice(-8);
  return `${idSec}-${getRnd4()}-${getRnd4()}-${getRnd4()}-${getRnd4()}${getRnd4()}${getRnd4()}`;
}

/**
 * @param {VMScript} script
 * @param {string} code
 * @return {Promise<Array>} [VMScript, codeString]
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
  props.uuid = props.uuid || getUUID(props.id);
  // Do not allow script with same name and namespace
  if (store.scripts.some(({ props: { id, uri } = {} }) => props.id !== id && props.uri === uri)) {
    throw i18n('msgNamespaceConflict');
  }
  if (oldScript) {
    script.config = Object.assign({}, oldScript.config, config);
    script.props = Object.assign({}, oldScript.props, props);
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
  return Promise.all([
    storage.script.dump(script),
    storage.code.set(props.id, code),
  ]);
}

/** @return {Promise} */
export async function updateScriptInfo(id, data) {
  const script = store.scriptMap[id];
  if (!script) throw null;
  script.props = Object.assign({}, script.props, data.props);
  script.config = Object.assign({}, script.config, data.config);
  // script.custom = Object.assign({}, script.custom, data.custom);
  await storage.script.dump(script);
  return sendCmd(CMD_SCRIPT_UPDATE, { where: { id }, update: script });
}

/** @return {Promise} */
export async function getExportData(withValues) {
  const scripts = getScripts();
  const ids = scripts.map(({ props: { id } }) => id);
  const codeMap = await storage.code.getMulti(ids);
  return {
    items: scripts.map(script => ({ script, code: codeMap[script.props.id] })),
    ...withValues && {
      values: await storage.value.getMulti(ids),
    },
  };
}

/** @return {Promise} */
export async function parseScript(src) {
  const meta = parseMeta(src.code);
  if (!meta.name) throw i18n('msgInvalidScript');
  const result = {
    update: {
      message: src.message == null ? i18n('msgUpdated') : src.message || '',
    },
  };
  let cmd = CMD_SCRIPT_UPDATE;
  let script;
  const oldScript = await getScript({ id: src.id, meta });
  if (oldScript) {
    if (src.isNew) throw i18n('msgNamespaceConflict');
    script = { ...oldScript };
  } else {
    ({ script } = newScript());
    cmd = CMD_SCRIPT_ADD;
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
  if (!meta.homepageURL && !script.custom.homepageURL && isRemote(src.from)) {
    script.custom.homepageURL = src.from;
  }
  if (isRemote(src.url)) script.custom.lastInstallURL = src.url;
  if (src.position) script.props.position = +src.position;
  buildPathMap(script, src.url);
  await saveScript(script, src.code);
  fetchScriptResources(script, src);
  Object.assign(result.update, script, src.update);
  result.where = { id: script.props.id };
  sendCmd(cmd, result);
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

/** @return {void} */
function fetchScriptResources(script, cache) {
  const { meta, custom: { pathMap } } = script;
  // @require
  meta.require.forEach((key) => {
    const fullUrl = pathMap[key] || key;
    const cached = cache.require?.[fullUrl];
    if (cached) {
      storage.require.set(fullUrl, cached);
    } else {
      storage.require.fetch(fullUrl);
    }
  });
  // @resource
  Object.values(meta.resources).forEach((url) => {
    const fullUrl = pathMap[url] || url;
    const cached = cache.resources?.[fullUrl];
    if (cached) {
      storage.cache.set(fullUrl, cached);
    } else {
      storage.cache.fetch(fullUrl);
    }
  });
  // @icon
  if (isRemote(meta.icon)) {
    const fullUrl = pathMap[meta.icon] || meta.icon;
    storage.cache.fetch(fullUrl, ({ blob: getBlob }) => new Promise((resolve, reject) => {
      const blob = getBlob();
      const url = URL.createObjectURL(blob);
      const image = new Image();
      const free = () => URL.revokeObjectURL(url);
      image.onload = () => {
        free();
        resolve();
      };
      image.onerror = () => {
        free();
        reject({ type: 'IMAGE_ERROR', url });
      };
      image.src = url;
    }));
  }
}

/** @return {Promise<void>} */
export async function vacuum() {
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
  const data = await browser.storage.local.get();
  Object.keys(data).forEach((key) => {
    mappings.some(([substore, map]) => {
      const { prefix } = substore;
      if (key.startsWith(prefix)) {
        // -1 for untouched, 1 for touched, 2 for missing
        map[key.slice(prefix.length)] = -1;
        return true;
      }
      return false;
    });
  });
  const touch = (obj, key) => {
    if (obj[key] < 0) {
      obj[key] = 1;
    } else if (!obj[key]) {
      obj[key] = 2;
    }
  };
  store.scripts.forEach((script) => {
    const { id } = script.props;
    touch(codeKeys, id);
    touch(valueKeys, id);
    if (!script.custom.pathMap) buildPathMap(script);
    const { pathMap } = script.custom;
    script.meta.require.forEach((url) => {
      touch(requireKeys, pathMap[url] || url);
    });
    Object.values(script.meta.resources).forEach((url) => {
      touch(cacheKeys, pathMap[url] || url);
    });
    const { icon } = script.meta;
    if (isRemote(icon)) {
      const fullUrl = pathMap[icon] || icon;
      touch(cacheKeys, fullUrl);
    }
  });
  mappings.forEach(([substore, map]) => {
    Object.keys(map).forEach((key) => {
      const value = map[key];
      if (value < 0) {
        // redundant value
        substore.remove(key);
      } else if (value === 2 && substore.fetch) {
        // missing resource
        substore.fetch(key);
      }
    });
  });
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
 */
/** @typedef VMScriptCustom *
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
 * @property {string[]} exclude-match
 * @property {string[]} grant
 * @property {string} homepageURL
 * @property {string} icon
 * @property {string[]} include
 * @property {'auto' | 'page' | 'content'} inject-into
 * @property {string[]} match
 * @property {string} namespace
 * @property {string} name
 * @property {boolean} noframes
 * @property {string[]} require
 * @property {Object} resource
 * @property {VMScriptRunAt} run-at
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
/** @typedef {'document-start' | 'document-end' | 'document-idle'} VMScriptRunAt */
