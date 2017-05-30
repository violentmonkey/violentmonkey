// Reference: https://dev.onedrive.com/README.htm
import { object, noop } from 'src/common';
import { dumpQuery } from '../utils';
import { BaseService, isScriptFile, register, getURI } from './base';

const config = Object.assign({
  client_id: '000000004418358A',
  redirect_uri: 'https://violentmonkey.github.io/auth_onedrive.html',
}, JSON.parse(
  // assume this is secret
  window.atob('eyJjbGllbnRfc2VjcmV0Ijoiajl4M09WRXRIdmhpSEtEV09HcXV5TWZaS2s5NjA0MEgifQ=='),
));

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
    .catch(res => {
      if (res.status === 401) {
        return this.refreshToken().then(requestUser);
      }
      throw res;
    })
    .catch(res => {
      if (res.status === 400 && object.get(res, ['data', 'error']) === 'invalid_grant') {
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
  getMeta() {
    const getMeta = () => BaseService.prototype.getMeta.call(this);
    return getMeta()
    .catch(res => {
      if (res.status === 404) {
        const header = res.xhr.getResponseHeader('WWW-Authenticate') || '';
        if (/^Bearer realm="OneDriveAPI"/.test(header)) {
          return this.refreshToken().then(getMeta);
        }
        return {};
      }
      throw res;
    });
  },
  list() {
    return this.loadData({
      url: '/drive/special/approot/children',
      responseType: 'json',
    })
    .then(data => data.value.filter(item => item.file && isScriptFile(item.name)).map(normalize));
  },
  get(path) {
    return this.loadData({
      url: `/drive/special/approot:/${encodeURIComponent(path)}`,
      responseType: 'json',
    })
    .then(data => this.loadData({
      url: data['@content.downloadUrl'],
      delay: false,
    }));
  },
  put(path, data) {
    return this.loadData({
      method: 'PUT',
      url: `/drive/special/approot:/${encodeURIComponent(path)}:/content`,
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: data,
      responseType: 'json',
    })
    .then(normalize);
  },
  remove(path) {
    // return 204
    return this.loadData({
      method: 'DELETE',
      url: `/drive/special/approot:/${encodeURIComponent(path)}`,
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
    browser.tabs.create({ url });
  },
  checkAuth(url) {
    const redirectUri = `${config.redirect_uri}?code=`;
    if (url.startsWith(redirectUri)) {
      this.authState.set('authorizing');
      this.authorized({
        code: url.slice(redirectUri.length),
      })
      .then(() => this.checkSync());
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
    .then(data => {
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
    size: item.size,
    uri: getURI(item.name),
    // modified: new Date(item.lastModifiedDateTime).getTime(),
  };
}
