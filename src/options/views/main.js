define('views/Main', function (require, _exports, module) {
  var BaseView = require('cache').BaseView;
  var MainTab = require('views/TabInstalled');
  var SettingsTab = require('views/TabSettings');
  var AboutTab = require('views/TabAbout');
  module.exports = BaseView.extend({
    className: 'main',
    templateUrl: '/options/templates/main.html',
    tabs: {
      main: MainTab,
      settings: SettingsTab,
      about: AboutTab,
    },
    initialize: function () {
      var _this = this;
      _this.model = new Backbone.Model({
        tab: null,
      });
      _this.listenTo(_this.model, 'change', _this.render);
      BaseView.prototype.initialize.call(_this);
    },
    _render: function () {
      var _this = this;
      var Tab = _this.model.get('tab');
      var name = Tab.prototype.name;
      _this.$el.html(_this.templateFn({tab: name}));
      _this.loadSubview(name, function () {
        return new Tab;
      }, '#tab');
    },
    loadTab: function (name) {
      var _this = this;
      _this.model.set('tab', _this.tabs[name] || _this.tabs['main']);
    },
  });
});
