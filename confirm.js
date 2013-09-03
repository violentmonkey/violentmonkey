function checkScript(t){
	if(/^\s*</.test(t)) {	// seems to be HTML code
		M.innerHTML=_('msgNotJS',[data.url]);
		chrome.runtime.sendMessage({cmd:'LoadDirectly',data:data.url},function(){
			setTimeout(function(){location.replace(data.url);},3000);
		});
	} else {	// may be JS code
		M.innerHTML=_('msgLoadedJS',[data.url]);
		T.setValue(t);
		I.disabled=false;
	}
}
var $=document.getElementById.bind(document),M=$('msg'),I=$('bInstall'),data={},
		T=CodeMirror.fromTextArea($('eCode'),{
			lineNumbers:true,
			matchBrackets:true,
			mode:'text/typescript',
			lineWrapping:true,
			indentUnit:4,
			indentWithTabs:true,
			readOnly:true,
		});
initCSS();initI18n();
$('bClose').onclick=function(){window.close();};
I.onclick=function(){
	chrome.runtime.sendMessage({
		cmd:'ParseScript',
		data:{
			url:data.url,
			from:data.from,
			code:T.getValue(),
		},
	});
	I.disabled=true;
};
chrome.runtime.onMessage.addListener(function(req,src,callback) {
	var maps={
		ShowMessage: function(o){
			M.innerHTML=o.message;
			if(callback) callback();
		},
	},f=maps[req.cmd];
	if(f) f(req.data,src,callback);
	return true;
});
(function(s){
	s.split('&').forEach(function(i){
		i.replace(/^([^=]*)=(.*)$/,function(r,g1,g2){data[g1]=decodeURIComponent(g2);});
	});
	function error(){M.innerHTML=_('msgErrorLoadingURL',[data.url]);}
	if(!data.url) error(); else {
		M.innerHTML=_('msgLoadingURL',[data.url]);
		var x=new XMLHttpRequest();
		x.open('GET',data.url,true);
		x.onloadend=function(){
			if(this.status==200&&this.responseText) checkScript(this.responseText);
			else error();
		};
		x.send();
	}
})(location.search.slice(1));
