var cache = require('../../cache');

function init() {
  if (div) return;
  div = document.createElement('div');
  document.body.appendChild(div);
  new Vue({
    el: div,
    template: cache.get('./message.html'),
    data: {
      messages: messages,
    },
  });
}

var div;
var messages = [];

exports.open = function (options) {
  init();
  messages.push(options);
  setTimeout(function () {
    var i = messages.indexOf(options);
    ~i && messages.splice(i, 1);
  }, 2000);
};
