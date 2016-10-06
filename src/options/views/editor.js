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

function initCodeMirror() {
  addCSS([
    {href: '/lib/CodeMirror/lib/codemirror.css'},
    {href: '/mylib/CodeMirror/fold.css'},
    {href: '/mylib/CodeMirror/search.css'},
  ]);
  return addScripts(
    {src: '/lib/CodeMirror/lib/codemirror.js'}
  ).then(function () {
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
      {src: '/mylib/CodeMirror/search.js'},
    ]);
  });
}

var cache = require('../../cache');
var readyCodeMirror = initCodeMirror();

module.exports = {
  props: [
    'readonly',
    'onExit',
    'onSave',
    'onChange',
    'content',
  ],
  template: cache.get('./editor.html'),
  mounted: function () {
    var _this = this;
    readyCodeMirror.then(function () {
      var editor = _this.editor = CodeMirror(_this.$el, {
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
      });
      _this.readonly && editor.setOption('readOnly', _this.readonly);
      editor.on('change', function () {
        _this.cachedContent = editor.getValue();
        _this.onChange && _this.onChange(_this.cachedContent);
      });
      var extraKeys = {};
      if (_this.onExit) {
        extraKeys.Esc = _this.onExit;
      }
      if (_this.onSave) {
        extraKeys['Ctrl-S'] = extraKeys['Cmd-S'] = _this.onSave;
      }
      editor.setOption('extraKeys', extraKeys);
      _this.update();
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
      if (!_this.editor || _this.cachedContent == null) return;
      _this.editor.setValue(_this.cachedContent);
      _this.editor.getDoc().clearHistory();
      _this.editor.focus();
    },
  },
};
