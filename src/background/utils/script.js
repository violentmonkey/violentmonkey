import { getUniqId, encodeFilename } from '#/common';
import { METABLOCK_RE } from '#/common/consts';
import { mapEntry } from '#/common/object';
import { commands } from './message';
import { getOption } from './options';
import cache from './cache';

Object.assign(commands, {
  /** @return {string} */
  CacheNewScript(data) {
    const id = getUniqId();
    cache.put(`new-${id}`, newScript(data));
    return id;
  },
  /** @return {VMScript} */
  NewScript(id) {
    return id && cache.get(`new-${id}`) || newScript();
  },
  ParseMeta: parseMeta,
});

export function isUserScript(text) {
  if (/^\s*</.test(text)) return false; // HTML
  if (text.indexOf('// ==UserScript==') < 0) return false; // Lack of meta block
  return true;
}

const arrayType = {
  default: () => [],
  transform: (res, val) => {
    res.push(val);
    return res;
  },
};
const defaultType = {
  default: () => null,
  transform: (res, val) => (res == null ? val : res),
};
const metaTypes = {
  include: arrayType,
  exclude: arrayType,
  match: arrayType,
  excludeMatch: arrayType,
  require: arrayType,
  resource: {
    default: () => ({}),
    transform: (res, val) => {
      const pair = val.match(/^(\w\S*)\s+(.*)/);
      if (pair) res[pair[1]] = pair[2];
      return res;
    },
  },
  grant: arrayType,
  noframes: {
    default: () => false,
    transform: () => true,
  },
};
const metaOptionalTypes = {
  antifeature: arrayType,
  compatible: arrayType,
  connect: arrayType,
};
export function parseMeta(code) {
  // initialize meta
  const meta = metaTypes::mapEntry(([, value]) => value.default());
  const metaBody = code.match(METABLOCK_RE)[1] || '';
  metaBody.replace(/(?:^|\n)\s*\/\/\x20(@\S+)(.*)/g, (_match, rawKey, rawValue) => {
    const [keyName, locale] = rawKey.slice(1).split(':');
    const camelKey = keyName.replace(/[-_](\w)/g, (m, g) => g.toUpperCase());
    const key = locale ? `${camelKey}:${locale.toLowerCase()}` : camelKey;
    const val = rawValue.trim();
    const metaType = metaTypes[key] || metaOptionalTypes[key] || defaultType;
    let oldValue = meta[key];
    if (typeof oldValue === 'undefined') oldValue = metaType.default();
    meta[key] = metaType.transform(oldValue, val);
  });
  meta.resources = meta.resource;
  delete meta.resource;
  // @homepageURL: compatible with @homepage
  if (!meta.homepageURL && meta.homepage) meta.homepageURL = meta.homepage;
  return meta;
}

export function getDefaultCustom() {
  return {
    origInclude: true,
    origExclude: true,
    origMatch: true,
    origExcludeMatch: true,
  };
}

export function newScript(data) {
  const state = {
    url: '*://*/*',
    name: '',
    date: new Date().toLocaleString(),
    ...data,
  };
  const code = getOption('scriptTemplate')
  .replace(/{{(\w+)}}/g, (str, name) => {
    const value = state[name];
    return value == null ? str : value;
  });
  const script = {
    custom: getDefaultCustom(),
    config: {
      enabled: 1,
      shouldUpdate: 1,
    },
    meta: parseMeta(code),
  };
  return { script, code };
}

export function getNameURI(script) {
  const ns = script.meta.namespace || '';
  const name = script.meta.name || '';
  let nameURI = encodeFilename(`${ns}\n${name}\n`);
  if (!ns && !name) nameURI += script.props.id || '';
  return nameURI;
}
