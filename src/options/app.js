var App = Backbone.Router.extend({
  routes: {
    '': 'renderMain',
    'main/:tab': 'renderMain',
    'confirm/:url': 'renderConfirm',
    'confirm/:url/:from': 'renderConfirm',
  },
  renderMain: function (tab) {
    this.view = new MainView(tab);
  },
  renderConfirm: function (url, _from) {
    this.view = new ConfirmView(url, _from);
  },
});
var app = new App();
if (!Backbone.history.start())
  app.navigate('', {trigger: true, replace: true});

BaseView.prototype.initI18n.call(window);
