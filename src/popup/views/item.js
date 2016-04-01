var MenuItemView = BaseView.extend({
  className: 'menu-item',
  templateUrl: '/popup/templates/menuitem.html',
  events: {
    'click .menu-item-detail': 'onClickDetail',
    'click .menu-item-label': 'onClick',
  },
  initialize: function () {
    BaseView.prototype.initialize.call(this);
    this.listenTo(this.model, 'change', this.render);
    if (this.model.get('onClickDetail')) this.el.classList.add('has-detail');
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
    if (it.className) this.$el.addClass(it.className);
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
