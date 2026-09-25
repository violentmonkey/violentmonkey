import { compareVersion, getScriptName, getScriptUpdateUrl, i18n, trueJoin } from '@/common';
import {
  __CODE, FETCH_OPTS, METABLOCK_RE, NO_CACHE, TIMEOUT_MAX,
} from '@/common/consts';
import {
  getCronOccurrence, getNextCronTime, normalizeUpdateCron,
} from '@/common/cron';
import broadcast from './broadcast';
import { fetchResources, getScriptById, getScripts, notifyToOpenScripts, parseScript } from './db';
import { addOwnCommands, init } from './init';
import { parseMeta } from './script';
import { kAlarmUpdate } from './session-data';
import { getOption, hookOptions, setOption } from './options';
import { kUpdateCron, kUpdateEnabledScriptsOnly } from '@/common/options-defaults';
import { requestNewer } from './storage-fetch';

const processes = {};
const FAST_CHECK = {
  ...NO_CACHE,
  // Smart servers like OUJS send a subset of the metablock without code
  headers: { Accept: 'text/x-userscript-meta,*/*' },
};
const kChecking = 'checking';
const UPDATE_START_DELAY = 20e3;
let autoUpdateTimer;
let scheduledAt;
let lastSchedule = '';
let autoUpdateTask = Promise.resolve();

init.then(() => autoUpdate());
hookOptions(changes => (changes = changes[kUpdateCron]) != null && autoUpdate());

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
      ...(auto && { updateLastCheck: getOption('lastUpdate') }),
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
  if (__.DEBUG) console.info('update check finished', {
    auto,
    scripts: scripts.length,
    updated: results.filter(r => r === true).length,
  });
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
  const fetchOpts = opts[FETCH_OPTS] || opts;
  const update = {};
  const result = { update, where: { id } };
  announce(i18n('msgCheckingForUpdate'));
  try {
    if (opts.force) {
      announceUpdate();
      return (await requestNewer(downloadURL || updateURL, fetchOpts)).data;
    }
    const { data } = await requestNewer(updateURL, { ...FAST_CHECK, ...fetchOpts }) || {};
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
        : (await requestNewer(downloadURL, fetchOpts)).data;
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
    broadcast('UpdateScript', result);
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

export function autoUpdate(runNow = false, forceRun = false, expectedAt) {
  autoUpdateTask = autoUpdateTask
    .then(async () => {
      if (init) await init;
      return runNow ? runScheduledUpdate(forceRun, expectedAt) : scheduleAutoUpdate();
    })
    .catch(err => {
      if (__.DEBUG) console.error('update scheduler', err);
    });
  return autoUpdateTask;
}

async function runScheduledUpdate(forceRun, expectedAt) {
  const expression = getUpdateSchedule();
  if (!expression) return;
  if (expectedAt != null) {
    const occurrence = getCronOccurrence(expression, expectedAt, UPDATE_START_DELAY + 60e3);
    if (!occurrence) {
      await scheduleAutoUpdate();
      return;
    }
    if (isCheckedOccurrence(occurrence)) {
      await scheduleAutoUpdate(true);
      return;
    }
  }
  if (!forceRun && scheduledAt != null && Date.now() + 1000 < scheduledAt) {
    await scheduleAutoUpdate();
    return;
  }
  scheduledAt = null;
  if (__.DEBUG) console.info('update check started', expression);
  try {
    await checkUpdate({ [AUTO]: true });
  } finally {
    await scheduleAutoUpdate(true);
  }
}

async function scheduleAutoUpdate(skipCurrent = false) {
  await clearAutoUpdate();
  const expression = getUpdateSchedule();
  if (!expression) return;
  const now = Date.now();
  const current = !skipCurrent && getNextCronTime(expression, now - 60e3, true);
  const next = getNextCronTime(expression, now, !skipCurrent);
  if (next == null) {
    if (__.DEBUG) console.error('update schedule has no future occurrence', expression);
    return;
  }
  const currentWasChecked = current != null && current <= now
    && isCheckedOccurrence(current);
  const target = current != null && current <= now && !currentWasChecked
    ? now + UPDATE_START_DELAY
    : next;
  scheduledAt = target;
  if (__.MV3) {
    await chrome.alarms.create(kAlarmUpdate, { when: target });
  } else {
    autoUpdateTimer = setTimeout(
      () => autoUpdate(true, false, target),
      Math.min(TIMEOUT_MAX, target - Date.now()),
    );
  }
  if (__.DEBUG) console.info('update scheduled', {
    expression,
    next: new Date(target).toISOString(),
  });
}

async function clearAutoUpdate() {
  scheduledAt = null;
  if (__.MV3) {
    await chrome.alarms.clear(kAlarmUpdate);
  } else {
    clearTimeout(autoUpdateTimer);
    autoUpdateTimer = 0;
  }
}

function isCheckedOccurrence(timestamp) {
  return getOption('lastUpdate') >= timestamp;
}

function getUpdateSchedule() {
  try {
    lastSchedule = normalizeUpdateCron(getOption(kUpdateCron));
  } catch (err) {
    if (__.DEBUG) console.error('invalid update schedule', err);
  }
  return lastSchedule;
}
