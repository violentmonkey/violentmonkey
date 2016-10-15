module.exports = {
  load: function (string) {
    return string.split('&').reduce(function (data, piece) {
      var parts = piece.split('=');
      data[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
      return data;
    }, {});
  },
  dump: function (dict) {
    return Object.keys(dict).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(dict[key]);
    }).join('&');
  },
};
