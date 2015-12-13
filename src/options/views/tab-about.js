var AboutTab = BaseView.extend({
  el: '#tab',
  name: 'about',
  templateUrl: '/options/templates/tab-about.html',
  render: function () {
    this.$el.html(this.templateFn());
    return this;
  },
});
