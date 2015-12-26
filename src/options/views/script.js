var DEFAULT_ICON = '/images/icon48.png';
var ScriptView = BaseView.extend({
  className: 'script',
  attributes: {
    draggable: true,
  },
  templateUrl: '/options/templates/script.html',
  events: {
    'click [data-id=edit]': 'onEdit',
    'click [data-id=remove]': 'onRemove',
    'click [data-id=enable]': 'onEnable',
    'click [data-id=update]': 'onUpdate',
    'dragstart': 'onDragStart',
  },
  initialize: function () {
    var _this = this;
    _this.model.set('_icon', DEFAULT_ICON);
    // MUST call `super` before `render`
    BaseView.prototype.initialize.call(_this);
    _this.listenTo(_this.model, 'change', _this.render);
    _this.listenTo(_this.model, 'remove', _this.onRemoved);
  },
  loadIcon: function () {
    var _this = this;
    var icon = _this.model.get('meta').icon;
    if (icon && icon !== _this.model.get('_icon'))
      _this.loadImage(icon).then(function (url) {
        _this.model.set('_icon', url);
      }, function (url) {
        _this.model.set('_icon', DEFAULT_ICON);
      });
  },
  _render: function () {
    var _this = this;
    var model = _this.model;
    var it = model.toJSON();
    it.getLocaleString = model.getLocaleString.bind(model);
    it.canUpdate = model.canUpdate();
    it.homepageURL = it.custom.homepageURL || it.meta.homepageURL || it.meta.homepage;
    it.author = _this.getAuthor(it.meta.author);
    _this.$el.html(_this.templateFn(it));
    if (!it.enabled) _this.$el.addClass('disabled');
    else _this.$el.removeClass('disabled');
    _this.loadIcon();
  },
  getAuthor: function (text) {
    if (!text) return '';
    var matches = text.match(/^(.*?)\s<(\S*?@\S*?)>$/);
    var label = _.i18n('labelAuthor');
    return matches
      ? label + '<a href=mailto:' + matches[2] + '>' + matches[1] + '</a>'
      : label + _.escape(text);
  },
  images: {},
  loadImage: function (url) {
    if (!url) return;
    var promise = this.images[url];
    if (!promise) {
      var cache = scriptList.cache[url];
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
      this.images[url] = promise;
    }
    return promise;
  },
  onEdit: function () {
    scriptList.trigger('edit:open', this.model);
  },
  onRemove: function () {
    var _this = this;
    _.sendMessage({
      cmd: 'RemoveScript',
      data: _this.model.id,
    }).then(function () {
      scriptList.remove(_this.model);
    });
  },
  onRemoved: function () {
    this.$el.remove();
  },
  onEnable: function () {
    var _this = this;
    _.sendMessage({
      cmd: 'UpdateScriptInfo',
      data: {
        id: _this.model.id,
        enabled: _this.model.get('enabled') ? 0 : 1,
      },
    });
  },
  onUpdate: function () {
    _.sendMessage({
      cmd: 'CheckUpdate',
      data: this.model.id,
    });
  },
  onDragStart: function (e) {
    var model = this.model;
    new DND(e, function (data) {
      if (data.from === data.to) return;
      _.sendMessage({
        cmd: 'Move',
        data: {
          id: model.id,
          offset: data.to - data.from,
        }
      }).then(function () {
        var collection = model.collection;
        var models = collection.models;
        var i = Math.min(data.from, data.to);
        var j = Math.max(data.from, data.to);
        var seq = [
          models.slice(0, i),
          models.slice(i, j + 1),
          models.slice(j + 1),
        ];
        i === data.to
        ? seq[1].unshift(seq[1].pop())
        : seq[1].push(seq[1].shift());
        collection.models = seq.concat.apply([], seq);
      });
    });
  },
});

function DND(e, cb) {
  this.mousemove = this.mousemove.bind(this);
  this.mouseup = this.mouseup.bind(this);
  if (e) {
    e.preventDefault();
    this.start(e);
  }
  this.onDrop = cb;
}
DND.prototype.start = function (e) {
  var dragging = this.dragging = {
    el: e.currentTarget,
  };
  var $el = dragging.$el = $(dragging.el);
  var parent = $el.parent();
  var offset = $el.offset();
  dragging.offset = {
    x: e.clientX - offset.left,
    y: e.clientY - offset.top,
  };
  var next = $el.next();
  dragging.delta = (next.length ? next.offset().top : parent.height()) - offset.top;
  var children = parent.children();
  dragging.lastIndex = dragging.index = children.index($el);
  dragging.$elements = children.not($el);
  dragging.$dragged = $el.clone().addClass('dragging').css({
    left: offset.left,
    top: offset.top,
    width: offset.width,
  }).appendTo(parent);
  $el.addClass('dragging-placeholder');
  $(document).on('mousemove', this.mousemove).on('mouseup', this.mouseup);
};
DND.prototype.mousemove = function (e) {
  var dragging = this.dragging;
  dragging.$dragged.css({
    left: e.clientX - dragging.offset.x,
    top: e.clientY - dragging.offset.y,
  });
  var hovered = null;
  dragging.$elements.each(function (i, el) {
    var $el = $(el);
    if ($el.hasClass('dragging-moving')) return;
    var offset = $el.offset();
    var pad = 10;
    if (
      e.clientX >= offset.left + pad
      && e.clientX <= offset.left + offset.width - pad
      && e.clientY >= offset.top + pad
      && e.clientY <= offset.top + offset.height - pad
    ) {
      hovered = {
        index: i,
        el: el,
      };
      return false;
    }
  });
  if (hovered) {
    var lastIndex = dragging.lastIndex;
    var index = hovered.index;
    var isDown = index >= lastIndex;
    var $el = dragging.$el;
    var delta = dragging.delta;
    if (isDown) {
      // If moving down, the actual index should be `index + 1`
      index ++;
      $el.insertAfter(hovered.el);
    } else {
      delta = -delta;
      $el.insertBefore(hovered.el);
    }
    dragging.lastIndex = index;
    this.animate(dragging.$elements.slice(
      isDown ? lastIndex : index,
      isDown ? index : lastIndex
    ), delta);
  }
  this.checkScroll(e.clientY);
};
DND.prototype.animate = function ($elements, delta) {
  $elements.each(function (i, el) {
    var $el = $(el);
    $el.addClass('dragging-moving').css({
      transition: 'none',
      transform: 'translateY(' + delta + 'px)',
    }).one('transitionend', function (e) {
      $(e.target).removeClass('dragging-moving');
    });
    setTimeout(function () {
      $el.css({
        transition: '',
        transform: '',
      });
    }, 20);
  });
};
DND.prototype.mouseup = function (e) {
  $(document).off('mousemove', this.mousemove).off('mouseup', this.mouseup);
  var dragging = this.dragging;
  dragging.$dragged.remove();
  dragging.$el.removeClass('dragging-placeholder');
  this.dragging = null;
  this.onDrop && this.onDrop({
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
        setTimeout(scroll, 20);
      } else dragging.scrolling = false;
    }
  }
  var _this = this;
  if (!_this.dragging.scrolling) {
    _this.dragging.scrolling = true;
    scroll();
  }
};
