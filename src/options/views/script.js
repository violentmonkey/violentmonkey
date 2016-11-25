var utils = require('../utils');
var cache = require('../../cache');
var _ = require('../../common');
var store = utils.store;

var DEFAULT_ICON = '/images/icon48.png';

module.exports = {
  props: ['script'],
  template: cache.get('./script.html'),
  data: function () {
    return {
      safeIcon: DEFAULT_ICON,
    };
  },
  computed: {
    canUpdate: function () {
      var script = this.script;
      return script.update && (
        script.custom.updateURL ||
        script.meta.updateURL ||
        script.custom.downloadURL ||
        script.meta.downloadURL ||
        script.custom.lastInstallURL
      );
    },
    homepageURL: function () {
      var script = this.script;
      return script.custom.homepageURL || script.meta.homepageURL || script.meta.homepage;
    },
    author: function () {
      var text = this.script.meta.author;
      if (!text) return;
      var matches = text.match(/^(.*?)\s<(\S*?@\S*?)>$/);
      return {
        email: matches && matches[2],
        name: matches ? matches[1] : text,
      };
    },
    labelEnable: function () {
      return this.script.enabled ? _.i18n('buttonDisable') : _.i18n('buttonEnable');
    },
  },
  mounted: function () {
    var _this = this;
    _this.$el.addEventListener('dragstart', _this.onDragStart.bind(_this), false);
    var icon = _this.script.meta.icon;
    if (icon && icon !== _this.safeIcon) {
      _this.loadImage(icon)
      .then(function (url) {
        _this.safeIcon = url;
      }, function () {
        _this.safeIcon = DEFAULT_ICON;
      });
    }
  },
  methods: {
    getLocaleString: function (key) {
      return _.getLocaleString(this.script.meta, key);
    },
    loadImage: function () {
      var images = {};
      return function (url) {
        if (!url) return Promise.reject();
        var promise = images[url];
        if (!promise) {
          var cache = store.cache[url];
          promise = cache ? Promise.resolve(cache)
            : new Promise(function (resolve, reject) {
              var img = new Image;
              img.onload = function () {
                resolve(url);
              };
              img.onerror = function () {
                reject(url);
              };
              img.src = url;
            });
          images[url] = promise;
        }
        return promise;
      };
    }(),
    onEdit: function () {
      var _this = this;
      _this.$emit('edit', _this.script.id);
    },
    onRemove: function () {
      var _this = this;
      _.sendMessage({
        cmd: 'RemoveScript',
        data: _this.script.id,
      });
    },
    onEnable: function () {
      var _this = this;
      _.sendMessage({
        cmd: 'UpdateScriptInfo',
        data: {
          id: _this.script.id,
          enabled: _this.script.enabled ? 0 : 1,
        },
      });
    },
    onUpdate: function () {
      _.sendMessage({
        cmd: 'CheckUpdate',
        data: this.script.id,
      });
    },
    onDragStart: function (e) {
      var _this = this;
      new DND(e, function (data) {
        _this.$emit('move', data);
      });
    },
  },
};

