// Reference:
// - https://developers.google.com/identity/protocols/oauth2/native-app
// - https://developers.google.com/drive/v3/reference/files
//
// Note:
// - Use a native app approach for longer authorization periods,
// - Web app refresh tokens have short expiration and require frequent user reauthorization.
import { dumpQuery, getUniqId, loadQuery } from '@/common';
import { CHARSET_UTF8, FORM_URLENCODED } from '@/common/consts';
import { objectGet } from '@/common/object';
import {
  BaseService,
  getCodeChallenge,
  getCodeVerifier,
  getItemFilename,
  getURI,
  INIT_ERROR,
  INIT_RETRY,
  INIT_SUCCESS,
  isScriptFile,
  openAuthPage,
  register,
} from './base';

const config = {
  client_id: process.env.SYNC_GOOGLE_DESKTOP_ID,
  client_secret: process.env.SYNC_GOOGLE_DESKTOP_SECRET,
  // Google OAuth for native app only allows loopback IP address for callback URL.
  // The URL will be intercepted and blocked so the port doesn't matter.
  redirect_uri: 'http://127.0.0.1:45678/',
  // redirect_uri: VM_HOME + 'auth_googledrive.html',
  scope: 'https://www.googleapis.com/auth/drive.appdata',
};

const GoogleDrive = BaseService.extend({
  name: 'googledrive',
  displayName: 'Google Drive',
  urlPrefix: 'https://www.googleapis.com/drive/v3',
  async requestAuth() {
    let code = INIT_SUCCESS;
    let error;
    try {
      const res = await this.loadData({
        url: `https://www.googleapis.com/oauth2/v3/tokeninfo?${dumpQuery({
          access_token: this.config.get('token'),
        })}`,
        responseType: 'json',
      });
      if (res.scope !== config.scope) code = INIT_RETRY;
    } catch (err) {
      error = err;
      code = INIT_ERROR;
      if (
        err.status === 400 &&
        objectGet(err, 'data.error_description') === 'Invalid Value'
      ) {
        code = INIT_RETRY;
      }
    }
    return { code, error };
  },
  async getSyncData() {
    const params = {
      spaces: 'appDataFolder',
      fields: 'files(id,name,size),nextPageToken',
    };
    let files = [];
    while (true) {
      const result = await this.loadData({
        url: `/files?${dumpQuery(params)}`,
        responseType: 'json',
      });
      files = [...files, ...result.files];
      params.pageToken = result.nextPageToken;
      if (!params.pageToken) break;
    }
    let metaFile;
    const remoteData = files
      .filter((item) => {
        if (isScriptFile(item.name)) return true;
        if (!metaFile && item.name === this.metaFile) {
          metaFile = item;
        } else {
          this.remove(item);
        }
        return false;
      })
      .map(normalize)
      .filter((item) => {
        if (!item.size) {
          this.remove(item);
          return false;
        }
        return true;
      });
    const metaItem = metaFile ? normalize(metaFile) : {};
    const gotMeta = this.get(metaItem)
      .then((data) => JSON.parse(data))
      .catch((err) => this.metaError(err))
      .then((data) =>
        Object.assign({}, metaItem, {
          name: this.metaFile,
          uri: null,
          data,
        }),
      );
    return Promise.all([gotMeta, remoteData, this.getLocalData()]);
  },
  async authorize() {
    this.session = {
      state: getUniqId(),
      codeVerifier: getCodeVerifier(),
    };
    const params = {
      response_type: 'code',
      client_id: config.client_id,
      redirect_uri: config.redirect_uri,
      scope: config.scope,
      state: this.session.state,
      ...(await getCodeChallenge(this.session.codeVerifier)),
    };
    if (!this.config.get('refresh_token')) params.prompt = 'consent';
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${dumpQuery(
      params,
    )}`;
    openAuthPage(url, config.redirect_uri);
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
      token: null,
      refresh_token: null,
    });
    return this.prepare();
  },
  async authorized(params) {
    const data = await this.loadData({
      method: 'POST',
      url: 'https://www.googleapis.com/oauth2/v4/token',
      prefix: '',
      headers: {
        'Content-Type': FORM_URLENCODED,
      },
      body: dumpQuery(
        Object.assign(
          {},
          {
            client_id: config.client_id,
            client_secret: config.client_secret,
          },
          params,
        ),
      ),
      responseType: 'json',
    });
    if (!data.access_token) throw data;
    this.config.set({
      token: data.access_token,
      refresh_token: data.refresh_token || params.refresh_token,
    });
  },
  list() {
    throw new Error('Not supported');
  },
  get({ id }) {
    if (!id) throw new Error('Invalid file ID');
    return this.loadData({
      url: `/files/${id}?alt=media`,
    });
  },
  put(item, data) {
    const name = getItemFilename(item);
    const { id } = item;
    const boundary = getUniqId('violentmonkey-is-great-');
    const headers = {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    };
    const metadata = id
      ? {
          name,
        }
      : {
          name,
          parents: ['appDataFolder'],
        };
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; ' + CHARSET_UTF8,
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: text/plain',
      '',
      data,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const url = id
      ? `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    return this.loadData({
      url,
      body,
      headers,
      method: id ? 'PATCH' : 'POST',
    });
  },
  remove({ id }) {
    return this.loadData({
      method: 'DELETE',
      url: `/files/${id}`,
    });
  },
});
if (config.client_id && config.client_secret) register(GoogleDrive);

function normalize(item) {
  return {
    id: item.id,
    name: item.name,
    size: +item.size,
    uri: getURI(item.name),
  };
}
