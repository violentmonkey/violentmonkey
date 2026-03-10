import { kGmCookieHttpOnly } from '@/common/options-defaults';
import { addPublicCommands } from './init';
import { getOption } from './options';
import { scriptMap } from './script';
import { testScript } from './tester';
import { FIREFOX } from './ua';
import { vetUrl } from './url';

const MUST_MATCH = `Script must match/include `;
const FIRST_PARTY = FIREFOX >= 59 && { firstPartyDomain: null };
const KEYS_DELETE = ['name'];
const KEYS_LIST = ['name', 'domain', 'path', 'secure', 'session'];
const KEYS_SET = ['name', 'domain', 'path', 'value', 'expirationDate', 'sameSite'];

addPublicCommands({
  /**
   * @param {browser.cookies._GetAllDetails} data
   * @param {VMMessageSender} src
   * @return {Promise<browser.cookies.Cookie[]>}
   */
  async CookieList(data, src) {
    const [opts, httpOnlyEnabled] = getCookieOpts(data, src, KEYS_LIST, FIRST_PARTY);
    const res = await browser.cookies.getAll(opts);
    return httpOnlyEnabled
      ? res
      : res.filter(c => !c.httpOnly);
  },

  /**
   * @param {browser.cookies._SetDetails} data
   * @param {VMMessageSender} src
   */
  async CookieSet(data, src) {
    const { httpOnly } = data;
    const [opts, httpOnlyEnabled] = getCookieOpts(data, src, KEYS_SET, null, true);
    const { url } = opts;
    if (!url) {
      throw 'Invalid URL for cookie';
    }
    if (httpOnly && !httpOnlyEnabled) {
      throw 'HTTP-only cookie access is not allowed in settings';
    }
    opts.secure = data.secure ?? url.startsWith('https:');
    opts.httpOnly = httpOnly ?? false;
    await browser.cookies.set(opts);
  },

  /**
   * @param {browser.cookies._RemoveDetails} data
   * @param {VMMessageSender} src
   */
  async CookieDelete(data, src) {
    const [opts] = getCookieOpts(data, src, KEYS_DELETE, FIRST_PARTY);
    await browser.cookies.remove(opts);
  },
});

/**
 * @template T
 * @param {T} data
 * @param {VMMessageSender} src
 * @param {string[]} keys
 * @param {Object} [firstParty]
 * @param {boolean} [fallbackToSrcUrl]
 * @return {[T, boolean]}
 */
function getCookieOpts(data, src, keys, firstParty, fallbackToSrcUrl) {
  const { url, domain, scriptId } = data;
  const script = scriptMap[scriptId];
  if (!script) {
    throw `Script #${scriptId} not found`;
  }
  let targetUrl = url;
  if (!url && (!domain || fallbackToSrcUrl)) {
    targetUrl = src.url;
  }
  if (targetUrl) {
    targetUrl = vetUrl(targetUrl, src.url, true);
    if (!testScript(targetUrl, script)) {
      throw MUST_MATCH + targetUrl;
    }
  } else if (domain) {
    const checkUrl = `https://${domain.replace(/^\./, '')}/`;
    if (!testScript(checkUrl, script)) {
      throw MUST_MATCH + checkUrl;
    }
  }
  const res = {...firstParty};
  for (const k of keys) res[k] = data[k];
  res.storeId = data.storeId || src.tab?.cookieStoreId;
  res.url = targetUrl;
  return [
    res,
    keys !== KEYS_DELETE && (script.config.httpOnly && getOption(kGmCookieHttpOnly)),
  ];
}
