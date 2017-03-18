/* global chrome */
!function (win) {
  function wrapAsync(func) {
    return function () {
      var args = [];
      for (var i = 0; i < arguments.length; i ++) args.push(arguments[i]);
      return new Promise(function (resolve, reject) {
        args.push(function (res) {
          var err = chrome.runtime.lastError;
          if (err) {
            console.error(args);
            reject(err);
          } else {
            resolve(res);
          }
        });
        func.apply(null, args);
      });
    };
  }
  function wrapAPIs(source, meta) {
    var target = {};
    Object.keys(source).forEach(function (key) {
      var metaVal = meta && meta[key];
      if (metaVal) {
        var value = source[key];
        if (typeof metaVal === 'function') {
          target[key] = metaVal(value);
        } else if (typeof metaVal === 'object' && typeof value === 'object') {
          target[key] = wrapAPIs(value, metaVal);
        } else {
          target[key] = value;
        }
      }
    });
    return target;
  }
  var meta = {
    browserAction: true,
    i18n: true,
    notifications: {
      onClicked: true,
      onClosed: true,
      create: wrapAsync,
    },
    runtime: {
      getManifest: true,
      getURL: true,
      onMessage: function (onMessage) {
        function wrapListener(listener) {
          return function onMessage(message, sender, sendResponse) {
            var result = listener(message, sender);
            if (result && typeof result.then === 'function') {
              result.then(function (data) {
                sendResponse({data: data});
              }, function (err) {
                console.error(err);
                sendResponse({error: err});
              });
              return true;
            } else {
              sendResponse({data: result});
            }
          };
        }
        return {
          addListener: function (listener) {
            return onMessage.addListener(wrapListener(listener));
          },
        };
      },
      sendMessage: wrapAsync,
    },
    tabs: {
      onUpdated: true,
      create: wrapAsync,
      get: wrapAsync,
      query: wrapAsync,
      reload: wrapAsync,
      remove: wrapAsync,
      sendMessage: wrapAsync,
      update: wrapAsync,
    },
    webRequest: true,
  };
  if (typeof browser === 'undefined' && typeof chrome !== 'undefined') {
    win.browser = wrapAPIs(chrome, meta);
  }
}(this);
