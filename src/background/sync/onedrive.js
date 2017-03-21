// Reference: https://dev.onedrive.com/README.htm

var _ = require('src/common');
var base = require('./base');
var searchUtils = require('../utils/search');

var config = Object.assign({
  client_id: '000000004418358A',
  redirect_uri: 'https://violentmonkey.github.io/auth_onedrive.html',
}, JSON.parse(
  // assume this is secret
  window.atob('eyJjbGllbnRfc2VjcmV0Ijoiajl4M09WRXRIdmhpSEtEV09HcXV5TWZaS2s5NjA0MEgifQ==')
));

function authorize() {
  var params = {
    client_id: config.client_id,
    scope: 'onedrive.appfolder wl.offline_access',
    response_type: 'code',
    redirect_uri: config.redirect_uri,
  };
  var url = 'https://login.live.com/oauth20_authorize.srf';
  var qs = searchUtils.dump(params);
  url += '?' + qs;
  browser.tabs.create({url: url});
}
function checkAuth(url) {
  var redirect_uri = config.redirect_uri + '?code=';
  if (url.startsWith(redirect_uri)) {
    onedrive.authState.set('authorizing');
    authorized({
      code: url.slice(redirect_uri.length),
    }).then(function () {
      onedrive.checkSync();
    });
    return true;
  }
}
function authorized(params) {
  return onedrive.request({
    method: 'POST',
    url: 'https://login.live.com/oauth20_token.srf',
    prefix: '',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: searchUtils.dump(Object.assign({}, {
      client_id: config.client_id,
      client_secret: config.client_secret,
      redirect_uri: config.redirect_uri,
      grant_type: 'authorization_code',
    }, params)),
    responseType: 'json',
  })
  .then(function (data) {
    if (data.access_token) {
      onedrive.config.set({
        uid: data.user_id,
        token: data.access_token,
        refresh_token: data.refresh_token,
      });
    } else {
      throw data;
    }
  });
}
function revoke() {
  onedrive.config.set({
    uid: null,
    token: null,
    refresh_token: null,
  });
}
function normalize(item) {
  return {
    size: item.size,
    uri: base.utils.getURI(item.name),
    modified: new Date(item.lastModifiedDateTime).getTime(),
  };
}

var OneDrive = base.BaseService.extend({
  name: 'onedrive',
  displayName: 'OneDrive',
  urlPrefix: 'https://api.onedrive.com/v1.0',
  refreshToken: function () {
    var _this = this;
    var refresh_token = _this.config.get('refresh_token');
    return authorized({
      refresh_token: refresh_token,
      grant_type: 'refresh_token',
    }).then(function () {
      return _this.prepare();
    });
  },
  user: function () {
    function requestUser() {
      return _this.request({
        url: '/drive',
        responseType: 'json',
      });
    }
    var _this = this;
    return requestUser()
    .catch(function (res) {
      if (res.status === 401) {
        return _this.refreshToken().then(requestUser);
      }
      throw res;
    })
    .catch(function (res) {
      if (res.status === 400 && _.object.get(res, ['data', 'error']) === 'invalid_grant') {
        throw {
          type: 'unauthorized',
        };
      }
      throw {
        type: 'error',
        data: res,
      };
    });
  },
  getMeta: function () {
    function getMeta() {
      return base.BaseService.prototype.getMeta.call(_this);
    }
    var _this = this;
    return getMeta()
    .catch(function (res) {
      if (res.status === 404) {
        var header = res.xhr.getResponseHeader('WWW-Authenticate') || '';
        if (/^Bearer realm="OneDriveAPI"/.test(header)) {
          return _this.refreshToken().then(getMeta);
        } else {
          return {};
        }
      }
      throw res;
    });
  },
  list: function () {
    var _this = this;
    return _this.request({
      url: '/drive/special/approot/children',
      responseType: 'json',
    })
    .then(function (data) {
      return data.value.filter(function (item) {
        return item.file && base.utils.isScriptFile(item.name);
      }).map(normalize);
    });
  },
  get: function (path) {
    return this.request({
      url: '/drive/special/approot:/' + encodeURIComponent(path),
      responseType: 'json',
    })
    .then(function (data) {
      var url = data['@content.downloadUrl'];
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest;
        xhr.open('GET', url, true);
        xhr.onload = function () {
          resolve(xhr.responseText);
        };
        xhr.onerror = function () {
          reject();
        };
        xhr.ontimeout = function () {
          reject();
        };
        xhr.send();
      });
    });
  },
  put: function (path, data) {
    return this.request({
      method: 'PUT',
      url: '/drive/special/approot:/' + encodeURIComponent(path) + ':/content',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: data,
      responseType: 'json',
    })
    .then(normalize);
  },
  remove: function (path) {
    // return 204
    return this.request({
      method: 'DELETE',
      url: '/drive/special/approot:/' + encodeURIComponent(path),
    }).catch(_.noop);
  },
  authorize: authorize,
  checkAuth: checkAuth,
  revoke: function () {
    revoke();
    return this.prepare();
  },
});
var onedrive = base.register(OneDrive);
