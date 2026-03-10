import { addPublicCommands } from './init';
import { getOption } from './options';
import { FIREFOX } from './ua';
import { vetUrl } from './url';
import { getScriptById } from './db';
import { testScript } from './tester';

function getCookieUrl(data, src, fallbackToSrcUrl) {
  const { url, domain, scriptId } = data;
  const script = scriptId && getScriptById(scriptId);
  if (!script) throw new Error('Script not found');

  let targetUrl = url;
  if (!url && (!domain || fallbackToSrcUrl)) {
    targetUrl = src.url;
  }
  if (targetUrl) {
    targetUrl = vetUrl(targetUrl, src.url, true);
    if (!testScript(targetUrl, script)) {
      throw new Error('No permission for requested URL');
    }
  } else if (domain) {
    const checkUrl = `https://${domain.replace(/^\./, '')}/`;
    if (!testScript(checkUrl, script)) {
      throw new Error('No permission for requested domain');
    }
  }
  return targetUrl;
}

addPublicCommands({
  /**
   * @param {Object} data
   * @param {VMMessageSender} src
   * @return {Promise<browser.cookies.Cookie[]>}
   */
  async CookieList(data, src) {
    const httpOnly = getOption('enableHttpOnlyCookie');
    const { name, domain, path, secure, session, storeId } = data;
    const targetUrl = getCookieUrl(data, src, false);
    const opts = {
      url: targetUrl,
      name,
      domain,
      path,
      secure,
      session,
      storeId: storeId || src.tab?.cookieStoreId,
      ...FIREFOX >= 59 && { firstPartyDomain: null },
    };
    // Filter out httpOnly cookies if not enabled
    let cookies = await browser.cookies.getAll(opts);
    if (!httpOnly) {
      cookies = cookies.filter(c => !c.httpOnly);
    }
    return cookies;
  },

  /**
   * @param {Object} data
   * @param {VMMessageSender} src
   * @return {Promise<browser.cookies.Cookie|undefined>}
   */
  async CookieSet(data, src) {
    const httpOnly = getOption('enableHttpOnlyCookie');
    if (!httpOnly && data.httpOnly) {
      throw new Error('HTTP-only not allowed by user settings');
    }
    const {
      name,
      value,
      domain,
      path,
      secure,
      httpOnly: isHttpOnly,
      expirationDate,
      sameSite,
      storeId,
    } = data;
    const targetUrl = getCookieUrl(data, src, true);
    if (!targetUrl) {
      throw new Error('Invalid URL for cookie');
    }
    return browser.cookies.set({
      url: targetUrl,
      name,
      value,
      domain,
      path,
      secure: secure ?? targetUrl.startsWith('https:'),
      httpOnly: isHttpOnly ?? httpOnly,
      expirationDate,
      sameSite,
      storeId: storeId || src.tab?.cookieStoreId,
    });
  },

  /**
   * @param {Object} data
   * @param {VMMessageSender} src
   * @return {Promise<boolean>}
   */
  async CookieDelete(data, src) {
    const { name, storeId } = data;
    const targetUrl = getCookieUrl(data, src, true);
    return browser.cookies.remove({
      url: targetUrl,
      name,
      storeId: storeId || src.tab?.cookieStoreId,
      ...FIREFOX >= 59 && { firstPartyDomain: null },
    }).then(removed => !!removed);
  },
});
