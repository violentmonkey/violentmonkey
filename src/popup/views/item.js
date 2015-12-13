var MenuItemView = BaseView.extend({
  className: 'menu-item',
  templateUrl: '/popup/templates/menuitem.html',
  events: {
    'click': 'onClick',
  },
  initialize: function () {
    BaseView.prototype.initialize.call(this);
    this.listenTo(this.model, 'change', this.render);
  },
  _render: function () {
    var it = this.model.toJSON();
    if (typeof it.symbol === 'function')
      it.symbol = it.symbol(it.data);
    this.$el.html(this.templateFn(it))
    .attr('title', it.title === true ? it.name : it.title);
    if (it.data === false) this.$el.addClass('disabled');
    else this.$el.removeClass('disabled');
  },
  onClick: function (e) {
    var onClick = this.model.get('onClick');
    onClick && onClick(e, this.model);
  },
})
