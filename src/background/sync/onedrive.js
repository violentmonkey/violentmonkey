setTimeout(function () {
  var config = _.assign({
    client_id: '000000004418358A',
    redirect_uri: 'https://violentmonkey.github.io/auth_onedrive.html',
  }, JSON.parse(
    // assume this is secret
    window.atob('eyJjbGllbnRfc2VjcmV0Ijoiajl4M09WRXRIdmhpSEtEV09HcXV5TWZaS2s5NjA0MEgifQ==')
  ));

  function authenticate() {
    var params = {
      response_type: 'code',
      client_id: config.client_id,
      redirect_uri: config.redirect_uri,
      scope: 'onedrive.appfolder wl.offline_access',
    };
    var url = 'https://login.live.com/oauth20_authorize.srf';
    var qs = searchParams.dump(params);
    url += '?' + qs;
    _.tabs.create(url);
  }
  function checkAuthenticate(url) {
    var redirect_uri = config.redirect_uri + '?code=';
    if (url.slice(0, redirect_uri.length) === redirect_uri) {
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
      body: searchParams.dump(_.assign({}, {
        client_id: config.client_id,
        client_secret: config.client_secret,
        redirect_uri: config.redirect_uri,
        grant_type: 'authorization_code',
      }, params)),
    }).then(function (text) {
      var data = JSON.parse(text);
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
  function normalize(item) {
    return {
      size: item.size,
      uri: sync.utils.getURI(item.name),
      modified: new Date(item.lastModifiedDateTime).getTime(),
    };
  }

  var OneDrive = sync.BaseService.extend({
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
      var _this = this;
      return requestUser()
      .catch(function (res) {
        if (res.status === 401) {
          return _this.refreshToken().then(requestUser);
        }
        throw res;
      });
      function requestUser() {
        return _this.request({
          url: '/drive',
        });
      }
    },
    getMeta: function () {
      var _this = this;
      return getMeta()
      .catch(function (res) {
        if (res.status === 404) {
          var header = res.getResponseHeader('WWW-Authenticate') || '';
          if (/^Bearer realm="OneDriveAPI"/.test(header)) {
            return _this.refreshToken().then(getMeta);
          } else {
            return {};
          }
        }
        throw res;
      });
      function getMeta() {
        return _this.get(_this.metaFile)
        .then(function (data) {
          return JSON.parse(data);
        });
      }
    },
    list: function () {
      var _this = this;
      return _this.request({
        url: '/drive/special/approot/children',
      }).then(function (text) {
        return JSON.parse(text);
      }).then(function (data) {
        return data.value.filter(function (item) {
          return item.file && sync.utils.isScriptFile(item.name);
        }).map(normalize);
      });
    },
    get: function (path) {
      return this.request({
        url: '/drive/special/approot:/' + encodeURIComponent(path),
      }).then(function (text) {
        return JSON.parse(text);
      }).then(function (data) {
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
      }).then(function (text) {
        return JSON.parse(text);
      }).then(normalize);
    },
    remove: function (path) {
      // return 204
      return this.request({
        method: 'DELETE',
        url: '/drive/special/approot:/' + encodeURIComponent(path),
      }).catch(_.noop);
    },
    authenticate: authenticate,
    checkAuthenticate: checkAuthenticate,
  });
  var onedrive = sync.service('onedrive', OneDrive);
});
