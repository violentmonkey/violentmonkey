var Script = Backbone.Model.extend({
  /**
   * Get locale attributes such as `@name:zh-CN`
   */
  getLocaleString: function (key) {
    var _this = this;
    var meta = _this.get('meta') || {};
    var lang = navigator.languages.find(function (lang) {
      return (key + ':' + lang) in meta;
    });
    if (lang) key += ':' + lang;
    return meta[key] || '';
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

_.sendMessage({cmd: 'GetData'}).then(function (data) {
  scriptList.loading = false;
  _.assign(scriptList.cache, data.cache);
  scriptList.reset(data.scripts);
});
