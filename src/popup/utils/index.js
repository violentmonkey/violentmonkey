define('utils', function (_require, exports, _module) {
  function fixStyles(vm) {
    setTimeout(function () {
      var placeholder = vm.$els.placeholder;
      var bot = vm.$els.bot;
      placeholder.innerHTML = bot.innerHTML;
      var pad = bot.offsetWidth - bot.clientWidth + 2;
      placeholder.style.paddingRight = pad + 'px';
    });
  }

  exports.store = {
    scripts: [],
    commands: [],
    domains: [],
  };
  exports.fixStyles = fixStyles;
});
