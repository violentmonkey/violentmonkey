var Meta = Backbone.Model.extend({
  parse: function (script) {
    this.meta = script.meta;
    return script.custom;
  },
});

var Script = Backbone.Model.extend({
  getLocaleString: function (key) {
    var _this = this;
    var meta = _this.get('meta') || {};
    return _.getLocaleString(meta, key);
  },
  canUpdate: function () {
    var script = this.toJSON();
    return script.update && (
      script.custom.updateURL ||
      script.meta.updateURL ||
      script.custom.downloadURL ||
      script.meta.downloadURL ||
      script.custom.lastInstallURL
    );
  },
});

var ScriptList = Backbone.Collection.extend({
  model: Script,
  // comparator: 'position',
  initialize: function () {
    this.cache = {};
    this.reload();
  },
  reload: function () {
    var _this = this;
    _this.loading = true;
    _.sendMessage({cmd: 'GetData'}).then(function (data) {
      _this.loading = false;
      _.assign(_this.cache, data.cache);
      _this.reset(data.scripts);
    });
  },
});

var scriptList = new ScriptList();

var port = chrome.runtime.connect({name: 'Options'});
port.onMessage.addListener(function (res) {
  if (res.cmd === 'add')
    scriptList.push(res.data);
  else if (res.data) {
    var model = scriptList.get(res.data.id);
    if (model) model.set(res.data);
  }
});
