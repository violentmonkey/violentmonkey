import { isValidHttpUrl, keepAlive } from '@/common';
import browser from '@/common/browser';
import { NO_CACHE } from '@/common/consts';
import { getScript, getScriptsByIdsOrAll, parseScript } from './db';
import { inIncognitoContext, init } from './init';
import { parseMeta } from './script';
import { request } from './url';

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

  const installScripts = async currentRevision => {
    if (init) await init;
    if (currentRevision !== revision) return;
    let scripts;
    try {
      ({ scripts } = await browserManaged.get('scripts'));
    } catch {
      return;
    }
    if (currentRevision !== revision || scripts == null) return;
    if (!Array.isArray(scripts)) {
      console.warn('Invalid userscript policy: scripts must be an array of URLs');
      return;
    }
    // Include the recycle bin so policy refreshes respect a user's removal.
    const installedUrls = new Set(getScriptsByIdsOrAll().map(s => s.custom.lastInstallURL));
    controller = new AbortController();
    await Promise.all([...new Set(scripts)].map(async entry => {
      const url = typeof entry === 'string' && isValidHttpUrl(entry);
      if (!url) {
        console.warn('Invalid userscript policy URL:', entry);
        return;
      }
      if (installedUrls.has(url)) return;
      try {
        const { data: code } = await request(url, { ...NO_CACHE, signal: controller.signal });
        if (currentRevision !== revision) return;
        const meta = typeof code === 'string' && parseMeta(code);
        if (!meta?.name) throw new Error('Invalid userscript: missing @name');
        // Also preserve matching scripts installed from another URL or during the download.
        if (getScript({ meta }) || getScript({ meta, removed: true })) return;
        await parseScript({ code, url, isNew: true, bumpDate: true });
      } catch (err) {
        if (currentRevision === revision) {
          console.warn('Failed to install userscript from policy:', url, err);
        }
      }
    }));
  };

  // Register synchronously so policy changes can wake the MV3 worker.
  if (!IS_FIREFOX) browserManaged.onChanged.addListener(changes => {
    if ('scripts' in changes) return applyScriptPolicy();
  });
  applyScriptPolicy();
}
