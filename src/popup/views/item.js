define('views/MenuItem', function (require, _exports, module) {
  var BaseView = require('cache').BaseView;

  module.exports = BaseView.extend({
    className: 'menu-item',
    templateUrl: '/popup/templates/menuitem.html',
    events: {
      'click .menu-item-detail': 'onClickDetail',
      'click .menu-item-label': 'onClick',
    },
    initialize: function () {
      var _this = this;
      BaseView.prototype.initialize.call(_this);
      _this.listenTo(_this.model, 'change', _this.render);
    },
    _render: function () {
      var it = this.model.toJSON();
      if (typeof it.symbol === 'function')
      it.symbol = it.symbol(it.data);
      if (typeof it.name === 'function')
      it.name = it.name(it.data);
      this.$el.html(this.templateFn(it))
      .attr('title', it.title === true ? it.name : it.title);
      if (it.data === false) this.$el.addClass('disabled');
      else this.$el.removeClass('disabled');
      it.className && this.$el.addClass(it.className);
      it.onClickDetail && this.$el.addClass('has-detail');
    },
    onClick: function (e) {
      var onClick = this.model.get('onClick');
      onClick && onClick(e, this.model);
    },
    onClickDetail: function (e) {
      var onClickDetail = this.model.get('onClickDetail');
      onClickDetail && onClickDetail(e, this.model);
    },
  });
});
