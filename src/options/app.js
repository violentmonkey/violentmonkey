zip.workerScriptsPath = '/lib/zip.js/';

_.showMessage = function (options) {
  new MessageView(options);
};

var App = Backbone.Router.extend({
  routes: {
    '': 'renderMain',
    'main/:tab': 'renderMain',
    'confirm/:url': 'renderConfirm',
    'confirm/:url/:from': 'renderConfirm',
  },
  renderMain: function (tab) {
    scriptList || initMain();
    this.view = new MainView(tab);
  },
  renderConfirm: function (url, _from) {
    this.view = new ConfirmView(url, _from);
  },
  renderEdit: function (id) {
    this.view = new EditView(id);
  },
});
var app = new App();
if (!Backbone.history.start())
  app.navigate('', {trigger: true, replace: true});

BaseView.prototype.postrender.call(window);
$(document).on('click', '[data-feature]', function (e) {
  var target = e.currentTarget;
  _.features.hit(target.dataset.feature);
  target.classList.remove('feature');
});

var scriptList, syncData;
function initMain() {
  scriptList = new ScriptList;
  syncData = new Backbone.Collection;
  var port = chrome.runtime.connect({name: 'Options'});
  port.onMessage.addListener(function (res) {
    switch (res.cmd) {
      case 'sync':
        syncData.reset(res.data);
        break;
      case 'add':
        res.data.message = '';
        scriptList.push(res.data);
        break;
      case 'update':
        if (res.data) {
          var model = scriptList.get(res.data.id);
          if (model) model.set(res.data);
        }
        break;
      case 'del':
        scriptList.remove(res.data);
    }
  });
}
