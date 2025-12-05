// References
// - https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
import { dumpQuery, getUniqId, loadQuery, noop } from '@/common';
import { FORM_URLENCODED, VM_HOME } from '@/common/consts';
import { AUTHORIZING, ERROR, UNAUTHORIZED } from '@/common/consts-sync';
import { objectGet } from '@/common/object';
import {
  BaseService,
  getCodeChallenge,
  getCodeVerifier,
  getItemFilename,
  getURI,
  isScriptFile,
  openAuthPage,
  register,
} from './base';

const config = {
  client_id: process.env.SYNC_ONEDRIVE_CLIENT_ID,
  redirect_uri: VM_HOME + 'auth_onedrive.html',
};

const OneDrive = BaseService.extend({
  name: 'onedrive',
  displayName: 'OneDrive',
  urlPrefix: 'https://graph.microsoft.com/v1.0',
  refreshToken() {
    const refreshToken = this.config.get('refresh_token');
    return this.authorized({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).then(() => this.prepare());
  },
  user() {
    const requestUser = () =>
      this.loadData({
        url: '/drive/special/approot',
        responseType: 'json',
      });
    let unauthorized = false;
    return requestUser()
      .catch((res) => {
        if (!unauthorized && res.status === 401) {
          unauthorized = true;
          return this.refreshToken().then(requestUser);
        }
        throw res;
      })
      .catch((res) => {
        if (
          res.status === 400 &&
          objectGet(res, 'data.error') === 'invalid_grant'
        ) {
          return Promise.reject({
            type: UNAUTHORIZED,
          });
        }
        return Promise.reject({
          type: ERROR,
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
    }).then((data) =>
      data.value
        .filter((item) => item.file && isScriptFile(item.name))
        .map(normalize),
    );
  },
  get(item) {
    const name = getItemFilename(item);
    return this.loadData({
      url: `/drive/special/approot:/${encodeURIComponent(name)}:/content`,
    });
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
    }).then(normalize);
  },
  remove(item) {
    // return 204
    const name = getItemFilename(item);
    return this.loadData({
      method: 'DELETE',
      url: `/drive/special/approot:/${encodeURIComponent(name)}`,
    }).catch(noop);
  },
  async authorize() {
    this.session = {
      state: getUniqId(),
      codeVerifier: getCodeVerifier(),
    };
    const params = {
      client_id: config.client_id,
      scope: 'openid profile Files.ReadWrite.AppFolder offline_access',
      response_type: 'code',
      redirect_uri: config.redirect_uri,
      state: this.session.state,
      ...(await getCodeChallenge(this.session.codeVerifier)),
    };
    const url = `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${dumpQuery(
      params,
    )}`;
    openAuthPage(url, config.redirect_uri);
  },
  checkAuth(url) {
    const redirectUri = `${config.redirect_uri}?`;
    if (!url.startsWith(redirectUri)) return;
    const query = loadQuery(url.slice(redirectUri.length));
    const { state, codeVerifier } = this.session || {};
    this.session = null;
    if (query.state !== state || !query.code) return;
    if (url.startsWith(redirectUri)) {
      this.authState.set(AUTHORIZING);
      this.checkSync(
        this.authorized({
          code: query.code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: config.redirect_uri,
        }),
      );
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
      url: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      prefix: '',
      headers: {
        'Content-Type': FORM_URLENCODED,
      },
      body: dumpQuery(
        Object.assign(
          {
            client_id: config.client_id,
          },
          params,
        ),
      ),
      responseType: 'json',
    }).then((data) => {
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
if (config.client_id) register(OneDrive);

function normalize(item) {
  return {
    name: item.name,
    size: item.size,
    uri: getURI(item.name),
    // modified: new Date(item.lastModifiedDateTime).getTime(),
  };
}
