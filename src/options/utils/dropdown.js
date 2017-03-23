import Vue from 'vue';

Vue.directive('dropdown', {
  bind(el) {
    const toggle = el.querySelector('[dropdown-toggle]');
    let isOpen = false;
    toggle.addEventListener('click', onToggle, false);
    el.classList.add('dropdown');
    function onClose(e) {
      if (e && el.contains(e.target)) return;
      isOpen = false;
      el.classList.remove('open');
      document.removeEventListener('mousedown', onClose, false);
    }
    function onOpen() {
      isOpen = true;
      el.classList.add('open');
      document.addEventListener('mousedown', onClose, false);
    }
    function onToggle() {
      if (isOpen) onClose();
      else onOpen();
    }
  },
});
