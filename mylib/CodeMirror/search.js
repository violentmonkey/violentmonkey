// based on CodeMirror/addon/search/search.js
// Modified by Gerald <gera2ld@163.com>

(function() {
  function searchOverlay(query) {
    if (typeof query == "string") return {token: function(stream) {
      if (stream.match(query)) return "searching";
      stream.next();
      stream.skipTo(query.charAt(0)) || stream.skipToEnd();
    }};
    return {token: function(stream) {
      if (stream.match(query)) return "searching";
      while (!stream.eol()) {
        stream.next();
        if (stream.match(query, false)) break;
      }
    }};
  }

  function SearchState() {
    this.posFrom = this.posTo = this.query = null;
    this.overlay = null;
  }
  function getSearchState(cm) {
    return cm.state.search || (cm.state.search = new SearchState());
  }
  function getSearchCursor(cm, query, pos) {
    // Heuristic: if the query string is all lowercase, do a case insensitive search.
    return cm.getSearchCursor(query, pos, typeof query == "string" && query == query.toLowerCase());
  }
	var dialog=null;
  function openDialog(cm, state, rep) {
		function close(){
			if(closed) return; closed=true;
			cm.removeOverlay(state.overlay);
			dialog.parentNode.removeChild(dialog);
			dialog=null;clearSearch(cm);
			cm.focus();
		}
		if(!dialog) {
			var wrap = cm.getWrapperElement();
			dialog = wrap.appendChild(document.createElement("div"));
			dialog.className='CodeMirror-dialog';
		}
		var text=_('labelSearch')+'<input class=CodeMirror-search placeholder="Search for"><button class=CodeMirror-findNext>&gt;</button><button class=CodeMirror-findPrev>&lt;</button><button class=CodeMirror-cancel>&times;</button>',closed=false,iS,iR;
		if(rep) text+='<br>'+_('labelReplace')+'<input class=CodeMirror-replace placeholder="Replace with"><button class=CodeMirror-replaceNext>'+_('buttonReplace')+'</button><button class=CodeMirror-replaceAll>'+_('buttonReplaceAll')+'</button>';
		dialog.innerHTML=text;
		iS=dialog.querySelector('.CodeMirror-search');
		CodeMirror.on(dialog.querySelector('.CodeMirror-findNext'), "click", function(e) {findNext(cm);});
		CodeMirror.on(dialog.querySelector('.CodeMirror-findPrev'), "click", function(e) {findNext(cm, true);});
		CodeMirror.on(dialog.querySelector('.CodeMirror-cancel'), "click", close);
		CodeMirror.on(dialog, "keydown", function(e) {
			switch(e.keyCode) {
				case 27:
					close();break;
				default:
					return;
			}
			CodeMirror.e_stop(e);
		});
		CodeMirror.on(iS, "keydown", function(e) {
			switch(e.keyCode) {
				case 13:
					findNext(cm, e.shiftKey);break;
				default:
					return;
			}
			CodeMirror.e_stop(e);
		});
		CodeMirror.on(iS, "keyup", function(e) {
			if(state.query!=iS.value) {
				state.query=iS.value;
				cm.operation(function() {
					cm.removeOverlay(state.overlay);
					if(!state.query) return;
					state.overlay = searchOverlay(state.query);
					cm.addOverlay(state.overlay);
					state.posTo=state.posFrom;
					findNext(cm);
				});
			}
		});
		if(rep) {
			iR=dialog.querySelector('.CodeMirror-replace');
			function _replace(all) {
				state.replace=iR.value;
				replace(cm, all);
			}
			CodeMirror.on(dialog.querySelector('.CodeMirror-replaceNext'), "click", function(e) {_replace();});
			CodeMirror.on(dialog.querySelector('.CodeMirror-replaceAll'), "click", function(e) {_replace(true);});
			CodeMirror.on(iR, "keydown", function(e) {
				switch(e.keyCode) {
					default:
						return;
				}
				CodeMirror.e_stop(e);
			});
		}
		iS.focus();
  }
  function doSearch(cm, rev) {
    var state = getSearchState(cm);
    if (state.query) return findNext(cm, rev);
    openDialog(cm, state);
  }
  function findNext(cm, rev) {cm.operation(function() {
    var state = getSearchState(cm);
    var cursor = getSearchCursor(cm, state.query, rev ? state.posFrom : state.posTo);
    if (!cursor.find(rev)) {
      cursor = getSearchCursor(cm, state.query, rev ? CodeMirror.Pos(cm.lastLine()) : CodeMirror.Pos(cm.firstLine(), 0));
      if (!cursor.find(rev)) return;
    }
    cm.setSelection(cursor.from(), cursor.to());
    state.posFrom = cursor.from(); state.posTo = cursor.to();
  });}
  function clearSearch(cm) {cm.operation(function() {
    var state = getSearchState(cm);
    if (!state.query) return;
    state.query = null;
    cm.removeOverlay(state.overlay);
  });}

  function replace(cm, all) {
    var state = getSearchState(cm);
    if (!state.query) return openDialog(cm, state, true);
		if(all) cm.operation(function() {
			for (var cursor = getSearchCursor(cm, state.query); cursor.findNext();) {
				cursor.replace(state.replace);
			}
		}); else {
			var s=cm.getCursor('start'),e=cm.getCursor('end');
			state.posTo=state.posFrom;findNext(cm);
			var s1=cm.getCursor('start'),e1=cm.getCursor('end');
			if(s.line==s1.line&&s.ch==s1.ch&&e.line==e1.line&&e.ch==e1.ch) {
				cm.replaceRange(state.replace,s1,e1);findNext(cm);
			}
		}
  }

  CodeMirror.commands.find = function(cm) {clearSearch(cm); doSearch(cm);};
  CodeMirror.commands.findNext = doSearch;
  CodeMirror.commands.findPrev = function(cm) {doSearch(cm, true);};
  CodeMirror.commands.clearSearch = clearSearch;
  CodeMirror.commands.replace = replace;
  CodeMirror.commands.replaceAll = function(cm) {replace(cm, true);};
})();
