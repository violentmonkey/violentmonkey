import {
  encodeFilename, getFullUrl, getScriptHome, getScriptSupportUrl, i18n, noop,
} from '@/common';
import {
  __CODE, HOMEPAGE_URL, INFERRED, METABLOCK_RE, SUPPORT_URL, TL_AWAIT, UNWRAP,
} from '@/common/consts';
import { formatDate } from '@/common/date';
import { mapEntry } from '@/common/object';
import defaults, { kScriptTemplate } from '@/common/options-defaults';
import { addOwnCommands, commands } from './init';
import { getOption, hookOptionsInit } from './options';
import { injectableRe } from './tabs';

addOwnCommands({
  async NewScript(tabId) {
    const tabUrl = (tabId >= 0 && await browser.tabs.get(tabId).catch(noop) || {}).url;
    const url = injectableRe.test(tabUrl) && `${tabUrl.split(/[#?]/)[0]}*`;
    const { host = 'example.org', domain } = url ? commands.GetTabDomain(url) : {};
    return newScript({
      url: url || `*://${host}/*`,
      name: domain || '',
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
 * @return {VMScript.Meta | false}
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
  };
}

export function newScript(data) {
  const state = {
    url: '*://*/*',
    name: '',
    ...data,
  };
  const code = (getOption(kScriptTemplate) || defaults[kScriptTemplate])
  .replace(/{{(\w+)(?::(.+?))?}}/g, (str, name, format) => state[name] ?? (
    name !== 'date' ? str
      : format ? formatDate(format)
        : new Date().toLocaleString()
  ));
  const script = {
    custom: getDefaultCustom(),
    config: {
      enabled: 1,
      shouldUpdate: 1,
    },
    meta: parseMeta(code, { retDefault: true }),
    props: {},
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
  let u = home && home.match(re`/
    ^https:\/\/(?:
      (?:
        (greas|sleaz)yfork\.org(?:\/(?!scripts)[^/]+)? |
        openuserjs\.org
      )(?=\/scripts\/) |
      github\.com
    )\/[^/]+\/[^/]+/x`);
  if (u) {
    return `${u[0]}/${u[1] ? 'feedback' : 'issues'}`;
  }
}

export function inferScriptProps(script) {
  if (!script || hasOwnProperty(script, INFERRED)) {
    return;
  }
  let url, res;
  if (!(url = getScriptHome(script)) && (url = inferScriptHome(script))) {
    (res || (res = {}))[HOMEPAGE_URL] = url;
  }
  if (!getScriptSupportUrl(script) && (url = inferScriptSupportUrl(script, url))) {
    (res || (res = {}))[SUPPORT_URL] = url;
  }
  script[INFERRED] = res;
  // Setting the key when failed to `undefined` makes it detectable via hasOwnProperty above
}
