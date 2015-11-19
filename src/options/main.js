var BaseView = Backbone.View.extend({
  initialize: function () {
    var _this = this;
    var gotTemplate = _.cache.get(_this.templateUrl).then(function (data) {
      _this.template = data;
    });
    var render = _this.render.bind(_this);
    var initI18n = _this.initI18n.bind(_this);
    _this.render = function () {
      gotTemplate.then(render).then(initI18n);
    };
    _this.render();
  },
  initI18n: function () {
		_.forEach(this.el.querySelectorAll('[data-i18n]'), function (node) {
			node.innerHTML = _.i18n(node.dataset.i18n);
		});
  },
});

var MainTab = BaseView.extend({
  el: '#tab',
  templateUrl: 'templates/tab-installed.html',
  render: function () {
    this.el.innerHTML = this.template;
  },
});

var MainView = BaseView.extend({
  el: '#app',
  templateUrl: 'templates/main.html',
  tabs: {
    '': MainTab,
  },
  initialize: function (tab) {
    this.tab = this.tabs[tab] || this.tabs[''];
    BaseView.prototype.initialize.call(this);
  },
  render: function () {
    this.el.innerHTML = this.template;
    this.view = new this.tab;
  },
});

var App = Backbone.Router.extend({
  routes: {
    '': 'renderMain',
    'main/:tab': 'renderMain',
  },
  renderMain: function (tab) {
    this.view = new MainView(tab);
  },
});
var app = new App();
if (!Backbone.history.start()) app.navigate('');
