import {
  compareVersion, getScriptName, getScriptUpdateUrl, i18n, sendCmd, trueJoin,
} from '@/common';
import { METABLOCK_RE } from '@/common/consts';
import limitConcurrency from '@/common/limit-concurrency';
import { fetchResources, getScriptById, getScripts, notifyToOpenScripts, parseScript } from './db';
import { parseMeta } from './script';
import { getOption, setOption } from './options';
import { addOwnCommands } from './message';
import { requestNewer } from './storage-fetch';

const processes = {};
const doCheckUpdateLimited = limitConcurrency(doCheckUpdate, 2, 250);

addOwnCommands({
  /**
   * @param {number} [id] - when omitted, all scripts are checked
   * @return {Promise<number>} number of updated scripts
   */
  async CheckUpdate(id) {
    const scripts = id ? [getScriptById(id)] : getScripts();
    const jobs = scripts.map(script => {
      const curId = script.props.id;
      const urls = getScriptUpdateUrl(script, true);
      return urls && (id || script.config.enabled || !getOption('updateEnabledScriptsOnly'))
        && (processes[curId] || (processes[curId] = doCheckUpdateLimited(script, urls)));
    }).filter(Boolean);
    const results = await Promise.all(jobs);
    const notes = results.filter(r => r?.text);
    if (notes.length) {
      notifyToOpenScripts(
        notes.some(n => n.err) ? i18n('msgOpenUpdateErrors') : i18n('optionUpdate'),
        notes.map(n => `* ${n.text}\n`).join(''),
        notes.map(n => n.script.props.id),
      );
    }
    if (!id) setOption('lastUpdate', Date.now());
    return results.reduce((num, r) => num + (r === true), 0);
  },
});

async function doCheckUpdate(script, urls) {
  const { id } = script.props;
  let res;
  let msgOk;
  let msgErr;
  let resourceOpts;
  try {
    const { update } = await parseScript({
      id,
      code: await downloadUpdate(script, urls),
      update: { checking: false },
    });
    msgOk = i18n('msgScriptUpdated', [getScriptName(update)]);
    resourceOpts = { cache: 'no-cache' };
    res = true;
  } catch (update) {
    msgErr = update.error;
    // Either proceed with normal fetch on no-update or skip it altogether on error
    resourceOpts = !update.error && !update.checking && {};
    if (process.env.DEBUG) console.error(update);
  } finally {
    if (resourceOpts) {
      msgErr = await fetchResources(script, null, resourceOpts);
      if (process.env.DEBUG && msgErr) console.error(msgErr);
    }
    if (canNotify(script) && (msgOk || msgErr)) {
      res = {
        script,
        text: [msgOk, msgErr]::trueJoin('\n'),
        err: !!msgErr,
      };
    }
    delete processes[id];
  }
  return res;
}

async function downloadUpdate(script, urls) {
  let errorMessage;
  const { meta, props: { id } } = script;
  const [downloadURL, updateURL] = urls;
  const update = {};
  const result = { update, where: { id } };
  announce(i18n('msgCheckingForUpdate'));
  try {
    const { data } = await requestNewer(updateURL, {
      cache: 'no-cache',
      // Smart servers like OUJS send a subset of the metablock without code
      headers: { Accept: 'text/x-userscript-meta,*/*' },
    }) || {};
    const { version } = data ? parseMeta(data) : {};
    if (compareVersion(meta.version, version) >= 0) {
      announce(i18n('msgNoUpdate'), { checking: false });
    } else if (!downloadURL) {
      announce(i18n('msgNewVersion'), { checking: false });
    } else if (downloadURL === updateURL && data?.replace(METABLOCK_RE, '').trim()) {
      // Code is present, so this is not a smart server, hence the response is the entire script
      announce(i18n('msgUpdated'));
      return data;
    } else {
      announce(i18n('msgUpdating'));
      errorMessage = i18n('msgErrorFetchingScript');
      return (await requestNewer(downloadURL, { cache: 'no-cache' })).data;
    }
  } catch (error) {
    if (process.env.DEBUG) console.error(error);
    announce(errorMessage || i18n('msgErrorFetchingUpdateInfo'), { error });
  }
  throw update;
  function announce(message, { error, checking = !error } = {}) {
    Object.assign(update, {
      message,
      checking,
      error: error ? `${i18n('genericError')} ${error.status}, ${error.url}` : null,
      // `null` is transferable in Chrome unlike `undefined`
    });
    sendCmd('UpdateScript', result);
  }
}

function canNotify(script) {
  const allowed = getOption('notifyUpdates');
  return getOption('notifyUpdatesGlobal')
    ? allowed
    : script.config.notifyUpdates ?? allowed;
}

