define('events', function (_require, exports, _module) {
  function getEventEmitter() {
    var events = {};
    return {
      on: on,
      off: off,
      fire: fire,
    };
    function on(type, func) {
      var list = events[type];
      if (!list) list = events[type] = [];
      list.push(func);
    }
    function off(type, func) {
      var list = events[type];
      if (list) {
        var i = list.indexOf(func);
        if (~i) list.splice(i, 1);
      }
    }
    function fire(type, data) {
      var list = events[type];
      list && list.forEach(function (func) {
        func(data, type);
      });
    }
  }

  exports.getEventEmitter = getEventEmitter;
});
