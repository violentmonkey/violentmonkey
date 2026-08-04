import {
  encodeFilename, getFullUrl, getScriptHome, getScriptSupportUrl, getTab, i18n,
} from '@/common';
import {
  __CODE, GLOB_ALL, HOMEPAGE_URL, INFERRED, kOrigTag, kTag, METABLOCK_RE, SUPPORT_URL, TL_AWAIT,
  UNWRAP,
} from '@/common/consts';
import { formatDate } from '@/common/date';
import { mapEntry } from '@/common/object';
import defaults, { kScriptTemplate } from '@/common/options-defaults';
import broadcast from './broadcast';
import { addOwnCommands, commands } from './init';
import { getOption, hookOptionsInit } from './options';
import storage, { S_MOD_PRE, S_SCRIPT_PRE } from './storage';
import { injectableRe } from './tabs';

addOwnCommands({
  async NewScript({ code, tabId }) {
    if (code) return newScriptFromCode(code);
    const tab = tabId >= 0 && await getTab(tabId) || {};
    const tabUrl = tab.url;
    const url = injectableRe.test(tabUrl) && `${tabUrl.split(/[#?]/)[0]}*`;
    const { host = 'example.org', domain } = url ? commands.GetTabDomain(url) : {};
    return newScript({
      url: url || `*://${host}/*`,
      name: domain || '',
      icon: tab.favIconUrl || '',
    });
  },
});

hookOptionsInit((changes, firstRun) => {
  if (!firstRun && kScriptTemplate in changes) {
    const errors = [];
    const tpl = changes[kScriptTemplate];
    const meta = !tpl /*empty = default*/ || parseMeta(tpl, { errors });
    if (!meta) errors.unshift(i18n('msgInvalidScript'));
    if (errors.length) throw errors;
  }
});

/** @type {{ [id: string]: VMScript }} */
export const scriptMap = {};
/** @type {{ [id: string]: number }} */
export const scriptSiteVisited = {};
/** @type {VMScript[]} */
export const aliveScripts = [];
/** @type {VMScript[]} */
export const removedScripts = [];
/** @return {boolean|?RegExpExecArray} */
export const matchUserScript = text => !/^\s*</.test(text) /*HTML*/ && METABLOCK_RE.exec(text);

const arrayType = {
  default: () => [],
  transform: (res, val) => {
    res.push(val);
    return res;
  },
};
const booleanType = {
  default: () => false,
  transform: () => true,
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
};
const metaOptionalTypes = {
  antifeature: arrayType,
  compatible: arrayType,
  connect: arrayType,
  noframes: booleanType,
  [kTag]: arrayType,
  [TL_AWAIT]: booleanType,
  [UNWRAP]: booleanType,
};
/**                   0         1       2          3     4 */
const META_ITEM_RE = /(?:^|\n)(.*?)\/\/([\x20\t]*)(@\S+)(.*)/g;
export const ERR_META_SPACE_BEFORE = 'Unexpected text before "//" in ';
export const ERR_META_SPACE_INSIDE = 'Expected a single space after "//" in ';

/**
 * @param {string} code
 * @param {object} [opts]
 * @param {Array} [opts.errors] - to collect errors
 * @param {boolean} [opts.retDefault] - returns the default empty meta if no meta is found
 * @param {boolean} [opts.retMetaStr] - adds the matched part as [__CODE] prop in result
 * @return {VMScript['meta'] | false}
 */
export function parseMeta(code, { errors, retDefault, retMetaStr } = {}) {
  // initialize meta
  const meta = metaTypes::mapEntry(value => value.default());
  const match = matchUserScript(code);
  if (!match) return retDefault ? meta : false;
  // TODO: use `null` instead of `false` + null check in all callers?
  if (errors) checkMetaItemErrors(match, 1, errors);
  let parts;
  while ((parts = META_ITEM_RE.exec(match[4]))) {
    const [keyName, locale] = parts[3].slice(1).split(':');
    const camelKey = keyName.replace(/[-_](\w)/g, (m, g) => g.toUpperCase());
    const key = locale ? `${camelKey}:${locale.toLowerCase()}` : camelKey;
    const val = parts[4].trim();
    const metaType = metaTypes[key] || metaOptionalTypes[key] || defaultType;
    let oldValue = meta[key];
    if (typeof oldValue === 'undefined') oldValue = metaType.default();
    if (errors) checkMetaItemErrors(parts, 0, errors);
    meta[key] = metaType.transform(oldValue, val);
  }
  if (errors) checkMetaItemErrors(match, 5, errors);
  meta.resources = meta.resource;
  delete meta.resource;
  if (retMetaStr) meta[__CODE] = match[0];
  return meta;
}

