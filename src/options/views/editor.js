function addScripts(data) {
  function add(data) {
    var s = document.createElement('script');
    if (data.innerHTML) s.innerHTML = data.innerHTML;
    else if (data.src) s.src = data.src;
    return new Promise(function (resolve, reject) {
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject();
      };
      document.body.appendChild(s);
    });
  }
  if (!data.map) data = [data];
  return Promise.all(data.map(add));
}

function addCSS(data) {
  function add(data) {
    var s;
    if (data.html) {
      s = document.createElement('style');
      s.innerHTML = data.html;
    } else if (data.href) {
      s = document.createElement('link');
      s.rel = 'stylesheet';
      s.href = data.href;
    }
    if (s) document.body.appendChild(s);
  }
  if (!data.forEach) data = [data];
  data.forEach(add);
}

function getHandler(key) {
  return function (cm) {
    var commands = cm.state.commands;
    var handle = commands && commands[key];
    return handle && handle();
  };
}

function initCodeMirror() {
  addCSS([
    {href: '/lib/CodeMirror/lib/codemirror.css'},
    {href: '/lib/CodeMirror/theme/eclipse.css'},
    {href: '/mylib/CodeMirror/fold.css'},
  ]);
  return addScripts(
    {src: '/lib/CodeMirror/lib/codemirror.js'}
  )
  .then(function () {
    return addScripts([
      {src: '/lib/CodeMirror/mode/javascript/javascript.js'},
      {src: '/lib/CodeMirror/addon/comment/continuecomment.js'},
      {src: '/lib/CodeMirror/addon/edit/matchbrackets.js'},
      {src: '/lib/CodeMirror/addon/edit/closebrackets.js'},
      {src: '/lib/CodeMirror/addon/fold/foldcode.js'},
      {src: '/lib/CodeMirror/addon/fold/foldgutter.js'},
      {src: '/lib/CodeMirror/addon/fold/brace-fold.js'},
      {src: '/lib/CodeMirror/addon/fold/comment-fold.js'},
      {src: '/lib/CodeMirror/addon/search/match-highlighter.js'},
      {src: '/lib/CodeMirror/addon/search/searchcursor.js'},
      {src: '/lib/CodeMirror/addon/selection/active-line.js'},
    ]);
  })
  .then(function () {
    [
      'save', 'cancel', 'find', 'findNext', 'findPrev', 'replace', 'replaceAll',
    ].forEach(function (key) {
      CodeMirror.commands[key] = getHandler(key);
    });
  });
}

var cache = require('../../cache');
var readyCodeMirror = initCodeMirror();

module.exports = {
  props: [
    'readonly',
    'content',
    'commands',
  ],
  template: cache.get('./editor.html'),
  mounted: function () {
    var _this = this;
    readyCodeMirror.then(function () {
      var cm = _this.cm = CodeMirror(_this.$el, {
        continueComments: true,
        matchBrackets: true,
        autoCloseBrackets: true,
        highlightSelectionMatches: true,
        lineNumbers: true,
        mode: 'javascript',
        lineWrapping: true,
        styleActiveLine: true,
        foldGutter: true,
        gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
        theme: 'eclipse',
      });
      _this.readonly && cm.setOption('readOnly', _this.readonly);
      cm.on('change', function () {
        _this.cachedContent = cm.getValue();
        _this.$emit('change', _this.cachedContent);
      });
      cm.state.commands = _this.commands;
      cm.setOption('extraKeys', {
        Esc: 'cancel',
      });
      cm.on('keyHandled', function (_cm, _name, e) {
        e.stopPropagation();
      });
      _this.update();
      _this.$emit('ready', cm);
    });
  },
  watch: {
    content: function (content) {
      var _this = this;
      if (content !== _this.cachedContent) {
        _this.cachedContent = content;
        _this.update();
      }
    },
  },
  methods: {
    update: function () {
      var _this = this;
      if (!_this.cm || _this.cachedContent == null) return;
      _this.cm.setValue(_this.cachedContent);
      _this.cm.getDoc().clearHistory();
      _this.cm.focus();
    },
  },
};
