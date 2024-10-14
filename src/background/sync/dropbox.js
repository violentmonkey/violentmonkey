import { dumpQuery, getUniqId, loadQuery } from '@/common';
import { FORM_URLENCODED, VM_HOME } from '@/common/consts';
import {
  getURI, getItemFilename, BaseService, isScriptFile, register,
  openAuthPage,
  getCodeVerifier,
  getCodeChallenge,
} from './base';

const config = {
  client_id: process.env.SYNC_DROPBOX_CLIENT_ID,
  redirect_uri: VM_HOME + 'auth_dropbox.html',
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
  refreshToken() {
    const refreshToken = this.config.get('refresh_token');
    return this.authorized({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
    .then(() => this.prepare());
  },
  user() {
    const requestUser = () => this.loadData({
      method: 'POST',
      url: 'https://api.dropboxapi.com/2/users/get_current_account',
    });
    return requestUser()
    .catch((res) => {
      if (res.status === 401) {
        return this.refreshToken().then(requestUser);
      }
      throw res;
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
  async authorize() {
    this.session = {
      state: getUniqId(),
      codeVerifier: getCodeVerifier(),
    };
    const params = {
      response_type: 'code',
      token_access_type: 'offline',
      client_id: config.client_id,
      redirect_uri: config.redirect_uri,
      state: this.session.state,
      ...await getCodeChallenge(this.session.codeVerifier),
    };
    const url = `https://www.dropbox.com/oauth2/authorize?${dumpQuery(params)}`;
    openAuthPage(url, config.redirect_uri);
  },
  async authorized(params) {
    delete this.headers.Authorization;
    this.authState.set('authorizing');
    const data = await this.loadData({
      method: 'POST',
      url: 'https://api.dropbox.com/oauth2/token',
      headers: {
        'Content-Type': FORM_URLENCODED,
      },
      body: dumpQuery({
        client_id: config.client_id,
        ...params,
      }),
      responseType: 'json',
    });
    if (!data.access_token) throw data;
    this.config.set({
      uid: data.account_id,
      token: data.access_token,
      refresh_token: data.refresh_token || params.refresh_token,
    });
  },
  checkAuth(url) {
    const redirectUri = `${config.redirect_uri}?`;
    if (!url.startsWith(redirectUri)) return;
    const query = loadQuery(url.slice(redirectUri.length));
    const { state, codeVerifier } = this.session || {};
    this.session = null;
    if (query.state !== state || !query.code) return;
    this.checkSync(this.authorized({
      code: query.code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: config.redirect_uri,
    }));
    return true;
  },
  revoke() {
    this.config.set({
      uid: null,
      token: null,
      refresh_token: null,
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
