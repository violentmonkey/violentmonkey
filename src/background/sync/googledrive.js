// Reference:
// - https://developers.google.com/identity/protocols/oauth2/native-app
// - https://developers.google.com/drive/v3/reference/files
import { dumpQuery, getUniqId, loadQuery, noop } from '@/common';
import { CHARSET_UTF8, FORM_URLENCODED } from '@/common/consts';
import { objectGet } from '@/common/object';
import {
  getURI, getItemFilename, BaseService, register, isScriptFile,
  openAuthPage,
  getCodeVerifier,
  getCodeChallenge,
} from './base';

const config = {
  client_id: process.env.SYNC_GOOGLE_DESKTOP_ID,
  client_secret: process.env.SYNC_GOOGLE_DESKTOP_SECRET,
  // We use native app approach with code challenge for better security.
  // Google OAuth for native app only allows loopback IP address for callback URL.
  // The URL will be intercepted and blocked so the port doesn't matter.
  redirect_uri: 'http://127.0.0.1:45678/',
  // redirect_uri: VM_HOME + 'auth_googledrive.html',
  scope: 'https://www.googleapis.com/auth/drive.appdata',
};
const UNAUTHORIZED = { status: 'UNAUTHORIZED' };

const GoogleDrive = BaseService.extend({
  name: 'googledrive',
  displayName: 'Google Drive',
  urlPrefix: 'https://www.googleapis.com/drive/v3',
  refreshToken() {
    const refreshToken = this.config.get('refresh_token');
    if (!refreshToken) return Promise.reject({ type: 'unauthorized' });
    return this.authorized({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
    .then(() => this.prepare());
  },
  user() {
    const requestUser = () => this.loadData({
      url: `https://www.googleapis.com/oauth2/v3/tokeninfo?${dumpQuery({
        access_token: this.config.get('token'),
      })}`,
      responseType: 'json',
    });
    return requestUser()
    .then((info) => {
      if (info.scope !== config.scope) return Promise.reject(UNAUTHORIZED);
    })
    .catch((res) => {
      if (res === UNAUTHORIZED || res.status === 400 && objectGet(res, 'data.error_description') === 'Invalid Value') {
        return this.refreshToken().then(requestUser);
      }
      return Promise.reject({
        type: 'error',
        data: res,
      });
    });
  },
  getSyncData() {
    const params = {
      spaces: 'appDataFolder',
      fields: 'files(id,name,size)',
    };
    return this.loadData({
      url: `/files?${dumpQuery(params)}`,
      responseType: 'json',
    })
    .then(({ files }) => {
      let metaFile;
      const remoteData = files.filter((item) => {
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
      .then(data => JSON.parse(data))
      .catch(err => this.handleMetaError(err))
      .then(data => Object.assign({}, metaItem, {
        name: this.metaFile,
        uri: null,
        data,
      }));
      return Promise.all([gotMeta, remoteData, this.getLocalData()]);
    });
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
      ...await getCodeChallenge(this.session.codeVerifier),
    };
    if (!this.config.get('refresh_token')) params.prompt = 'consent';
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${dumpQuery(params)}`;
    openAuthPage(url, config.redirect_uri);
  },
  checkAuth(url) {
    const redirectUri = `${config.redirect_uri}?`;
    if (!url.startsWith(redirectUri)) return;
    const query = loadQuery(url.slice(redirectUri.length));
    const { state, codeVerifier } = this.session || {};
    this.session = null;
    if (query.state !== state || !query.code) return;
    this.authState.set('authorizing');
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
      token: null,
      refresh_token: null,
    });
    return this.prepare();
  },
  authorized(params) {
    return this.loadData({
      method: 'POST',
      url: 'https://www.googleapis.com/oauth2/v4/token',
      prefix: '',
      headers: {
        'Content-Type': FORM_URLENCODED,
      },
      body: dumpQuery(Object.assign({}, {
        client_id: config.client_id,
        client_secret: config.client_secret,
      }, params)),
      responseType: 'json',
    })
    .then((data) => {
      if (data.access_token) {
        const update = {
          token: data.access_token,
        };
        if (data.refresh_token) {
          update.refresh_token = data.refresh_token;
        }
        this.config.set(update);
      } else {
        throw data;
      }
    });
  },
  handleMetaError: noop,
  list() {
    throw new Error('Not supported');
  },
  get({ id }) {
    if (!id) return Promise.reject();
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
    const metadata = id ? {
      name,
    } : {
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
register(GoogleDrive);

function normalize(item) {
  return {
    id: item.id,
    name: item.name,
    size: +item.size,
    uri: getURI(item.name),
  };
}
