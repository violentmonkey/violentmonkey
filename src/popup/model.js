define('models', function (_require, exports, _module) {
  exports.MenuItem = Backbone.Model.extend({});

  exports.Menu = Backbone.Collection.extend({
    model: exports.MenuItem,
  });
});
