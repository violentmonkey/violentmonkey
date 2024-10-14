// Reference: https://dev.onedrive.com/README.htm
import { dumpQuery, noop } from '@/common';
import { FORM_URLENCODED, VM_HOME } from '@/common/consts';
import { objectGet } from '@/common/object';
import {
  getURI, getItemFilename, BaseService, isScriptFile, register,
  openAuthPage,
} from './base';

const config = {
  client_id: process.env.SYNC_ONEDRIVE_CLIENT_ID,
  client_secret: process.env.SYNC_ONEDRIVE_CLIENT_SECRET,
  redirect_uri: VM_HOME + 'auth_onedrive.html',
};

const OneDrive = BaseService.extend({
  name: 'onedrive',
  displayName: 'OneDrive',
  urlPrefix: 'https://api.onedrive.com/v1.0',
  refreshToken() {
    const refreshToken = this.config.get('refresh_token');
    return this.authorized({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
    .then(() => this.prepare());
  },
  user() {
    const requestUser = () => this.loadData({
      url: '/drive',
      responseType: 'json',
    });
    return requestUser()
    .catch((res) => {
      if (res.status === 401) {
        return this.refreshToken().then(requestUser);
      }
      throw res;
    })
    .catch((res) => {
      if (res.status === 400 && objectGet(res, 'data.error') === 'invalid_grant') {
        return Promise.reject({
          type: 'unauthorized',
        });
      }
      return Promise.reject({
        type: 'error',
        data: res,
      });
    });
  },
  handleMetaError(res) {
    if (res.status === 404) {
      const header = res.headers.get('WWW-Authenticate')?.[0] || '';
      if (/^Bearer realm="OneDriveAPI"/.test(header)) {
        return this.refreshToken().then(() => this.getMeta());
      }
      return;
    }
    throw res;
  },
  list() {
    return this.loadData({
      url: '/drive/special/approot/children',
      responseType: 'json',
    })
    .then(data => data.value.filter(item => item.file && isScriptFile(item.name)).map(normalize));
  },
  get(item) {
    const name = getItemFilename(item);
    return this.loadData({
      url: `/drive/special/approot:/${encodeURIComponent(name)}`,
      responseType: 'json',
    })
    .then(data => this.loadData({
      url: data['@content.downloadUrl'],
      delay: false,
    }));
  },
  put(item, data) {
    const name = getItemFilename(item);
    return this.loadData({
      method: 'PUT',
      url: `/drive/special/approot:/${encodeURIComponent(name)}:/content`,
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: data,
      responseType: 'json',
    })
    .then(normalize);
  },
  remove(item) {
    // return 204
    const name = getItemFilename(item);
    return this.loadData({
      method: 'DELETE',
      url: `/drive/special/approot:/${encodeURIComponent(name)}`,
    })
    .catch(noop);
  },
  authorize() {
    const params = {
      client_id: config.client_id,
      scope: 'onedrive.appfolder wl.offline_access',
      response_type: 'code',
      redirect_uri: config.redirect_uri,
    };
    const url = `https://login.live.com/oauth20_authorize.srf?${dumpQuery(params)}`;
    openAuthPage(url, config.redirect_uri);
  },
  checkAuth(url) {
    const redirectUri = `${config.redirect_uri}?code=`;
    if (url.startsWith(redirectUri)) {
      this.authState.set('authorizing');
      this.checkSync(this.authorized({
        code: url.slice(redirectUri.length),
      }));
      return true;
    }
  },
  revoke() {
    this.config.set({
      uid: null,
      token: null,
      refresh_token: null,
    });
    return this.prepare();
  },
  authorized(params) {
    return this.loadData({
      method: 'POST',
      url: 'https://login.live.com/oauth20_token.srf',
      prefix: '',
      headers: {
        'Content-Type': FORM_URLENCODED,
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
        this.config.set({
          uid: data.user_id,
          token: data.access_token,
          refresh_token: data.refresh_token,
        });
      } else {
        throw data;
      }
    });
  },
});
register(OneDrive);

function normalize(item) {
  return {
    name: item.name,
    size: item.size,
    uri: getURI(item.name),
    // modified: new Date(item.lastModifiedDateTime).getTime(),
  };
}
