import { isValidHttpUrl, keepAlive } from '@/common';
import browser from '@/common/browser';
import { NO_CACHE } from '@/common/consts';
import { getScript, getScriptsByIdsOrAll, parseScript, updateScriptInfo } from './db';
import { inIncognitoContext, init } from './init';
import { parseMeta } from './script';
import { requestNewer } from './storage-fetch';

const browserManaged = browser.storage.managed;

if (browserManaged && !inIncognitoContext) {
  let controller;
  let policyTask = Promise.resolve();
  let revision = 0;

  const applyScriptPolicy = () => {
    const currentRevision = ++revision;
    // Abort old downloads and serialize batches; revision also rejects stale results.
    controller?.abort();
    policyTask = policyTask
      .then(() => installScripts(currentRevision))
      .catch(console.warn);
    return __.MV3 ? keepAlive(policyTask) : policyTask;
  };

  const rememberPolicyUrl = (script, url) => {
    const urls = script.custom.policyUrls || [];
    if (!urls.includes(url)) return updateScriptInfo(script.props.id, {
      custom: { policyUrls: [...urls, url] },
    });
  };

  const installScripts = async currentRevision => {
    if (init) await init;
    if (currentRevision !== revision) return;
    let scriptUrls;
    try {
      ({ scriptUrls } = await browserManaged.get('scriptUrls'));
    } catch {
      return;
    }
    if (currentRevision !== revision || scriptUrls == null) return;
    if (!Array.isArray(scriptUrls)) {
      console.warn('Invalid userscript policy: scriptUrls must be an array of URLs');
      return;
    }
    let installedScripts;
    controller = new AbortController();
    await Promise.all([...new Set(scriptUrls)].map(async entry => {
      const url = typeof entry === 'string' && isValidHttpUrl(entry);
      if (!url) {
        console.warn('Invalid userscript policy URL:', entry);
        return;
      }
      // Include the recycle bin so policy refreshes respect a user's removal
      installedScripts ||= new Map(getScriptsByIdsOrAll().map(s => [s.custom.lastInstallURL, s]));
      try {
        const installed = installedScripts.get(url);
        if (installed) return await rememberPolicyUrl(installed, url);
        const { data: code } = await requestNewer(url, { ...NO_CACHE, signal: controller.signal });
        if (currentRevision !== revision) return;
        const meta = typeof code === 'string' && parseMeta(code);
        if (!meta?.name) throw new Error('Invalid userscript: missing @name');
        // Also preserve matching scripts installed from another URL or during the download.
        const script = getScript({ meta }) || getScript({ meta, removed: true });
        if (script) return await rememberPolicyUrl(script, url);
        await parseScript({ code, url, isNew: true, bumpDate: true, custom: { policyUrls: [url] } });
      } catch (err) {
        if (currentRevision === revision) {
          console.warn('Failed to install userscript from policy:', url, err);
        }
      }
    }));
  };

  // Register synchronously so policy changes can wake the MV3 worker.
  if (!IS_FIREFOX) browserManaged.onChanged.addListener(changes => {
    if ('scriptUrls' in changes) return applyScriptPolicy();
  });
  applyScriptPolicy();
}
