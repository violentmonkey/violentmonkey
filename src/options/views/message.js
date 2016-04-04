var MessageView = BaseView.extend({
  className: 'message',
  templateUrl: '/options/templates/message.html',
  transitionTime: 500,
  initialize: function (options) {
    var _this = this;
    _this.options = options;
    BaseView.prototype.initialize.call(_this);
    _.bindAll(_this, 'toggle', 'delay', 'remove');
  },
  _render: function () {
    var _this = this;
    _this.$el
    .html(_this.templateFn(_this.options))
    .appendTo(document.body);
    _this.delay(16)
    .then(_this.toggle)
    .then(function () {
      return _this.delay(_this.options.delay || 2000);
    })
    .then(_this.toggle)
    .then(_this.remove);
  },
  delay: function (time) {
    if (time == null) time = this.transitionTime;
    return new Promise(function (resolve, reject) {
      setTimeout(resolve, time);
    });
  },
  toggle: function () {
    var _this = this;
    _this.$el.toggleClass('message-show');
    return _this.delay();
  },
});
