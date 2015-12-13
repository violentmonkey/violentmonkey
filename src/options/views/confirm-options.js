var ConfirmOptionsView = BaseView.extend({
  className: 'button-panel options-panel',
  events: {
    'mousedown': 'stopPropagation',
    'change [data-check]': 'updateCheckbox',
    'change #cbClose': 'render',
  },
  templateUrl: '/options/templates/confirm-options.html',
  _render: function () {
    var options = _.options.getAll();
    this.$el.html(this.templateFn(options));
  },
  stopPropagation: function (e) {
    e.stopPropagation();
  },
  updateCheckbox: _.updateCheckbox,
});
