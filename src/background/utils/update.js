import {
  i18n, request, compareVersion, sendCmd,
} from '#/common';
import { CMD_SCRIPT_UPDATE } from '#/common/consts';
import { getScriptById, getScripts, parseScript } from './db';
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
const OPTIONS = {
  meta: {
    headers: { ...NO_HTTP_CACHE, Accept: 'text/x-userscript-meta' },
  },
  script: {
    headers: NO_HTTP_CACHE,
  },
};

// resolves to true if successfully updated
export default function checkUpdate(script) {
  const { id } = script.props;
  const promise = processes[id] || (processes[id] = doCheckUpdate(script));
  return promise;
}

async function doCheckUpdate(script) {
  const { id } = script.props;
  try {
    const { update } = await parseScript({
      id,
      code: await downloadUpdate(script),
      update: { checking: false },
    });
    if (canNotify(script)) {
      notify({
        title: i18n('titleScriptUpdated'),
        body: i18n('msgScriptUpdated', [update.meta.name || i18n('labelNoName')]),
      });
    }
    return true;
  } catch (error) {
    if (process.env.DEBUG) console.error(error);
  } finally {
    delete processes[id];
  }
}

async function downloadUpdate(script) {
  const downloadURL = (
    script.custom.downloadURL
    || script.meta.downloadURL
    || script.custom.lastInstallURL
  );
  const updateURL = (
    script.custom.updateURL
    || script.meta.updateURL
    || downloadURL
  );
  if (!updateURL) throw false;
  let checkingMeta = true;
  const update = {};
  const result = { update, where: { id: script.props.id } };
  announce(i18n('msgCheckingForUpdate'));
  try {
    const { data } = await request(updateURL, OPTIONS.meta);
    const meta = parseMeta(data);
    if (compareVersion(script.meta.version, meta.version) >= 0) {
      announce(i18n('msgNoUpdate'), { checking: false });
    } else if (!downloadURL) {
      announce(i18n('msgNewVersion'), { checking: false });
    } else {
      announce(i18n('msgUpdating'));
      checkingMeta = false;
      return (await request(downloadURL, OPTIONS.script)).data;
    }
  } catch (error) {
    announce(
      checkingMeta ? i18n('msgErrorFetchingUpdateInfo') : i18n('msgErrorFetchingScript'),
      { error },
    );
  }
  throw update.error;
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
