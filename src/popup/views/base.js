var MenuBaseView = BaseView.extend({
  el: '#popup',
  templateUrl: '/popup/templates/menu.html',
  addMenuItem: function (obj, parent) {
    if (!(obj instanceof MenuItem)) obj = new MenuItem(obj);
    var item = new MenuItemView({model: obj});
    parent.append(item.$el);
  },
});
