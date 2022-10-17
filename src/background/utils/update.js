import {
  compareVersion, getScriptName, getScriptUpdateUrl,
  i18n, sendCmd, trueJoin,
} from '@/common';
import { METABLOCK_RE } from '@/common/consts';
import { fetchResources, getScriptById, getScripts, parseScript } from './db';
import { parseMeta } from './script';
import { getOption, setOption } from './options';
import { addOwnCommands, commands } from './message';
import { requestNewer } from './storage-fetch';

const processes = {};

addOwnCommands({
  /**
   * @param {number} [id] - when omitted, all scripts are checked
   * @return {Promise<number>} number of updated scripts
   */
  async CheckUpdate(id) {
    const scripts = id ? [getScriptById(id)] : getScripts();
    const results = await Promise.all(scripts.reduce(maybeCheckUpdate, []));
    displayNotes(results.filter(r => r?.text));
    if (!id) setOption('lastUpdate', Date.now());
    return results.reduce((num, r) => num + (r === true), 0);
  },
});

function displayNotes(notes) {
  if (notes.length === 1) {
    notify(notes[0]);
  } else if (notes.length) {
    notify({
      // FF doesn't show notifications of type:'list' so we'll use `text` everywhere
      text: notes.map(n => n.text).join('\n'),
      onClick: browser.runtime.openOptionsPage,
    });
  }
}

function maybeCheckUpdate(jobs, script) {
  const { id } = script.props;
  const urls = getScriptUpdateUrl(script, true);
  if (urls) {
    jobs.push(processes[id] || (processes[id] = doCheckUpdate(script, urls)));
  }
  return jobs;
}

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

function notify({
  script,
  text,
  onClick = () => commands.OpenEditor(script.props.id),
}) {
  commands.Notification({
    text,
    // FF doesn't show the name of the extension in the title of the notification
    title: IS_FIREFOX ? i18n('optionUpdate') : '',
  }, undefined, {
    onClick,
  });
}
