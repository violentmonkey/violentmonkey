import { i18n, request, compareVersion, sendCmd, trueJoin } from '#/common';
import { CMD_SCRIPT_UPDATE } from '#/common/consts';
import { fetchResources, getScriptById, getScripts, parseScript } from './db';
import { parseMeta } from './script';
import { getOption, setOption } from './options';
import { commands, notify } from './message';

Object.assign(commands, {
  /** @return {Promise<true?>} */
  CheckUpdate(id) {
    return checkUpdate(getScriptById(id));
  },
  /** @return {Promise<boolean>} */
  async CheckUpdateAll() {
    setOption('lastUpdate', Date.now());
    const toUpdate = getScripts().filter(item => item.config.shouldUpdate);
    const results = await Promise.all(toUpdate.map(checkUpdate));
    return results.includes(true);
  },
});

const processes = {};
const NO_HTTP_CACHE = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};
// resolves to true if successfully updated
export default function checkUpdate(script) {
  const { id } = script.props;
  const promise = processes[id] || (processes[id] = doCheckUpdate(script));
  return promise;
}

async function doCheckUpdate(script) {
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
    msgOk = canNotify(script) && i18n('msgScriptUpdated', [update.meta.name || i18n('labelNoName')]);
    resourceOpts = { headers: NO_HTTP_CACHE };
    return true;
  } catch (update) {
    // Either proceed with normal fetch on no-update or skip it altogether on error
    resourceOpts = !update.error && !update.checking && {};
    if (process.env.DEBUG) console.error(update);
  } finally {
    if (resourceOpts) {
      msgErr = await fetchResources(script, null, resourceOpts);
      if (process.env.DEBUG && msgErr) console.error(msgErr);
    }
    if (msgOk || msgErr) {
      notify({
        title: i18n('titleScriptUpdated'),
        body: [msgOk, msgErr]::trueJoin('\n'),
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
      headers: { ...NO_HTTP_CACHE, Accept: 'text/x-userscript-meta,*/*' },
    });
    const { version } = parseMeta(data);
    if (compareVersion(meta.version, version) >= 0) {
      announce(i18n('msgNoUpdate'), { checking: false });
    } else if (!downloadURL) {
      announce(i18n('msgNewVersion'), { checking: false });
    } else {
      announce(i18n('msgUpdating'));
      errorMessage = i18n('msgErrorFetchingScript');
      return (await request(downloadURL, { headers: NO_HTTP_CACHE })).data;
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
      // `null` is sendable in Chrome unlike `undefined`
      error: error?.url || error || null,
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
