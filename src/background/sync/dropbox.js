setTimeout(function () {
  var config = {
    client_id: 'f0q12zup2uys5w8',
    redirect_uri: 'https://violentmonkey.github.io/auth_dropbox.html',
  };
  var events = getEventEmitter();
  var dropbox = sync.service('dropbox', {
    displayName: 'Dropbox',
    init: init,
    authenticate: authenticate,
    on: events.on,
  });

  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    var redirect_uri = config.redirect_uri + '#';
    var url = changeInfo.url;
    if (url && url.slice(0, redirect_uri.length) === redirect_uri) {
      authorized(url.slice(redirect_uri.length));
      chrome.tabs.remove(tabId);
    }
  });

  function init() {
    dropbox.inst = null;
    dropbox.authState.set('initializing');
    var token = dropbox.config.get('token');
    if (token) {
      dropbox.inst = new Dropbox(token);
      dropbox.inst.request({
        method: 'POST',
        url: 'https://api.dropboxapi.com/2/users/get_current_account',
      })
      .then(function (text) {
        dropbox.authState.set('authorized');
        events.fire('init');
      }, function (res) {
        if (res.status > 300) {
          dropbox.inst = null;
        }
        if (res.status === 401) {
          dropbox.config.clear();
          dropbox.authState.set('unauthorized');
        } else {
          dropbox.authState.set('error');
        }
        dropbox.syncState.set('error');
        dropbox.config.setOption('enabled', false);
      });
    } else {
      dropbox.authState.set('unauthorized');
    }
  }
  function authenticate() {
    var params = {
      response_type: 'token',
      client_id: config.client_id,
      redirect_uri: config.redirect_uri,
    };
    var url = 'https://www.dropbox.com/1/oauth2/authorize';
    var qs = searchParams.dump(params);
    url += '?' + qs;
    chrome.tabs.create({url: url});
  }
  function authorized(raw) {
    var data = searchParams.load(raw);
    if (data.access_token) {
      dropbox.config.set({
        uid: data.uid,
        token: data.access_token,
      });
      init();
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

  function Dropbox(token) {
    this.token = token;
    this.headers = {
      Authorization: 'Bearer ' + token,
    };
    this.lastFetch = Promise.resolve();
  }
  Dropbox.prototype.request = function (options) {
    var _this = this;
    var lastFetch = _this.lastFetch;
    _this.lastFetch = lastFetch.then(function () {
      return new Promise(function (resolve, reject) {
        setTimeout(resolve, 1000);
      });
    });
    return lastFetch.then(function () {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest;
        xhr.open(options.method || 'GET', options.url, true);
        var headers = _.assign({}, options.headers, _this.headers);
        if (options.body && typeof options.body === 'object') {
          headers['Content-Type'] = 'application/json';
          options.body = JSON.stringify(options.body);
        }
        for (var k in headers) {
          var v = headers[k];
          xhr.setRequestHeader(k, v);
        }
        xhr.timeout = 10 * 1000;
        xhr.onload = function () {
          if (this.status > 300) reject(this);
          else resolve(this.responseText);
        };
        xhr.onerror = function () {
          if (this.status === 503) {
            // TODO Too Many Requests
          }
          requestError();
        };
        xhr.ontimeout = function () {
          requestError('Timed out.');
        };
        xhr.send(options.body);

        function requestError(reason) {
          reject({
            url: xhr.url,
            status: xhr.status,
            reason: reason || xhr.responseText,
          });
        }
      });
    });
  };
  Dropbox.prototype.put = function (path, data) {
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
  };
  Dropbox.prototype.get = function (path) {
    return this.request({
      method: 'POST',
      url: 'https://content.dropboxapi.com/2/files/download',
      headers: {
        'Dropbox-API-Arg': JSON.stringify({
          path: '/' + path,
        }),
      },
    });
  };
  Dropbox.prototype.remove = function (path) {
    return this.request({
      method: 'POST',
      url: 'https://api.dropboxapi.com/2/files/delete',
      body: {
        path: '/' + path,
      },
    }).then(function (text) {
      return JSON.parse(text);
    }).then(normalize);
  };
  Dropbox.prototype.list = function () {
    var _this = this;
    return _this.request({
      method: 'POST',
      url: 'https://api.dropboxapi.com/2/files/list_folder',
      body: {
        path: '',
      },
    })
    .then(function (text) {
      return JSON.parse(text);
    })
    .then(function (data) {
      return data.entries.filter(function (item) {
        return item['.tag'] === 'file' && sync.utils.isScriptFile(item.name);
      }).map(normalize);
    });
  };
});
