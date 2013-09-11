function checkScript(t){
	if(/^\s*</.test(t)) {	// seems to be HTML code
		M.innerHTML=_('msgNotJS',[data.url]);
		chrome.runtime.sendMessage({cmd:'LoadDirectly',data:data.url},function(){
			setTimeout(function(){location.replace(data.url);},3000);
		});
	} else {	// may be JS code
		M.innerHTML=_('msgLoadedJS',[data.url]);
		T.setValue(t);T.gotoLine(0,0);
		I.disabled=false;
	}
}
var $=document.getElementById.bind(document),M=$('msg'),I=$('bInstall'),data={},
		C=$('cClose'),T=ace.edit('eCode');
T.setTheme('ace/theme/github');
T.setReadOnly(true);
(function(s){
	s.setMode('ace/mode/javascript');
	s.setUseWrapMode(true);
	s.setUseWorker(true);
})(T.getSession());
initCSS();initI18n();
$('bClose').onclick=function(){window.close();};
C.onchange=function(){
	chrome.runtime.sendMessage({cmd:'SetOption',data:{key:'closeAfterInstall',value:C.checked}});
};
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
			if(o.status>=0&&C.checked) window.close();
		},
	},f=maps[req.cmd];
	if(f) f(req.data,src,callback);
	return true;
});
chrome.runtime.sendMessage({cmd:'GetOption',data:'closeAfterInstall'},function(o){
	C.checked=!!o;
	var s=location.search.slice(1);
	s.split('&').forEach(function(i){
		i.replace(/^([^=]*)=(.*)$/,function(r,g1,g2){data[g1]=decodeURIComponent(g2);});
	});
	function error(){M.innerHTML=_('msgErrorLoadingURL',[data.url]);}
	if(!data.url) error(); else {
		M.innerHTML=_('msgLoadingURL',[data.url]);
		var x=new XMLHttpRequest();
		x.open('GET',data.url,true);
		x.onloadend=function(){
			if((!this.status||this.status==200)&&this.responseText) checkScript(this.responseText);
			else error();
		};
		x.send();
	}
});
