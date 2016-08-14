define('utils/dropdown', function () {
  Vue.directive('dropdown', {
    bind: function () {
      var _this = this;
      var dropdown = _this.data = {
        toggle: _this.el.querySelector('[dropdown-toggle]'),
        data: {
          isOpen: false,
        },
      };
      var methods = dropdown.methods = {
        onClose: function (e) {
          if (e && _this.el && _this.el.contains(e.target)) return;
          dropdown.data.isOpen = false;
          _this.el.classList.remove('open');
          document.removeEventListener('mousedown', methods.onClose, false);
        },
        onOpen: function (_e) {
          dropdown.data.isOpen = true;
          _this.el.classList.add('open');
          document.addEventListener('mousedown', methods.onClose, false);
        },
        onToggle: function (_e) {
          if (dropdown.data.isOpen) methods.onClose();
          else methods.onOpen();
        },
      };
      dropdown.toggle.addEventListener('click', methods.onToggle, false);
      _this.el.classList.add('dropdown');
    },
  });
});
