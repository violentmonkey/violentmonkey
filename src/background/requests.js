var requests = function () {
  var requests = {};
  var verify = {};
  var special_headers = [
    'user-agent',
    'referer',
    'origin',
    'host',
  ];

  function getRequestId() {
    var id = _.getUniqId();
    requests[id] = {
      id: id,
      xhr: new XMLHttpRequest,
    };
    return id;
  }

  function xhrCallbackWrapper(req) {
    var lastPromise = Promise.resolve();
    var xhr = req.xhr;
    return function (evt) {
      var res = {
        id: req.id,
        type: evt.type,
        resType: xhr.responseType,
      };
      var data = res.data = {
        finalUrl: req.finalUrl,
        readyState: xhr.readyState,
        responseHeaders: xhr.getAllResponseHeaders(),
        status: xhr.status,
        statusText: xhr.statusText,
      };
      try {
        data.responseText = xhr.responseText;
      } catch (e) {}
      if (evt.type === 'loadend') clearRequest(req);
      return lastPromise = lastPromise.then(function () {
        return new Promise(function (resolve, reject) {
          if (xhr.response && xhr.responseType === 'blob') {
            var reader = new FileReader;
            reader.onload = function (e) {
              data.response = this.result;
              resolve();
            };
            reader.readAsDataURL(xhr.response);
          } else {
            // default `null` for blob and '' for text
            data.response = xhr.response;
            resolve();
          }
        });
      }).then(function () {
        req.cb && req.cb(res);
      });
    };
  }

  function httpRequest(details, cb) {
    var req = requests[details.id];
    if (!req || req.cb) return;
    req.cb = cb;
    var xhr = req.xhr;
    try {
      xhr.open(details.method, details.url, true, details.user, details.password);
      xhr.setRequestHeader('VM-Verify', details.id);
      if (details.headers) {
        for (var k in details.headers) {
          xhr.setRequestHeader(
            ~special_headers.indexOf(k.toLowerCase()) ? 'VM-' + k : k,
            details.headers[k]
          );
        }
      }
      if (details.responseType)
        xhr.responseType = 'blob';
      if (details.overrideMimeType)
        xhr.overrideMimeType(details.overrideMimeType);
      var callback = xhrCallbackWrapper(req);
      [
        'abort',
        'error',
        'load',
        'loadend',
        'progress',
        'readystatechange',
        'timeout',
      ].forEach(function (evt) {
        xhr['on' + evt] = callback;
      });
      req.finalUrl = details.url;
      xhr.send(details.data);
    } catch (e) {
      console.log(e);
    }
  }

  function clearRequest(req) {
    if (req.coreId) delete verify[req.coreId];
    delete requests[req.id];
  }

  function abortRequest(id) {
    var req = requests[id];
    if (req) req.xhr.abort();
    clearRequest(req);
  }

  // Watch URL redirects
  chrome.webRequest.onBeforeRedirect.addListener(function (details) {
    var reqId = verify[details.requestId];
    if (reqId) {
      var req = requests[reqId];
      if (req) req.finalUrl = details.redirectUrl;
    }
  }, {
    urls: ['<all_urls>'],
    types: ['xmlhttprequest'],
  });

  // Modifications on headers
  chrome.webRequest.onBeforeSendHeaders.addListener(function (details) {
    var headers = details.requestHeaders;
    var new_headers = [];
    var vm_headers = {};
    headers.forEach(function (header) {
      if (header.name.substr(0, 3) == 'VM-')
        vm_headers[header.name.slice(3)] = header.value;
      else
        new_headers.push(header);
    });
    var reqId = vm_headers['Verify'];
    if (reqId) {
      var req = requests[reqId];
      if (req) {
        delete vm_headers['Verify'];
        verify[details.requestId] = reqId;
        req.coreId = details.requestId;
        for (var i in vm_headers)
          if (~special_headers.indexOf(i.toLowerCase()))
            new_headers.push({name: i, value: vm_headers[i]});
      }
    }
    return {requestHeaders: new_headers};
  }, {
    urls: ['<all_urls>'],
    types: ['xmlhttprequest'],
  }, ['blocking', 'requestHeaders']);

  chrome.webRequest.onBeforeRequest.addListener(function (req) {
    // onBeforeRequest is fired for local files too
    if (/\.user\.js([\?#]|$)/.test(req.url)) {
      var x = new XMLHttpRequest();
      x.open('GET', req.url, false);
      x.send();
      if ((!x.status || x.status == 200) && !/^\s*</.test(x.responseText)) {
        if (req.tabId < 0)
          chrome.tabs.create({
            url: chrome.extension.getURL('/options/index.html') + '#confirm/' + encodeURIComponent(req.url),
          });
        else
          chrome.tabs.get(req.tabId, function (t) {
            chrome.tabs.create({
              url: chrome.extension.getURL('/options/index.html') + '#confirm/' + encodeURIComponent(req.url) + '/' + encodeURIComponent(t.url),
            });
          });
        return {redirectUrl: 'javascript:history.back()'};
      }
    }
  }, {
    urls: ['<all_urls>'],
    types: ['main_frame'],
  }, ['blocking']);

  return {
    getRequestId: getRequestId,
    abortRequest: abortRequest,
    httpRequest: httpRequest,
  };
}();
