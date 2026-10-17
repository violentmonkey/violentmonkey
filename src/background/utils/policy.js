import { isValidHttpUrl, keepAlive } from '@/common';
import browser from '@/common/browser';
import { NO_CACHE } from '@/common/consts';
import { getScript, getScriptsByIdsOrAll, parseScript } from './db';
import { inIncognitoContext, init } from './init';
import { parseMeta } from './script';
import { request } from './url';

const managed = browser.storage.managed;
let policyTask = Promise.resolve();
let revision = 0;

if (managed && !inIncognitoContext) {
  // async so mv3 can wake the worker first
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'managed' && 'scripts' in changes) return applyScriptPolicy();
  });
  applyScriptPolicy();
}

export function applyScriptPolicy() {
  const currentRevision = ++revision;
  // always read latest via this method!
  policyTask = policyTask
    .then(() => installScripts(currentRevision))
    .catch(console.warn);
  return __.MV3 ? keepAlive(policyTask) : policyTask;
}

async function installScripts(currentRevision) {
  if (init) await init;
  if (!managed || inIncognitoContext || currentRevision !== revision) return;
  let scripts;
  try {
    ({ scripts } = await managed.get('scripts'));
  } catch {
    return;
  }
  if (scripts == null) return;
  if (!Array.isArray(scripts)) {
    console.warn('Invalid userscript policy: scripts must be an array of URLs');
    return;
  }
  for (const entry of new Set(scripts)) {
    if (currentRevision !== revision) return;
    const url = typeof entry === 'string' && isValidHttpUrl(entry);
    if (!url) {
      console.warn('Invalid userscript policy URL:', entry);
      continue;
    }
    // policy refresh respects a user's removal.
    if (getScriptsByIdsOrAll().some(script => script.custom.lastInstallURL === url)) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30e3);
    try {
      const { data: code } = await request(url, { ...NO_CACHE, signal: controller.signal });
      if (currentRevision !== revision) return;
      const meta = typeof code === 'string' && parseMeta(code);
      if (!meta?.name) throw new Error('Invalid userscript: missing @name');
      // Also recognize scripts installed from another URL, including manual installs made while the policy download was in flight. Never overwrite their code/settings.
      if (getScript({ meta }) || getScript({ meta, removed: true })) continue;
      await parseScript({ code, url, isNew: true, bumpDate: true });
    } catch (err) {
      console.warn('Failed to install userscript from policy:', url, err);
    } finally {
      clearTimeout(timer);
    }
  }
}
