const metaStart = '==UserScript==';
const metaEnd = '==/UserScript==';

export function isUserScript(text) {
  if (/^\s*</.test(text)) return false; // HTML
  if (text.indexOf(metaStart) < 0) return false; // Lack of meta block
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
export function parseMeta(code) {
  // initialize meta
  const meta = Object.keys(metaTypes)
  .reduce((res, key) => Object.assign(res, {
    [key]: metaTypes[key].default(),
  }), {});
  let flag = -1;
  code.replace(/(?:^|\n)\/\/\s*([@=]\S+)(.*)/g, (_match, group1, group2) => {
    if (flag < 0 && group1 === metaStart) {
      // start meta
      flag = 1;
    } else if (flag > 0 && group1 === metaEnd) {
      // end meta
      flag = 0;
    }
    if (flag === 1 && group1[0] === '@') {
      const [keyName, locale] = group1.slice(1).split(':');
      const camelKey = keyName.replace(/[-_](\w)/g, (m, g) => g.toUpperCase());
      const key = locale ? `${camelKey}:${locale.toLowerCase()}` : camelKey;
      const val = group2.trim();
      const metaType = metaTypes[key] || defaultType;
      let oldValue = meta[key];
      if (typeof oldValue === 'undefined') oldValue = metaType.default();
      meta[key] = metaType.transform(oldValue, val);
    }
  });
  meta.resources = meta.resource;
  delete meta.resource;
  // @homepageURL: compatible with @homepage
  if (!meta.homepageURL && meta.homepage) meta.homepageURL = meta.homepage;
  return meta;
}

export function newScript() {
  const code = `\
// ==UserScript==
// @name New Script
// @namespace Violentmonkey Scripts
// @match *://*/*
// @grant none
// ==/UserScript==
`;
  const script = {
    custom: {
      origInclude: true,
      origExclude: true,
      origMatch: true,
      origExcludeMatch: true,
    },
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
  let nameURI = `${escape(ns)}:${escape(name)}:`;
  if (!ns && !name) nameURI += script.props.id || '';
  return nameURI;
}

export function compareVersion(ver1, ver2) {
  const parts1 = (ver1 || '').split('.');
  const parts2 = (ver2 || '').split('.');
  for (let i = 0; i < parts1.length || i < parts2.length; i += 1) {
    const delta = (parseInt(parts1[i], 10) || 0) - (parseInt(parts2[i], 10) || 0);
    if (delta) return delta < 0 ? -1 : 1;
  }
  return 0;
}