function DND(e, cb) {
  var _this = this;
  _this.mousemove = _this.mousemove.bind(_this);
  _this.mouseup = _this.mouseup.bind(_this);
  if (e) {
    e.preventDefault();
    _this.start(e);
  }
  _this.onDrop = cb;
}
DND.prototype.start = function (e) {
  var _this = this;
  var dragging = _this.dragging = {};
  var el = dragging.el = e.currentTarget;
  var parent = el.parentNode;
  var rect = el.getBoundingClientRect();
  dragging.offset = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
  var next = el.nextElementSibling;
  dragging.delta = (next ? next.getBoundingClientRect().top : parent.offsetHeight) - rect.top;
  dragging.lastIndex = dragging.index = [].indexOf.call(parent.children, el);
  dragging.elements = [].filter.call(parent.children, function (el) {
    return el !== dragging.el;
  });
  var dragged = dragging.dragged = el.cloneNode(true);
  dragged.classList.add('dragging');
  dragged.style.left = rect.left + 'px';
  dragged.style.top = rect.top + 'px';
  dragged.style.width = rect.width + 'px';
  parent.appendChild(dragged);
  el.classList.add('dragging-placeholder');
  document.addEventListener('mousemove', _this.mousemove, false);
  document.addEventListener('mouseup', _this.mouseup, false);
};
DND.prototype.mousemove = function (e) {
  var _this = this;
  var dragging = _this.dragging;
  var dragged = dragging.dragged;
  dragged.style.left = e.clientX - dragging.offset.x + 'px';
  dragged.style.top = e.clientY - dragging.offset.y + 'px';
  var hoveredIndex = dragging.elements.findIndex(function (el) {
    if (!el) return;
    if (el.classList.contains('dragging-moving')) return;
    var rect = el.getBoundingClientRect();
    var pad = 10;
    return (
      e.clientX >= rect.left + pad
      && e.clientX <= rect.left + rect.width - pad
      && e.clientY >= rect.top + pad
      && e.clientY <= rect.top + rect.height - pad
    );
  });
  if (~hoveredIndex) {
    var hoveredEl = dragging.elements[hoveredIndex];
    var lastIndex = dragging.lastIndex;
    var isDown = hoveredIndex >= lastIndex;
    var el = dragging.el;
    var delta = dragging.delta;
    if (isDown) {
      hoveredIndex ++;
      hoveredEl.parentNode.insertBefore(el, hoveredEl.nextElementSibling);
    } else {
      delta = -delta;
      hoveredEl.parentNode.insertBefore(el, hoveredEl);
    }
    dragging.lastIndex = hoveredIndex;
    _this.animate(dragging.elements.slice(
      isDown ? lastIndex : hoveredIndex,
      isDown ? hoveredIndex : lastIndex
    ), delta);
  }
  _this.checkScroll(e.clientY);
};
DND.prototype.animate = function (elements, delta) {
  function endAnimation(e) {
    e.target.classList.remove('dragging-moving');
    e.target.removeEventListener('transitionend', endAnimation, false);
  }
  elements.forEach(function (el) {
    if (!el) return;
    el.classList.add('dragging-moving');
    el.style.transition = 'none';
    el.style.transform = 'translateY(' + delta + 'px)';
    el.addEventListener('transitionend', endAnimation, false);
    setTimeout(function () {
      el.style.transition = '';
      el.style.transform = '';
    });
  });
};
DND.prototype.mouseup = function () {
  var _this = this;
  document.removeEventListener('mousemove', _this.mousemove, false);
  document.removeEventListener('mouseup', _this.mouseup, false);
  var dragging = _this.dragging;
  dragging.dragged.remove();
  dragging.el.classList.remove('dragging-placeholder');
  _this.dragging = null;
  _this.onDrop && _this.onDrop({
    from: dragging.index,
    to: dragging.lastIndex,
  });
};
DND.prototype.checkScroll = function (y) {
  var dragging = this.dragging;
  var scrollThreshold = 10;
  dragging.scroll = 0;
  var offset = dragging.el.parentNode.getBoundingClientRect();
  var delta = (y - (offset.bottom - scrollThreshold)) / scrollThreshold;
  if (delta > 0) {
    dragging.scroll = 1 + Math.min(~~ (delta * 5), 10);
  } else {
    delta = (offset.top + scrollThreshold - y) / scrollThreshold;
    if (delta > 0) dragging.scroll = -1 - Math.min(~~ (delta * 5), 10);
  }
  if (dragging.scroll) this.scrollParent();
};
DND.prototype.scrollParent = function () {
  function scroll() {
    var dragging = _this.dragging;
    if (dragging) {
      if (dragging.scroll) {
        dragging.el.parentNode.scrollTop += dragging.scroll;
        setTimeout(scroll, 32);
      } else dragging.scrolling = false;
    }
  }
  var _this = this;
  if (!_this.dragging.scrolling) {
    _this.dragging.scrolling = true;
    scroll();
  }
};
