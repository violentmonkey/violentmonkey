import {
  compareVersion, getScriptName, getScriptUpdateUrl, i18n, sendCmd, trueJoin,
} from '@/common';
import {
  __CODE, FETCH_OPTS, METABLOCK_RE, NO_CACHE, TIMEOUT_24HOURS, TIMEOUT_MAX,
} from '@/common/consts';
import { fetchResources, getScriptById, getScripts, notifyToOpenScripts, parseScript } from './db';
import { addOwnCommands, init } from './init';
import { parseMeta } from './script';
import { kAlarmUpdate } from './session-data';
import { getOption, hookOptions, setOption } from './options';
import { kUpdateEnabledScriptsOnly } from '@/common/options-defaults';
import { requestNewer } from './storage-fetch';

const processes = {};
const FAST_CHECK = {
  ...NO_CACHE,
  // Smart servers like OUJS send a subset of the metablock without code
  headers: { Accept: 'text/x-userscript-meta,*/*' },
};
const kChecking = 'checking';
let autoUpdateTimer;

init.then(autoUpdate);
hookOptions(changes => (changes = changes.autoUpdate) != null && autoUpdate(changes));

/** @namespace commands */
addOwnCommands({
  CheckUpdate: checkUpdate,

  /**
   * @param {{ id: number } & VMScriptSourceOptions} opts
   * @return {Promise<?string>}
   */
  UpdateDeps: opts => fetchResources(getScriptById(opts.id), {
    [FETCH_OPTS]: { ...NO_CACHE },
    update: {},
    ...opts
  }),
});

/**
 * @param {{}} [_]
 * @param {number[]} [_.ids] - when omitted, all scripts are checked
 * @param {boolean} [_.auto] - scheduled auto update
 * @param {boolean} [_.force] - force (ignore checks)
 * @return {Promise<number>} number of updated scripts
 */
async function checkUpdate({ ids, force, [AUTO]: auto } = {}) {
  const isAll = auto || !ids;
  const scripts = isAll ? getScripts() : ids.map(getScriptById).filter(Boolean);
  const urlOpts = {
    all: true,
    allowedOnly: isAll,
    enabledOnly: isAll && getOption(kUpdateEnabledScriptsOnly),
  };
  const opts = {
    force,
    [FETCH_OPTS]: {
      ...NO_CACHE,
      [MULTI]: auto ? AUTO : isAll,
    },
  };
  const jobs = scripts.map(script => {
    const curId = script.props.id;
    const urls = getScriptUpdateUrl(script, urlOpts);
    return urls
      ? processes[curId] ??= doCheckUpdate(curId, script, urls, opts)
      : force && fetchResources(script, { update: {}, ...opts });
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
  if (auto && __.MV3) autoUpdateTimer = 0;
  return results.reduce((num, r) => num + (r === true), 0);
}

async function doCheckUpdate(id, script, urls, opts) {
  let res;
  let msgOk;
  let msgErr;
  try {
    const { update } = await parseScript({
      id,
      code: await downloadUpdate(script, urls, opts),
      bumpDate: true,
      update: { [kChecking]: false },
      ...opts,
    });
    msgOk = i18n('msgScriptUpdated', [getScriptName(update)]);
    res = true;
  } catch (update) {
    msgErr = update.error
      || !update[kChecking] && await fetchResources(script, opts);
    if (__.DEBUG) console.error(update);
  } finally {
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
    if (opts.force) {
      announceUpdate();
      return (await requestNewer(downloadURL || updateURL, opts)).data;
    }
    const { data } = await requestNewer(updateURL, { ...FAST_CHECK, ...opts }) || {};
    const { version, [__CODE]: metaStr } = data ? parseMeta(data, { retMetaStr: true }) : {};
    if (compareVersion(meta.version, version) >= 0) {
      announce(i18n('msgNoUpdate'), { [kChecking]: false });
    } else if (!downloadURL) {
      announce(i18n('msgNewVersion'), { [kChecking]: false });
    } else if (downloadURL === updateURL && data?.replace(METABLOCK_RE, '').trim()) {
      // Code is present, so this is not a smart server, hence the response is the entire script
      announce(i18n('msgUpdated'));
      return data;
    } else {
      announceUpdate();
      return downloadURL === updateURL && metaStr.trim() !== data.trim()
        ? data
        : (await requestNewer(downloadURL, opts)).data;
    }
  } catch (error) {
    if (__.DEBUG) console.error(error);
    announce(errorMessage || i18n('msgErrorFetchingUpdateInfo'), { error });
  }
  throw update;
  function announce(message, { error, [kChecking]: checking = !error } = {}) {
    Object.assign(update, {
      message,
      [kChecking]: checking,
      error: error ? `${i18n('genericError')} ${error.status}, ${error.url}` : null,
      // `null` is transferable in Chrome unlike `undefined`
    });
    sendCmd('UpdateScript', result);
  }
  function announceUpdate() {
    announce(i18n('msgUpdating'));
    errorMessage = i18n('msgErrorFetchingScript');
  }
}

function canNotify(script) {
  const allowed = getOption('notifyUpdates');
  return getOption('notifyUpdatesGlobal')
    ? allowed
    : script.config.notifyUpdates ?? allowed;
}

export async function autoUpdate(val) {
  const interval = getUpdateInterval(val);
  if (__.MV3 && val != null) {
    await chrome.alarms.clear(kAlarmUpdate);
    if (val) await chrome.alarms.create(kAlarmUpdate, { periodInMinutes: interval / 60e3 });
  }
  if (!interval || __.MV3 && autoUpdateTimer/* reentry from onAlarm */) {
    return;
  }
  let elapsed = Date.now() - getOption('lastUpdate');
  if (elapsed >= interval) {
    // Wait on startup for things to settle and after unsuspend for network reconnection
    autoUpdateTimer = setTimeout(checkUpdate, 20e3, { [AUTO]: true });
    elapsed = 0;
  }
  if (!__.MV3) {
    clearTimeout(autoUpdateTimer);
    autoUpdateTimer = setTimeout(autoUpdate, Math.min(TIMEOUT_MAX, interval - elapsed));
  }
}

export function getUpdateInterval(val = getOption('autoUpdate')) {
  return (+val || 0) * TIMEOUT_24HOURS;
}
