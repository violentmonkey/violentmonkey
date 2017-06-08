import { loadQuery, dumpQuery } from '../utils';
import { getURI, BaseService, isScriptFile, register } from './base';

const config = {
  client_id: 'f0q12zup2uys5w8',
  redirect_uri: 'https://violentmonkey.github.io/auth_dropbox.html',
};

const Dropbox = BaseService.extend({
  name: 'dropbox',
  displayName: 'Dropbox',
  user() {
    return this.loadData({
      method: 'POST',
      url: 'https://api.dropboxapi.com/2/users/get_current_account',
    })
    .catch(err => {
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
  getMeta() {
    return BaseService.prototype.getMeta.call(this)
    .catch(res => {
      if (res.status === 409) return {};
      throw res;
    });
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
  get(path) {
    return this.loadData({
      method: 'POST',
      url: 'https://content.dropboxapi.com/2/files/download',
      headers: {
        'Dropbox-API-Arg': JSON.stringify({
          path: `/${path}`,
        }),
      },
    });
  },
  put(path, data) {
    return this.loadData({
      method: 'POST',
      url: 'https://content.dropboxapi.com/2/files/upload',
      headers: {
        'Dropbox-API-Arg': JSON.stringify({
          path: `/${path}`,
          mode: 'overwrite',
        }),
        'Content-Type': 'application/octet-stream',
      },
      body: data,
      responseType: 'json',
    })
    .then(normalize);
  },
  remove(path) {
    return this.loadData({
      method: 'POST',
      url: 'https://api.dropboxapi.com/2/files/delete',
      body: {
        path: `/${path}`,
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
    browser.tabs.create({ url });
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
    size: item.size,
    uri: getURI(item.name),
    // modified: new Date(item.server_modified).getTime(),
    // isDeleted: item.is_deleted,
  };
}
