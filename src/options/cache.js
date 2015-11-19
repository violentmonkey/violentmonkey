!function () {
  function Cache(allowOverride) {
    this.data = {};
    this.allowOverride = allowOverride;
  }
  Cache.prototype.put = function (key, value) {
    if (key in this.data)
      throw 'Key {' + key + '} already exists!';
    this.data[key] = value;
  };
  Cache.prototype.get = function (key) {
    var data = this.data;
    return new Promise(function (resolve, reject) {
      if (key in data) return resolve(data[key]);
      var xhr = new XMLHttpRequest();
      xhr.open('GET', key, true);
      xhr.onload = function () {
        resolve(this.responseText);
      };
      xhr.onerror = function () {
        reject(this);
      };
      xhr.send();
    });
  };

  _.cache = new Cache();
}();
