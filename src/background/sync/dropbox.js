import { loadQuery, dumpQuery } from '../utils';
import {
  getURI, getItemFilename, BaseService, isScriptFile, register,
  openAuthPage,
} from './base';

const config = {
  client_id: 'f0q12zup2uys5w8',
  redirect_uri: 'https://violentmonkey.github.io/auth_dropbox.html',
};

const escRE = /[\u007f-\uffff]/g; // eslint-disable-line no-control-regex
const escFunc = m => `\\u${(m.charCodeAt(0) + 0x10000).toString(16).slice(1)}`;

function jsonStringifySafe(obj) {
  const string = JSON.stringify(obj);
  return string.replace(escRE, escFunc);
}

const Dropbox = BaseService.extend({
  name: 'dropbox',
  displayName: 'Dropbox',
  user() {
    return this.loadData({
      method: 'POST',
      url: 'https://api.dropboxapi.com/2/users/get_current_account',
    })
    .catch((err) => {
      if (err.status === 401) {
        return Promise.reject({
          type: 'unauthorized',
        });
      }
      return Promise.reject({
        type: 'error',
        data: err,
      });
    });
  },
  handleMetaError(res) {
    if (res.status !== 409) throw res;
  },
  list() {
    return this.loadData({
      method: 'POST',
      url: 'https://api.dropboxapi.com/2/files/list_folder',
      body: {
        path: '',
      },
      responseType: 'json',
    })
    .then(data => (
      data.entries.filter(item => item['.tag'] === 'file' && isScriptFile(item.name)).map(normalize)
    ));
  },
  get(item) {
    const name = getItemFilename(item);
    return this.loadData({
      method: 'POST',
      url: 'https://content.dropboxapi.com/2/files/download',
      headers: {
        'Dropbox-API-Arg': jsonStringifySafe({
          path: `/${name}`,
        }),
      },
    });
  },
  put(item, data) {
    const name = getItemFilename(item);
    return this.loadData({
      method: 'POST',
      url: 'https://content.dropboxapi.com/2/files/upload',
      headers: {
        'Dropbox-API-Arg': jsonStringifySafe({
          path: `/${name}`,
          mode: 'overwrite',
        }),
        'Content-Type': 'application/octet-stream',
      },
      body: data,
      responseType: 'json',
    })
    .then(normalize);
  },
  remove(item) {
    const name = getItemFilename(item);
    return this.loadData({
      method: 'POST',
      url: 'https://api.dropboxapi.com/2/files/delete',
      body: {
        path: `/${name}`,
      },
      responseType: 'json',
    })
    .then(normalize);
  },
  authorize() {
    const params = {
      response_type: 'token',
      client_id: config.client_id,
      redirect_uri: config.redirect_uri,
    };
    const url = `https://www.dropbox.com/oauth2/authorize?${dumpQuery(params)}`;
    openAuthPage(url, config.redirect_uri);
  },
  authorized(raw) {
    const data = loadQuery(raw);
    if (data.access_token) {
      this.config.set({
        uid: data.uid,
        token: data.access_token,
      });
    }
  },
  checkAuth(url) {
    const redirectUri = `${config.redirect_uri}#`;
    if (url.startsWith(redirectUri)) {
      this.authorized(url.slice(redirectUri.length));
      this.checkSync();
      return true;
    }
  },
  revoke() {
    this.config.set({
      uid: null,
      token: null,
    });
    return this.prepare();
  },
});
register(Dropbox);

function normalize(item) {
  return {
    name: item.name,
    size: item.size,
    uri: getURI(item.name),
    // modified: new Date(item.server_modified).getTime(),
    // isDeleted: item.is_deleted,
  };
}
