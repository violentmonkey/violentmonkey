import { i18n, request, compareVersion } from '#/common';
import { CMD_SCRIPT_UPDATE } from '#/common/consts';
import { parseScript } from './db';
import { parseMeta } from './script';
import { getOption } from './options';
import { notify, sendMessageOrIgnore } from './message';

const processes = {};

function doCheckUpdate(script) {
  const update = {
    checking: true,
  };
  const res = {
    cmd: CMD_SCRIPT_UPDATE,
    data: {
      where: {
        id: script.props.id,
      },
      update,
    },
  };
  const downloadURL = (
    script.custom.downloadURL
    || script.meta.downloadURL
    || script.custom.lastInstallURL
  );
  const updateURL = script.custom.updateURL || script.meta.updateURL || downloadURL;
  const okHandler = ({ data }) => {
    const meta = parseMeta(data);
    if (compareVersion(script.meta.version, meta.version) < 0) return Promise.resolve();
    update.checking = false;
    update.message = i18n('msgNoUpdate');
    sendMessageOrIgnore(res);
    return Promise.reject();
  };
  const errHandler = () => {
    update.checking = false;
    update.message = i18n('msgErrorFetchingUpdateInfo');
    sendMessageOrIgnore(res);
    return Promise.reject();
  };
  const doUpdate = () => {
    if (!downloadURL) {
      update.message = i18n('msgNewVersion');
      sendMessageOrIgnore(res);
      return Promise.reject();
    }
    update.message = i18n('msgUpdating');
    sendMessageOrIgnore(res);
    return request(downloadURL)
    .then(({ data }) => data, () => {
      update.checking = false;
      update.message = i18n('msgErrorFetchingScript');
      sendMessageOrIgnore(res);
      return Promise.reject();
    });
  };
  if (!updateURL) return Promise.reject();
  update.message = i18n('msgCheckingForUpdate');
  sendMessageOrIgnore(res);
  return request(updateURL, {
    headers: {
      Accept: 'text/x-userscript-meta',
    },
  })
  .then(okHandler, errHandler)
  .then(doUpdate);
}

export default function checkUpdate(script) {
  const { id } = script.props;
  let promise = processes[id];
  if (!promise) {
    let updated = false;
    promise = doCheckUpdate(script)
    .then(code => parseScript({
      id,
      code,
      update: {
        checking: false,
      },
    }))
    .then((res) => {
      const { data: { update } } = res;
      updated = true;
      if (getOption('notifyUpdates')) {
        notify({
          title: i18n('titleScriptUpdated'),
          body: i18n('msgScriptUpdated', [update.meta.name || i18n('labelNoName')]),
        });
      }
    })
    .catch((err) => {
      if (process.env.DEBUG) console.error(err);
    })
    .then(() => {
      delete processes[id];
      return updated;
    });
    processes[id] = promise;
  }
  return promise;
}
