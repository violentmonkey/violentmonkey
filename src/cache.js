function getCache() {
  function put(key, value) {
    if (key in data) {
      throw 'Key {' + key + '} already exists!';
    }
    data[key] = value;
  }
  function get(key) {
    if (key in data) return data[key];
    throw 'Cache not found: ' + key;
  }
  var data = {};
  return {get: get, put: put};
}

var _ = require('./common');
Vue.prototype.i18n = _.i18n;

!function () {
  var xhr = new XMLHttpRequest;
  xhr.open('GET', '/images/sprite.svg', true);
  xhr.onload = function () {
    var div = document.createElement('div');
    div.style.display = 'none';
    div.innerHTML = xhr.responseText;
    document.body.insertBefore(div, document.body.firstChild);
  };
  xhr.send();
}();

/* eslint-disable no-unused-vars */
var cache = module.exports = getCache();
