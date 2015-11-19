var App = Backbone.Router.extend({
  routes: {
    '': 'renderMain',
    'main/:tab': 'renderMain',
    'confirm/:url': 'renderConfirm',
  },
  renderMain: function (tab) {
    this.view = new MainView(tab);
  },
  renderConfirm: function (url) {
    this.view = new ConfirmView(url);
  },
});
var app = new App();
if (!Backbone.history.start())
  app.navigate('', {trigger: true, replace: true});

BaseView.prototype.initI18n.call(window);
