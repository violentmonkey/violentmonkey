define('editor', function (_require, exports, _module) {
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

  var readyCodeMirror;

  exports.init = function (options) {
    options = options || {};
    readyCodeMirror = readyCodeMirror || initCodeMirror();
    return readyCodeMirror.then(function(){
      var editor = CodeMirror(options.container, {
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
      editor.clearHistory = function() {
        this.getDoc().clearHistory();
      };
      editor.setValueAndFocus = function(value) {
        this.setValue(value);
        this.focus();
      };
      options.readonly && editor.setOption('readOnly', options.readonly);
      options.onchange && editor.on('change', options.onchange);
      var extraKeys = {};
      options.onexit && (extraKeys.Esc = options.onexit);
      options.onsave && (extraKeys['Ctrl-S'] = extraKeys['Cmd-S'] = options.onsave);
      editor.setOption('extraKeys', extraKeys);
      return editor;
    });
  };
});
