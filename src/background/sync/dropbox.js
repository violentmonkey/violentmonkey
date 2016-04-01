setTimeout(function () {
  var config = {
    client_id: 'f0q12zup2uys5w8',
    redirect_uri: 'https://violentmonkey.github.io/auth_dropbox.html',
  };
  var events = getEventEmitter();
  var dropbox = sync.service('dropbox', {
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
    dropbox.status.set('initializing');
    var token = dropbox.config.get('token');
    if (token) {
      dropbox.inst = new Dropbox(token);
      dropbox.inst.fetch('https://api.dropboxapi.com/1/account/info')
      .then(function (res) {
        dropbox.status.set('authorized');
        events.fire('init');
        //return res.json();
      }, function (res) {
        if (res.status > 300) {
          dropbox.inst = null;
          dropbox.config.clear();
          dropbox.status.set('unauthorized');
        }
        dropbox.config.setOption('enabled', false);
      });
    } else {
      dropbox.status.set('unauthorized');
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
      bytes: item.bytes,
      uri: decodeURIComponent(item.path.slice(1, -8)),
      modified: new Date(item.modified).getTime(),
      //is_deleted: item.is_deleted,
    };
  }

  // When path is encoded in URL directly,
  // we MUST encodeURIComponent twice to ensure the filename has no slashes
  function Dropbox(token) {
    this.token = token;
    this.headers = {
      Authorization: 'Bearer ' + token,
    };
  }
  Dropbox.prototype.fetch = function (input, init) {
    init = init || {};
    init.headers = _.assign(init.headers || {}, this.headers);
    return fetch(input, init)
    .then(function (res) {
      return new Promise(function (resolve, reject) {
        res.status > 300 ? reject(res) : resolve(res);
      });
    });
  };
  Dropbox.prototype.put = function (path, data) {
    path = encodeURIComponent(path);
    return this.fetch('https://content.dropboxapi.com/1/files_put/auto/' + path, {
      method: 'PUT',
      body: data,
    }).then(function (res) {
      return res.json()
    }).then(normalize);
  };
  Dropbox.prototype.get = function (path) {
    path = encodeURIComponent(path);
    return this.fetch('https://content.dropboxapi.com/1/files/auto/' + path)
    .then(function (res) {
      return res.text();
    });
  };
  Dropbox.prototype.remove = function (path) {
    return this.fetch('https://api.dropboxapi.com/1/fileops/delete', {
      method: 'POST',
      headers: {
        'Content-type': 'application/x-www-form-urlencoded',
      },
      body: searchParams.dump({
        root: 'auto',
        path: path,
      }),
    }).then(function (res) {
      return res.json();
    }).then(normalize);
  };
  Dropbox.prototype.list = function () {
    var _this = this;
    //return _this.fetch('https://api.dropboxapi.com/1/metadata/auto/?include_deleted=true')
    return _this.fetch('https://api.dropboxapi.com/1/metadata/auto/')
    .then(function (res) {
      return res.json();
    })
    .then(function (data) {
      return data.contents.filter(function (item) {
        return !item.is_dir && /\.user\.js$/.test(item.path);
      }).map(normalize);
    });
  };
});
