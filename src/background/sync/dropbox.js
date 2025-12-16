import { dumpQuery, getUniqId, loadQuery } from '@/common';
import { FORM_URLENCODED, VM_HOME } from '@/common/consts';
import {
  BaseService,
  getCodeChallenge,
  getCodeVerifier,
  getItemFilename,
  getURI,
  INIT_ERROR,
  INIT_RETRY,
  isScriptFile,
  openAuthPage,
  register,
} from './base';

const config = {
  client_id: process.env.SYNC_DROPBOX_CLIENT_ID,
  redirect_uri: VM_HOME + 'auth_dropbox.html',
};

const escRE = /[\u007f-\uffff]/g; // eslint-disable-line no-control-regex
const escFunc = (m) =>
  `\\u${(m.charCodeAt(0) + 0x10000).toString(16).slice(1)}`;

function jsonStringifySafe(obj) {
  const string = JSON.stringify(obj);
  return string.replace(escRE, escFunc);
}

const Dropbox = BaseService.extend({
  name: 'dropbox',
  displayName: 'Dropbox',
  async requestAuth() {
    try {
      await this.loadData({
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/users/get_current_account',
      });
    } catch (err) {
      let code = INIT_ERROR;
      if (err.status === 401) {
        code = INIT_RETRY;
      }
      return { code, error: err };
    }
  },
  metaError(res) {
    if (res.status !== 409) throw res;
  },
  async list() {
    let files = [];
    let data = await this.loadData({
      method: 'POST',
      url: 'https://api.dropboxapi.com/2/files/list_folder',
      body: {
        path: '',
      },
      responseType: 'json',
    });
    files = [
      ...files,
      ...data.entries
        .filter((item) => item['.tag'] === 'file' && isScriptFile(item.name))
        .map(normalize),
    ];
    while (data.has_more) {
      data = await this.loadData({
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/files/list_folder/continue',
        body: {
          cursor: data.cursor,
        },
        responseType: 'json',
      });
      files = [
        ...files,
        ...data.entries
          .filter((item) => item['.tag'] === 'file' && isScriptFile(item.name))
          .map(normalize),
      ];
    }
    return files;
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
    }).then(normalize);
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
    }).then(normalize);
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
      ...(await getCodeChallenge(this.session.codeVerifier)),
    };
    const url = `https://www.dropbox.com/oauth2/authorize?${dumpQuery(params)}`;
    openAuthPage(url, config.redirect_uri);
  },
  async authorized(params) {
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
      token: data.access_token,
      refresh_token: data.refresh_token || params.refresh_token,
    });
  },
  matchAuth(url) {
    const redirectUri = `${config.redirect_uri}?`;
    if (!url.startsWith(redirectUri)) return;
    const query = loadQuery(url.slice(redirectUri.length));
    const { state, codeVerifier } = this.session || {};
    this.session = null;
    if (query.state !== state || !query.code) return;
    return {
      code: query.code,
      code_verifier: codeVerifier,
    };
  },
  async finishAuth(payload) {
    await this.authorized({
      code: payload.code,
      code_verifier: payload.code_verifier,
      grant_type: 'authorization_code',
      redirect_uri: config.redirect_uri,
    });
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
if (config.client_id) register(Dropbox);

function normalize(item) {
  return {
    name: item.name,
    size: item.size,
    uri: getURI(item.name),
    // modified: new Date(item.server_modified).getTime(),
    // isDeleted: item.is_deleted,
  };
}