/** Standard alignment used by our default script template, e.g. `// @match       `. */
const MATCH_LINE_RE = /^([^\n]*?\/\/[\x20\t]*@match\b[\x20\t]*)(.+)$/;
const MATCH_LINE_PREFIX = '// @match        ';

/**
 * Completes a bare domain/host into a full `@match` pattern, e.g.
 * `example.com` -> `*://example.com/*`, `*.example.com` -> `*://*.example.com/*`.
 * Already-complete patterns (containing `://` and a path) are returned unchanged.
 * @param {string} raw
 * @return {string} empty string if `raw` is empty/whitespace
 */
export function wrapMatchPattern(raw) {
  let p = (raw || '').trim();
  if (!p) return '';
  if (!/:\/\//.test(p)) p = `*://${p}`;
  const after = p.slice(p.indexOf('://') + 3);
  if (!after.includes('/')) p += '/*';
  return p;
}

/**
 * A bare host typed as shorthand (no scheme, no wildcard of its own) defaults to the
 * wildcard-subdomain form, same as the popup/list-UI add-domain box: `y.com` -> `*.y.com`.
 * Anything that already has a scheme or a `*` in it (incl. a leading `*.`) is left alone.
 * @param {string} piece
 * @return {string}
 */
function defaultShorthandToSubdomain(piece) {
  return /:\/\/|\*/.test(piece) ? piece : `*.${piece}`;
}

/**
 * Expands shorthand `@match` directives at save time so mobile users can type
 * `// @match example.com,xyz.*` instead of fiddling with `*://.../*` boilerplate.
 * - splits comma-separated values into one `@match` line per pattern
 * - a bare host defaults to the wildcard-subdomain form (see `defaultShorthandToSubdomain`)
 * - completes each piece via `wrapMatchPattern`
 * - leaves already-valid single-pattern lines untouched (no-op, preserves formatting)
 * Only affects `@match`; not used by the programmatic "add domain" features,
 * which already write a single fully-qualified pattern per call.
 * @param {string} code
 * @return {string}
 */
export function expandMatchShorthand(code) {
  const meta = matchUserScript(code);
  if (!meta) return code;
  const body = meta[4];
  const bodyStart = meta.index + meta[1].length;
  let changed = false;
  const outLines = body.split('\n').map(line => {
    const m = MATCH_LINE_RE.exec(line);
    if (!m) return line;
    const prefix = m[1];
    const pieces = m[2].split(',').map(s => s.trim()).filter(Boolean);
    if (!pieces.length) return line;
    const wrapped = pieces.map(p => wrapMatchPattern(defaultShorthandToSubdomain(p)));
    if (wrapped.length === 1 && wrapped[0] === pieces[0]) return line;
    changed = true;
    return wrapped.map(w => prefix + w).join('\n');
  });
  if (!changed) return code;
  const newBody = outLines.join('\n');
  return code.slice(0, bodyStart) + newBody + code.slice(bodyStart + body.length);
}

/**
 * Inserts a new `@match` line (right after the last existing one) into a script's code.
 * Skips the insertion if an identical pattern already exists.
 * @param {string} code
 * @param {string} pattern - already-complete, e.g. from `wrapMatchPattern`
 * @return {{ code: string, added: boolean, duplicate: boolean }}
 */
export function insertMatchLine(code, pattern) {
  const meta = matchUserScript(code);
  if (!meta || !pattern) return { code, added: false, duplicate: false };
  const body = meta[4];
  const bodyStart = meta.index + meta[1].length;
  const lineRe = /^[^\n]*?\/\/[\x20\t]*@match\b[\x20\t]*(.+)$/;
  const lines = body.split('\n');
  let lastIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lineRe.exec(lines[i]);
    if (m) {
      if (m[1].trim() === pattern) return { code, added: false, duplicate: true };
      lastIdx = i;
    }
  }
  const newLine = MATCH_LINE_PREFIX + pattern;
  if (lastIdx < 0) {
    lines.unshift(newLine, '');
  } else {
    lines.splice(lastIdx + 1, 0, newLine);
  }
  const newBody = lines.join('\n');
  return {
    code: code.slice(0, bodyStart) + newBody + code.slice(bodyStart + body.length),
    added: true,
    duplicate: false,
  };
}

function checkMetaItemErrors(parts, index, errors) {
  let clipped;
  if (parts[index + 1].match(/\S/)) {
    errors.push(ERR_META_SPACE_BEFORE + (clipped = clipString(parts[index], 50)));
  }
  if (parts[index + 2] !== ' ') {
    errors.push(ERR_META_SPACE_INSIDE + (clipped || clipString(parts[index], 50)));
  }
}

function clipString(line, maxLen) {
  line = line.trim();
  return JSON.stringify(line.length > maxLen ? line.slice(0, maxLen) + '...' : line);
}

