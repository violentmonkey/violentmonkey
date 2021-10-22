import { getScriptName, i18n, request, compareVersion, sendCmd, trueJoin } from '#/common';
import { CMD_SCRIPT_UPDATE } from '#/common/consts';
import ua from '#/common/ua';
import { fetchResources, getScriptById, getScripts, parseScript } from './db';
import { parseMeta } from './script';
import { getOption, setOption } from './options';
import { commands } from './message';

Object.assign(commands, {
  /** @return {Promise<true?>} */
  async CheckUpdate(id) {
    const script = getScriptById(id);
    const results = await checkAllAndNotify([script]);
    return results[0];
  },
  /** @return {Promise<boolean>} */
  async CheckUpdateAll() {
    setOption('lastUpdate', Date.now());
    const toUpdate = getScripts().filter(item => item.config.shouldUpdate);
    const results = await checkAllAndNotify(toUpdate);
    return results.includes(true);
  },
});

async function checkAllAndNotify(scripts) {
  const notes = [];
  const results = await Promise.all(scripts.map(item => checkUpdate(item, notes)));
  if (notes.length === 1) {
    notify(notes[0]);
  } else if (notes.length) {
    notify({
      // FF doesn't show notifications of type:'list' so we'll use `text` everywhere
      text: notes.map(n => n.text).join('\n'),
      onClick: browser.runtime.openOptionsPage,
    });
  }
  return results;
}

const processes = {};

// resolves to true if successfully updated
function checkUpdate(script, notes) {
  const { id } = script.props;
  const promise = processes[id] || (processes[id] = doCheckUpdate(script, notes));
  return promise;
}

async function doCheckUpdate(script, notes) {
  const { id } = script.props;
  let msgOk;
  let msgErr;
  let resourceOpts;
  try {
    const { update } = await parseScript({
      id,
      code: await downloadUpdate(script),
      update: { checking: false },
    });
    msgOk = i18n('msgScriptUpdated', [getScriptName(update)]);
    resourceOpts = { cache: 'no-cache' };
    return true;
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
      notes.push({
        script,
        text: [msgOk, msgErr]::trueJoin('\n'),
      });
    }
    delete processes[id];
  }
}

async function downloadUpdate({ props: { id }, meta, custom }) {
  const downloadURL = custom.downloadURL || meta.downloadURL || custom.lastInstallURL;
  const updateURL = custom.updateURL || meta.updateURL || downloadURL;
  if (!updateURL) throw false;
  let errorMessage;
  const update = {};
  const result = { update, where: { id } };
  announce(i18n('msgCheckingForUpdate'));
  try {
    const { data } = await request(updateURL, {
      // TODO: do a HEAD request first to get ETag header and compare to storage.mod
      cache: 'no-cache',
      headers: { Accept: 'text/x-userscript-meta,*/*' },
    });
    const { version } = parseMeta(data);
    if (compareVersion(meta.version, version) >= 0) {
      announce(i18n('msgNoUpdate'), { checking: false });
    } else if (!downloadURL) {
      announce(i18n('msgNewVersion'), { checking: false });
    } else {
      announce(i18n('msgUpdating'));
      errorMessage = i18n('msgErrorFetchingScript');
      return (await request(downloadURL, { cache: 'no-cache' })).data;
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
    sendCmd(CMD_SCRIPT_UPDATE, result);
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
    title: ua.isFirefox ? `${i18n('titleScriptUpdated')} - ${i18n('extName')}` : '',
  }, undefined, {
    onClick,
  });
}
