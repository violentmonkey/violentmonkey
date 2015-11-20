var Script = Backbone.Model.extend({
  /**
   * Get locale attributes such as `@name:zh-CN`
   */
  getLocaleString: function (key) {
    var _this = this;
    var lang = navigator.languages.find(function (lang) {
      return _this.has(key + ':' + lang);
    });
    if (lang) key += ':' + lang;
    return _this.get(key) || '';
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
  comparator: 'position',
  loading: true,
  initialize: function () {
    this.cache = {};
  },
});

var scriptList = new ScriptList();

chrome.runtime.sendMessage({cmd:'GetData'}, function (data) {
  scriptList.loading = false;
  _.assign(scriptList.cache, data.cache);
  scriptList.reset(data.scripts);
});
