var MenuItem = Backbone.Model.extend({});

var Menu = Backbone.Collection.extend({
  model: MenuItem,
});

var scriptsMenu = new Menu;
var commandsMenu = new Menu;
var domainsMenu = new Menu;
