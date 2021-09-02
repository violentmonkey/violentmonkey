// Reference:
// - https://developers.google.com/drive/v3/reference/files
// - https://github.com/google/google-api-nodejs-client
import { getUniqId, noop } from '#/common';
import { objectGet } from '#/common/object';
import { dumpQuery, notify } from '../utils';
import {
  getURI, getItemFilename, BaseService, register, isScriptFile,
  openAuthPage,
} from './base';

const config = {
  client_id: process.env.SYNC_GOOGLE_CLIENT_ID,
  client_secret: process.env.SYNC_GOOGLE_CLIENT_SECRET,
  redirect_uri: 'https://violentmonkey.github.io/auth_googledrive.html',
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
      // If access was granted with access_type=online, revoke it.
      if (info.access_type === 'online') {
        return this.loadData({
          method: 'POST',
          url: `https://accounts.google.com/o/oauth2/revoke?token=${this.config.get('token')}`,
          prefix: '',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        })
        .then(() => {
          notify({
            title: 'Sync Upgraded',
            body: 'Please reauthorize access to your Google Drive to complete the upgradation.',
          });
          return Promise.reject('Online access revoked.');
        });
      }
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
  authorize() {
    const params = {
      response_type: 'code',
      access_type: 'offline',
      client_id: config.client_id,
      redirect_uri: config.redirect_uri,
      scope: config.scope,
    };
    if (!this.config.get('refresh_token')) params.prompt = 'consent';
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${dumpQuery(params)}`;
    openAuthPage(url, config.redirect_uri);
  },
  checkAuth(url) {
    const redirectUri = `${config.redirect_uri}?code=`;
    if (url.startsWith(redirectUri)) {
      this.authState.set('authorizing');
      this.authorized({
        code: decodeURIComponent(url.split('#')[0].slice(redirectUri.length)),
      })
      .then(() => this.checkSync());
      return true;
    }
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
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: dumpQuery(Object.assign({}, {
        client_id: config.client_id,
        client_secret: config.client_secret,
        redirect_uri: config.redirect_uri,
        grant_type: 'authorization_code',
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
      'Content-Type: application/json; charset=UTF-8',
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
