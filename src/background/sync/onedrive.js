// References
// - https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
//
// Note:
// - SPA refresh tokens expire after 24h, but each refresh operation returns a new refresh_token, extending the expiration.
// - Browser extensions cannot use the native app authorization flow due to Microsoft's restrictions.
import { dumpQuery, getUniqId, loadQuery, noop } from '@/common';
import { FORM_URLENCODED, VM_HOME } from '@/common/consts';
import { objectGet } from '@/common/object';
import {
  BaseService,
  getCodeChallenge,
  getCodeVerifier,
  getItemFilename,
  getURI,
  INIT_ERROR,
  INIT_RETRY,
  INIT_UNAUTHORIZED,
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
  async requestAuth() {
    try {
      await this.loadData({
        url: '/drive/special/approot',
        responseType: 'json',
      });
    } catch (err) {
      let code = INIT_ERROR;
      if (err.status === 401) {
        code = INIT_RETRY;
      } else if (
        err.status === 400 &&
        objectGet(err, 'data.error') === 'invalid_grant'
      ) {
        code = INIT_UNAUTHORIZED;
      }
      return { code, error: err };
    }
  },
  async list() {
    let files = [];
    let url = '/drive/special/approot/children';
    while (url) {
      const data = await this.loadData({
        url,
        responseType: 'json',
      });
      url = data['@odata.nextLink'] || '';
      files = [
        ...files,
        ...data.value
          .filter((item) => item.file && isScriptFile(item.name))
          .map(normalize),
      ];
    }
    return files;
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
  async authorized(params) {
    const data = await this.loadData({
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
    });
    if (!data.access_token) throw data;
    this.config.set({
      token: data.access_token,
      refresh_token: data.refresh_token || params.refresh_token,
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
