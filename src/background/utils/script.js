export function isRemote(url) {
  return url && !(/^(file|data):/.test(url));
}

export function parseMeta(code) {
  // initialize meta, specify those with multiple values allowed
  const meta = {
    include: [],
    exclude: [],
    match: [],
    require: [],
    resource: [],
    grant: [],
  };
  let flag = -1;
  code.replace(/(?:^|\n)\/\/\s*([@=]\S+)(.*)/g, (_match, group1, group2) => {
    if (flag < 0 && group1 === '==UserScript==') {
      // start meta
      flag = 1;
    } else if (flag > 0 && group1 === '==/UserScript==') {
      // end meta
      flag = 0;
    }
    if (flag === 1 && group1[0] === '@') {
      const key = group1.slice(1);
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
    custom: {},
    enabled: 1,
    update: 1,
    code: '// ==UserScript==\n// @name New Script\n// @namespace Violentmonkey Scripts\n// @grant none\n// ==/UserScript==\n',
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
    const delta = (parseInt(ver1[i], 10) || 0) - (parseInt(ver2[i], 10) || 0);
    if (delta) return delta < 0 ? -1 : 1;
  }
  return 0;
}
