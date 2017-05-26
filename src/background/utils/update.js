import { i18n, request } from 'src/common';
import { parseScript } from './db';
import { parseMeta, compareVersion } from './script';
import { getOption } from './options';
import { notify } from '.';

const processes = {};

function doCheckUpdate(script) {
  const res = {
    cmd: 'UpdateScript',
    data: {
      id: script.id,
      checking: true,
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
    res.data.checking = false;
    res.data.message = i18n('msgNoUpdate');
    browser.runtime.sendMessage(res);
    return Promise.reject();
  };
  const errHandler = () => {
    res.data.checking = false;
    res.data.message = i18n('msgErrorFetchingUpdateInfo');
    browser.runtime.sendMessage(res);
    return Promise.reject();
  };
  const update = () => {
    if (!downloadURL) {
      res.data.message = `<span class="new">${i18n('msgNewVersion')}</span>`;
      browser.runtime.sendMessage(res);
      return Promise.reject();
    }
    res.data.message = i18n('msgUpdating');
    browser.runtime.sendMessage(res);
    return request(downloadURL)
    .then(({ data }) => data, () => {
      res.data.checking = false;
      res.data.message = i18n('msgErrorFetchingScript');
      browser.runtime.sendMessage(res);
      return Promise.reject();
    });
  };
  if (!updateURL) return Promise.reject();
  res.data.message = i18n('msgCheckingForUpdate');
  browser.runtime.sendMessage(res);
  return request(updateURL, {
    headers: {
      Accept: 'text/x-userscript-meta',
    },
  })
  .then(okHandler, errHandler)
  .then(update);
}

export default function checkUpdate(script) {
  let promise = processes[script.id];
  if (!promise) {
    let updated = false;
    promise = doCheckUpdate(script)
    .then(code => parseScript({
      code,
      id: script.id,
    }))
    .then(res => {
      const { data } = res;
      data.checking = false;
      browser.runtime.sendMessage(res);
      updated = true;
      if (getOption('notifyUpdates')) {
        notify({
          title: i18n('titleScriptUpdated'),
          body: i18n('msgScriptUpdated', [data.meta.name || i18n('labelNoName')]),
        });
      }
    })
    .catch(err => {
      if (process.env.DEBUG) console.error(err);
    })
    .then(() => {
      delete processes[script.id];
      return updated;
    });
    processes[script.id] = promise;
  }
  return promise;
}
