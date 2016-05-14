define('utils/search', function (_require, _exports, module) {
  module.exports = {
    load: function (string) {
      return string.split('&').reduce(function (data, piece) {
        var parts = piece.split('=');
        data[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
        return data;
      }, {});
    },
    dump: function (dict) {
      var qs = [];
      for (var k in dict) {
        qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(dict[k]));
      }
      return qs.join('&');
    },
  };
});
