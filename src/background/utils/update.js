import { i18n, request } from 'src/common';
import { parseScript } from './db';
import { parseMeta, compareVersion } from './script';
import { getOption } from './options';
import { notify } from '.';

const processes = {};

function doCheckUpdate(script) {
  const update = {
    checking: true,
  };
  const res = {
    cmd: 'UpdateScript',
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
    browser.runtime.sendMessage(res);
    return Promise.reject();
  };
  const errHandler = () => {
    update.checking = false;
    update.message = i18n('msgErrorFetchingUpdateInfo');
    browser.runtime.sendMessage(res);
    return Promise.reject();
  };
  const doUpdate = () => {
    if (!downloadURL) {
      update.message = `<span class="new">${i18n('msgNewVersion')}</span>`;
      browser.runtime.sendMessage(res);
      return Promise.reject();
    }
    update.message = i18n('msgUpdating');
    browser.runtime.sendMessage(res);
    return request(downloadURL)
    .then(({ data }) => data, () => {
      update.checking = false;
      update.message = i18n('msgErrorFetchingScript');
      browser.runtime.sendMessage(res);
      return Promise.reject();
    });
  };
  if (!updateURL) return Promise.reject();
  update.message = i18n('msgCheckingForUpdate');
  browser.runtime.sendMessage(res);
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
    }))
    .then(res => {
      const { data: { update } } = res;
      update.checking = false;
      browser.runtime.sendMessage(res);
      updated = true;
      if (getOption('notifyUpdates')) {
        notify({
          title: i18n('titleScriptUpdated'),
          body: i18n('msgScriptUpdated', [update.meta.name || i18n('labelNoName')]),
        });
      }
    })
    .catch(err => {
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
