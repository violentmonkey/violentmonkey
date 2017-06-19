export { isRemote } from 'src/common';

const metaStart = '==UserScript==';
const metaEnd = '==/UserScript==';

export function isUserScript(text) {
  if (/^\s*</.test(text)) return false; // HTML
  if (text.indexOf(metaStart) < 0) return false; // Lack of meta block
  return true;
}

export function parseMeta(code) {
  // initialize meta, specify those with multiple values allowed
  const meta = {
    include: [],
    exclude: [],
    match: [],
    excludeMatch: [],
    require: [],
    resource: [],
    grant: [],
  };
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
      const data = meta[key];
      // multiple values allowed
      if (data && data.push) data.push(val);
      // only first value will be stored
      else if (!(key in meta)) meta[key] = val;
    }
  });
  meta.resources = {};
  meta.resource.forEach(line => {
    const pair = line.match(/^(\w\S*)\s+(.*)/);
    if (pair) meta.resources[pair[1]] = pair[2];
  });
  delete meta.resource;
  // @homepageURL: compatible with @homepage
  if (!meta.homepageURL && meta.homepage) meta.homepageURL = meta.homepage;
  return meta;
}

export function newScript() {
  const script = {
    custom: {
      origInclude: true,
      origExclude: true,
      origMatch: true,
      origExcludeMatch: true,
    },
    enabled: 1,
    update: 1,
    code: `\
// ==UserScript==
// @name New Script
// @namespace Violentmonkey Scripts
// @match *://*/*
// @grant none
// ==/UserScript==
`,
  };
  script.meta = parseMeta(script.code);
  return script;
}

export function getScriptInfo(script) {
  return {
    id: script.id,
    custom: script.custom,
    meta: script.meta,
    enabled: script.enabled,
    update: script.update,
  };
}

export function getNameURI(script) {
  const ns = script.meta.namespace || '';
  const name = script.meta.name || '';
  let nameURI = `${escape(ns)}:${escape(name)}:`;
  if (!ns && !name) nameURI += script.id || '';
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
