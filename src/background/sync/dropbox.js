define('sync_dropbox', function (require, _exports, _module) {
  var sync = require('sync');
  var tabsUtils = require('utils/tabs');
  var searchUtils = require('utils/search');
  var config = {
    client_id: 'f0q12zup2uys5w8',
    redirect_uri: 'https://violentmonkey.github.io/auth_dropbox.html',
  };

  function authenticate() {
    var params = {
      response_type: 'token',
      client_id: config.client_id,
      redirect_uri: config.redirect_uri,
    };
    var url = 'https://www.dropbox.com/1/oauth2/authorize';
    var qs = searchUtils.dump(params);
    url += '?' + qs;
    tabsUtils.create(url);
  }
  function checkAuthenticate(url) {
    var redirect_uri = config.redirect_uri + '#';
    if (url.slice(0, redirect_uri.length) === redirect_uri) {
      authorized(url.slice(redirect_uri.length));
      dropbox.checkSync();
      return true;
    }
  }
  function authorized(raw) {
    var data = searchUtils.load(raw);
    if (data.access_token) {
      dropbox.config.set({
        uid: data.uid,
        token: data.access_token,
      });
    }
  }
  function normalize(item) {
    return {
      size: item.size,
      uri: sync.utils.getURI(item.name),
      modified: new Date(item.server_modified).getTime(),
      //is_deleted: item.is_deleted,
    };
  }

  var Dropbox = sync.BaseService.extend({
    name: 'dropbox',
    displayName: 'Dropbox',
    user: function () {
      return this.request({
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/users/get_current_account',
      });
    },
    getMeta: function () {
      return sync.BaseService.prototype.getMeta.call(this)
      .catch(function (res) {
        if (res.status === 409) return {};
        throw res;
      });
    },
    list: function () {
      var _this = this;
      return _this.request({
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/files/list_folder',
        body: {
          path: '',
        },
      }).then(function (text) {
        return JSON.parse(text);
      }).then(function (data) {
        return data.entries.filter(function (item) {
          return item['.tag'] === 'file' && sync.utils.isScriptFile(item.name);
        }).map(normalize);
      });
    },
    get: function (path) {
      return this.request({
        method: 'POST',
        url: 'https://content.dropboxapi.com/2/files/download',
        headers: {
          'Dropbox-API-Arg': JSON.stringify({
            path: '/' + path,
          }),
        },
      });
    },
    put: function (path, data) {
      return this.request({
        method: 'POST',
        url: 'https://content.dropboxapi.com/2/files/upload',
        headers: {
          'Dropbox-API-Arg': JSON.stringify({
            path: '/' + path,
            mode: 'overwrite',
          }),
          'Content-Type': 'application/octet-stream',
        },
        body: data,
      }).then(function (text) {
        return JSON.parse(text);
      }).then(normalize);
    },
    remove: function (path) {
      return this.request({
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/files/delete',
        body: {
          path: '/' + path,
        },
      }).then(function (text) {
        return JSON.parse(text);
      }).then(normalize);
    },
    authenticate: authenticate,
    checkAuthenticate: checkAuthenticate,
  });
  var dropbox = sync.service('dropbox', Dropbox);
});
