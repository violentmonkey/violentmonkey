var base = require('./base');
var searchUtils = require('../utils/search');
var config = {
  client_id: 'f0q12zup2uys5w8',
  redirect_uri: 'https://violentmonkey.github.io/auth_dropbox.html',
};

function authorize() {
  var params = {
    response_type: 'token',
    client_id: config.client_id,
    redirect_uri: config.redirect_uri,
  };
  var url = 'https://www.dropbox.com/oauth2/authorize';
  var qs = searchUtils.dump(params);
  url += '?' + qs;
  browser.tabs.create({url: url});
}
function checkAuth(url) {
  var redirect_uri = config.redirect_uri + '#';
  if (url.startsWith(redirect_uri)) {
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
function revoke() {
  dropbox.config.set({
    uid: null,
    token: null,
  });
}
function normalize(item) {
  return {
    size: item.size,
    uri: base.utils.getURI(item.name),
    modified: new Date(item.server_modified).getTime(),
    // is_deleted: item.is_deleted,
  };
}

var Dropbox = base.BaseService.extend({
  name: 'dropbox',
  displayName: 'Dropbox',
  user: function () {
    return this.request({
      method: 'POST',
      url: 'https://api.dropboxapi.com/2/users/get_current_account',
    })
    .catch(function (err) {
      if (err.status === 401) {
        throw {
          type: 'unauthorized',
        };
      }
      throw {
        type: 'error',
        data: err,
      };
    });
  },
  getMeta: function () {
    return base.BaseService.prototype.getMeta.call(this)
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
      responseType: 'json',
    })
    .then(function (data) {
      return data.entries.filter(function (item) {
        return item['.tag'] === 'file' && base.utils.isScriptFile(item.name);
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
      responseType: 'json',
    })
    .then(normalize);
  },
  remove: function (path) {
    return this.request({
      method: 'POST',
      url: 'https://api.dropboxapi.com/2/files/delete',
      body: {
        path: '/' + path,
      },
      responseType: 'json',
    })
    .then(normalize);
  },
  authorize: authorize,
  checkAuth: checkAuth,
  revoke: function () {
    revoke();
    return this.prepare();
  },
});
var dropbox = base.register(Dropbox);
