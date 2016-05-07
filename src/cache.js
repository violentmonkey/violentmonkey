!function () {
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
    return new Promise(function (resolve, reject) {
      if (key in data) return resolve(data[key]);
      var xhr = new XMLHttpRequest;
      xhr.open('GET', key, true);
      xhr.onload = function () {
        resolve(data[key] = _.template(this.responseText, {variable: 'it'}));
      };
      xhr.onerror = function () {
        reject(this);
      };
      xhr.send();
    });
  };

  _.cache = new Cache();
}();

var BaseView = Backbone.View.extend({
  initialize: function () {
    var _this = this;
    if (_this.templateUrl)
      _this.__gotTemplate = _.cache.get(_this.templateUrl)
      .then(function (fn) {
        _this.templateFn = fn;
      });
    _.bindAll(_this, 'render', 'postrender');
    _this.render();
  },
  _render: function () {
    this.$el.html(this.templateFn());
  },
  render: function () {
    var render = this._render.bind(this);
    (this.__gotTemplate || Promise.resolve()).then(render)
    .then(this.postrender);
    return this;
  },
  postrender: function () {
    _.forEach(this.$('[data-i18n]'), function (node) {
      node.innerHTML = _.i18n(node.dataset.i18n);
    });
    _.forEach(this.$('[data-feature]'), function (node) {
      _.features.isHit(node.dataset.feature) || node.classList.add('feature');
    });
  },
  getValue: function (target) {
    var key = target.dataset.id;
    var value;
    switch (key[0]) {
    case '!':
      key = key.slice(1);
      value = target.checked;
      break;
    case '[':
      key = key.slice(1);
      value = _.filter(target.value.split('\n').map(function (s) {return s.trim();}));
      break;
    default:
      value = target.value;
    }
    return {
      key: key,
      value: value,
    };
  },
});

BaseView.prototype.postrender.call(window);

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
