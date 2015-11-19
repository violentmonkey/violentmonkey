var Script = Backbone.Model.extend({
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
