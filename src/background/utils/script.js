import {
  encodeFilename, getFullUrl, getScriptHome, getScriptSupportUrl, noop,
} from '@/common';
import {
  __CODE, TL_AWAIT, UNWRAP,
  HOMEPAGE_URL, INFERRED, METABLOCK_RE, SUPPORT_URL, USERSCRIPT_META_INTRO,
} from '@/common/consts';
import { formatDate } from '@/common/date';
import { mapEntry } from '@/common/object';
import { addOwnCommands, commands } from './init';
import { getOption } from './options';
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

export function isUserScript(text) {
  if (/^\s*</.test(text)) return false; // HTML
  if (text.indexOf(USERSCRIPT_META_INTRO) < 0) return false; // Lack of meta block
  return true;
}

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
export function parseMeta(code, includeMatchedString) {
  // initialize meta
  const meta = metaTypes::mapEntry(value => value.default());
  const match = code.match(METABLOCK_RE);
  const metaBody = match[2];
  if (!metaBody) return false; // TODO: `return;` + null check in all callers?
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
  if (includeMatchedString) meta[__CODE] = match[0];
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
    ...data,
  };
  const code = getOption('scriptTemplate')
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
    meta: parseMeta(code),
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
