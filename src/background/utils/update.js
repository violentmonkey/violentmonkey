import {
  compareVersion, ensureArray, getScriptName, getScriptUpdateUrl, i18n, sendCmd, trueJoin,
} from '@/common';
import { __CODE, METABLOCK_RE, NO_CACHE, TIMEOUT_24HOURS, TIMEOUT_MAX } from '@/common/consts';
import { fetchResources, getScriptById, getScripts, notifyToOpenScripts, parseScript } from './db';
import { addOwnCommands, commands, init } from './init';
import { parseMeta } from './script';
import { getOption, hookOptions, setOption } from './options';
import { requestNewer } from './storage-fetch';

const processes = {};
const FAST_CHECK = {
  ...NO_CACHE,
  // Smart servers like OUJS send a subset of the metablock without code
  headers: { Accept: 'text/x-userscript-meta,*/*' },
};

init.then(autoUpdate);
hookOptions(changes => 'autoUpdate' in changes && autoUpdate());

addOwnCommands({
  /**
   * @param {number | number[] | 'auto'} [id] - when omitted, all scripts are checked
   * @return {Promise<number>} number of updated scripts
   */
  async CheckUpdate(id) {
    const isAuto = id === AUTO;
    const isAll = isAuto || !id;
    const scripts = isAll ? getScripts() : ensureArray(id).map(getScriptById).filter(Boolean);
    const urlOpts = {
      all: true,
      allowedOnly: isAll,
      enabledOnly: isAll && getOption('updateEnabledScriptsOnly'),
    };
    const opts = { [MULTI]: isAuto ? AUTO : isAll };
    const jobs = scripts.map(script => {
      const curId = script.props.id;
      const urls = getScriptUpdateUrl(script, urlOpts);
      return urls && (
        processes[curId] || (
          processes[curId] = doCheckUpdate(script, urls, opts)
        )
      );
    }).filter(Boolean);
    const results = await Promise.all(jobs);
    const notes = results.filter(r => r?.text);
    if (notes.length) {
      notifyToOpenScripts(
        notes.some(n => n.err) ? i18n('msgOpenUpdateErrors')
          : IS_FIREFOX ? i18n('optionUpdate')
            : '', // Chrome confusingly shows the title next to message using the same font
        notes.map(n => `* ${n.text}\n`).join(''),
        notes.map(n => n.script.props.id),
      );
    }
    if (isAll) setOption('lastUpdate', Date.now());
    return results.reduce((num, r) => num + (r === true), 0);
  },
});

async function doCheckUpdate(script, urls, opts) {
  const { id } = script.props;
  let res;
  let msgOk;
  let msgErr;
  let resourceOpts;
  try {
    const { update } = await parseScript({
      id,
      code: await downloadUpdate(script, urls, opts),
      update: { checking: false },
      bumpDate: true,
    });
    msgOk = i18n('msgScriptUpdated', [getScriptName(update)]);
    resourceOpts = { ...NO_CACHE };
    res = true;
  } catch (update) {
    msgErr = update.error;
    // Either proceed with normal fetch on no-update or skip it altogether on error
    resourceOpts = !update.error && !update.checking && {};
    if (process.env.DEBUG) console.error(update);
  } finally {
    if (resourceOpts) {
      Object.assign(resourceOpts, opts);
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

async function downloadUpdate(script, urls, opts) {
  let errorMessage;
  const { meta, props: { id } } = script;
  const [downloadURL, updateURL] = urls;
  const update = {};
  const result = { update, where: { id } };
  announce(i18n('msgCheckingForUpdate'));
  try {
    const { data } = await requestNewer(updateURL, { ...FAST_CHECK, ...opts }) || {};
    const { version, [__CODE]: metaStr } = data ? parseMeta(data, true) : {};
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
      return downloadURL === updateURL && metaStr.trim() !== data.trim()
        ? data
        : (await requestNewer(downloadURL, { ...NO_CACHE, ...opts })).data;
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

function autoUpdate() {
  const interval = getUpdateInterval();
  if (!interval) return;
  let elapsed = Date.now() - getOption('lastUpdate');
  if (elapsed >= interval) {
    // Wait on startup for things to settle and after unsuspend for network reconnection
    setTimeout(commands.CheckUpdate, 20e3, AUTO);
    elapsed = 0;
  }
  clearTimeout(autoUpdate.timer);
  autoUpdate.timer = setTimeout(autoUpdate, Math.min(TIMEOUT_MAX, interval - elapsed));
}

export function getUpdateInterval() {
  return (+getOption('autoUpdate') || 0) * TIMEOUT_24HOURS;
}
