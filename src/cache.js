function Cache(allowOverride) {
  this.data = {};
  this.allowOverride = allowOverride;
}
Cache.prototype.put = function (key, fn) {
  if (key in this.data && !this.allowOverride)
    throw 'Key {' + key + '} already exists!';
  this.data[key] = fn;
};
Cache.prototype.get = function (key) {
  var data = this.data;
  if (key in data) return data[key];
  throw 'Cache not found: ' + key;
};

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
var cache = module.exports = new Cache();