export function getDefaultCustom() {
  return {
    origInclude: true,
    origExclude: true,
    origMatch: true,
    origExcludeMatch: true,
    [kOrigTag]: true,
  };
}

/** @return {VMScript & { code?: string }} */
export function newScript(data) {
  const state = {
    url: GLOB_ALL,
    name: '',
    ...data,
  };
  const code = (getOption(kScriptTemplate) || defaults[kScriptTemplate])
  .replace(/{{(\w+)(?::(.+?))?}}/g, (str, name, format) => state[name] ?? (
    name !== 'date' ? str
      : format ? formatDate(format)
        : new Date().toLocaleString()
  ));
  const script = newScriptFromCode(code);
  if (data) script.code = code;
  return script;
}

/** @return {VMScript} */
function newScriptFromCode(code) {
  return {
    custom: getDefaultCustom(),
    config: {
      enabled: 1,
      shouldUpdate: 1,
    },
    meta: parseMeta(code, { retDefault: true }),
    props: {},
  };
}

export function getNameURI(script) {
  const ns = script.meta.namespace || '';
  const name = script.meta.name || '';
  let nameURI = encodeFilename(`${ns}\n${name}\n`);
  if (!ns && !name) nameURI += script.props.id || '';
  return nameURI;
}

/**
 * @param {VMScript} script
 * @returns {string | undefined}
 */
function inferScriptHome(script) {
  let u = script.custom.lastInstallURL;
  if (u) {
    u = u.split('/', 6);
    switch (u[2]) {
    case 'update.greasyfork.org':
    case 'update.sleazyfork.org':
      u[2] = u[2].slice(7);
      // fallthrough
    case 'greasyfork.org':
    case 'sleazyfork.org':
      if (u[3] !== 'scripts') u.splice(3, 1);
      break;
    case 'raw.githubusercontent.com':
      u[2] = 'github.com';
      break;
    case 'github.com':
      break;
    case 'openuserjs.org':
      u[3] = 'scripts';
      u[4] = u[4].replace(/(\.min)?\.user\.js$/, '');
      break;
    default:
      u = false;
    }
    if (u) {
      u.length = 5; // scheme + 1 + host + group + name
      u = u.join('/');
    }
  }
  if (!u) {
    u = script.meta.namespace;
    u = /^https?:\/\/(?!tampermonkey\.net\/)/.test(u)
      && getFullUrl(u).replace(/^https?(:\/\/userscripts)(\.org\/users\/\w)/, 'https$1-mirror$2');
  }
  return u;
}

/**
 * @param {VMScript} script
 * @param {string} [home]
 * @returns {string | undefined}
 */
function inferScriptSupportUrl(script, home = getScriptHome(script)) {
  let u = home && home.match(regex('i')`
    ^https://(
      (
        (?<GF>greas|sleaz)yfork\.(org|cc)(/(?!scripts)[^\/]+)? |
        openuserjs\.org
      )(?=/scripts/) |
      github\.com
    )/[^\/]+/[^\/]+`);
  if (u) {
    return `${u[0]}/${u.groups.GF ? 'feedback' : 'issues'}`;
  }
}

/** @param {VMScript} script */
export function inferScriptProps(script) {
  const data = script[INFERRED] ??= {};
  const home = data[HOMEPAGE_URL] ??= getScriptHome(script) || inferScriptHome(script);
  data[SUPPORT_URL] ??= !getScriptSupportUrl(script) && inferScriptSupportUrl(script, home);
  data.visit = scriptSiteVisited[script.props.id];
}

/**
 * @param {VMInjection.Script[] | number[]} arr
 * @param {boolean} [isIds]
 */
export function updateVisitedTime(arr, isIds) {
  const now = Date.now();
  const toBroadcast = {};
  const toWrite = {};
  for (let v of arr) {
    if (!isIds) v = v.id;
    scriptSiteVisited[v] = toBroadcast[v] = toWrite[S_MOD_PRE + v] = now;
  }
  broadcast('Visited', toBroadcast);
  storage.api.set(toWrite);
}

/** `key` must be already verified to start with S_SCRIPT_PRE */
export function updateScriptMap(key, val) {
  if ((key = +key.slice(S_SCRIPT_PRE.length))) {
    if (val) {
      const oldScript = scriptMap[key];
      if (oldScript) {
        const i1 = aliveScripts.indexOf(oldScript);
        const i2 = removedScripts.indexOf(oldScript);
        if (i1 >= 0) aliveScripts[i1] = val;
        if (i2 >= 0) removedScripts[i2] = val;
        val[INFERRED] ??= oldScript[INFERRED];
      }
      scriptMap[key] = val;
    } else {
      delete scriptMap[key];
    }
    return true;
  }
}
