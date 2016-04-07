setTimeout(function () {
  var config = {
    client_id: '000000004418358A',
    redirect_uri: 'https://violentmonkey.github.io/auth_onedrive.html',
  };

  function authenticate() {
    var params = {
      response_type: 'token',
      client_id: config.client_id,
      redirect_uri: config.redirect_uri,
      scope: 'onedrive.appfolder',
    };
    var url = 'https://login.live.com/oauth20_authorize.srf';
    var qs = searchParams.dump(params);
    url += '?' + qs;
    chrome.tabs.create({url: url});
  }
  function checkAuthenticate(url) {
    var redirect_uri = config.redirect_uri + '#';
    if (url.slice(0, redirect_uri.length) === redirect_uri) {
      authorized(url.slice(redirect_uri.length));
      return true;
    }
  }
  function authorized(raw) {
    var data = searchParams.load(raw);
    if (data.access_token) {
      onedrive.config.set({
        uid: data.user_id,
        token: data.access_token,
      });
      onedrive.prepare();
    }
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
    user: function () {
      return this.request({
        url: '/drive',
      });
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
        url: '/drive/special/approot:/' + encodeURIComponent(path) + ':/content',
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
      });
    },
    authenticate: authenticate,
    checkAuthenticate: checkAuthenticate,
  });
  var onedrive = sync.service('onedrive', OneDrive);
});
