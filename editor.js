function initAce(callback,data){
	data=data||{};
	addScript({src:'lib/ace-min-noconflict/ace.js'},function(){
		var T=ace.edit('eCode'),s=T.getSession();
		T.setTheme('ace/theme/github');
		T.setValueAndFocus=function(v){
			T.setValue(v);T.focus();T.gotoLine(0,0);
		};
		s.setMode('ace/mode/javascript');
		s.setUseSoftTabs(false);
		s.setUseWrapMode(true);
		s.setUseWorker(true);
		T.clearHistory=s.getUndoManager().reset;
		if(data.onchange) s.on('change',data.onchange);
		if(data.save) T.commands.addCommand({
			name:'Save',
			bindKey:{win:'Ctrl-S',mac:'Command-S'},
			exec:data.save,
			readOnly:false,
		});
		if(data.exit) T.commands.addCommand({
			name:'Exit',
			bindKey:{win:'Esc'},
			exec:data.exit,
			readOnly:true,
		});
		if(data.readonly) T.setReadOnly(data.readonly);
		callback(T);
	});
}

/*function initCodeMirror(callback,data){
	data=data||{};
	addCSS([
		{href:'lib/CodeMirror/lib/codemirror.css'},
	]);
	addScript({src:'lib/CodeMirror/lib/codemirror.js'},function(){
		addScript([
			{src:'lib/CodeMirror/mode/javascript/javascript.js'},
			{src:'lib/CodeMirror/addon/comment/continuecomment.js'},
			{src:'lib/CodeMirror/addon/edit/matchbrackets.js'},
			{src:'lib/CodeMirror/addon/search/match-highlighter.js'},
			{src:'lib/CodeMirror/addon/search/search.js'},
			{src:'lib/CodeMirror/addon/search/searchcursor.js'},
			{src:'lib/CodeMirror/addon/selection/active-line.js'},
		],function(){
			CodeMirror.keyMap.vm={'fallthrough':'default'};
			if(data.save) {
				CodeMirror.keyMap.vm['Ctrl-S']='save';
				CodeMirror.commands.save=data.save;
			}
			if(data.exit) {
				CodeMirror.keyMap.vm['Esc']='exit';
				CodeMirror.commands.exit=data.exit;
			}
			var T=CodeMirror($('eCode'),{
				lineNumbers:true,
				matchBrackets:true,
				mode:'text/typescript',
				lineWrapping:true,
				indentUnit:4,
				indentWithTabs:true,
				extraKeys:{"Enter":"newlineAndIndentContinueComment"},
				keyMap:'vm',
				styleActiveLine:true,
			});
			T.clearHistory=function(){T.getDoc().clearHistory();};
			T.setValueAndFocus=function(v){T.setValue(v);T.focus();};
			T.getWrapperElement().setAttribute('style','position:absolute;height:100%;width:100%;');
			if(data.onchange) T.on('change',data.onchange);
			if(data.readonly) T.setOption('readOnly',data.readonly);
			callback(T);
		});
	});
}*/

var initEditor=initAce;
