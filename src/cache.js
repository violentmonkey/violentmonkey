!function () {
  function Cache(allowOverride) {
    this.data = {};
    this.allowOverride = allowOverride;
  }
  Cache.prototype.put = function (key, fn) {
    if (key in this.data)
      throw 'Key {' + key + '} already exists!';
    this.data[key] = fn;
  };
  Cache.prototype.get = function (key) {
    var data = this.data;
    return new Promise(function (resolve, reject) {
      if (key in data) return resolve(data[key]);
      var xhr = new XMLHttpRequest();
      xhr.open('GET', key, true);
      xhr.onload = function () {
        resolve(_.template(this.responseText, {variable: 'it'}));
      };
      xhr.onerror = function () {
        reject(this);
      };
      xhr.send();
    });
  };

  _.cache = new Cache();
}();
