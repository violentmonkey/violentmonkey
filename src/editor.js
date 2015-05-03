'use strict';

function addScript(data, callback) {
	function add(data) {
		var s = document.createElement('script');
		s.async = false;
		if(data.innerHTML) s.innerHTML = data.innerHTML;
		else if(data.src) s.src = data.src;
		s.onload = finish;
		document.body.appendChild(s);
	}
	function finish() {
		if(! -- count) callback();
	}
	if(!data.forEach) data = [data];
	var count = data.length;
	data.forEach(add);
}

function addCSS(data){
	function add(data){
		var s;
		if(data.html) {
			s = document.createElement('style');
			s.innerHTML = data.html;
		} else if(data.href) {
			s = document.createElement('link');
			s.rel = 'stylesheet';
			s.type = 'text/css';
			s.href = data.href;
		}
		if(s) document.head.appendChild(s);
	}
	if(!data.forEach) data = [data];
	data.forEach(add);
}

function initEditor(options){
	options = options || {};
	addCSS([
		{href: 'lib/CodeMirror/lib/codemirror.css'},
		{href: 'mylib/CodeMirror/fold.css'},
		{href: 'mylib/CodeMirror/search.css'},
	]);
	addScript([
		{src: 'lib/CodeMirror/lib/codemirror.js'},
		{src: 'lib/CodeMirror/mode/javascript/javascript.js'},
		{src: 'lib/CodeMirror/addon/comment/continuecomment.js'},
		{src: 'lib/CodeMirror/addon/edit/matchbrackets.js'},
		{src: 'lib/CodeMirror/addon/edit/closebrackets.js'},
		{src: 'lib/CodeMirror/addon/fold/foldcode.js'},
		{src: 'lib/CodeMirror/addon/fold/foldgutter.js'},
		{src: 'lib/CodeMirror/addon/fold/brace-fold.js'},
		{src: 'lib/CodeMirror/addon/fold/comment-fold.js'},
		{src: 'lib/CodeMirror/addon/search/match-highlighter.js'},
		{src: 'lib/CodeMirror/addon/search/searchcursor.js'},
		{src: 'lib/CodeMirror/addon/selection/active-line.js'},
		{src: 'mylib/CodeMirror/search.js'},
	], function(){
		CodeMirror.keyMap.vm = {'fallthrough': 'default'};
		if(options.onsave) {
			CodeMirror.keyMap.vm['Ctrl-S'] = 'save';
			CodeMirror.commands.save = options.onsave;
		}
		if(options.onexit) {
			CodeMirror.keyMap.vm['Esc'] = 'exit';
			CodeMirror.commands.exit = options.onexit;
		}
		var editor = CodeMirror(options.container, {
			continueComments: true,
			matchBrackets: true,
			autoCloseBrackets: true,
			highlightSelectionMatches: true,
			lineNumbers: true,
			mode: 'javascript',
			lineWrapping: true,
			indentUnit: 4,
			indentWithTabs: true,
			keyMap: 'vm',
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
		if(options.onchange) editor.on('change', options.onchange);
		if(options.readonly) editor.setOption('readOnly', options.readonly);
		if(options.callback) options.callback(editor);
	});
}
