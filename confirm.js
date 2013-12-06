var $=document.getElementById.bind(document),M=$('msg'),I=$('bInstall'),data={},
		B=$('bClose'),C=$('cClose'),T;
B.onclick=function(){window.close();};
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
chrome.runtime.sendMessage({cmd:'GetOption',data:'closeAfterInstall'},function(o){C.checked=!!o;});
initEditor(function(o){
	T=o;o=location.search.slice(1);
	o.split('&').forEach(function(i){
		i.replace(/^([^=]*)=(.*)$/,function(r,g1,g2){data[g1]=decodeURIComponent(g2);});
	});
	function error(){M.innerHTML=_('msgErrorLoadingURL',[data.url]);}
	if(!data.url) error(); else {
		M.innerHTML=_('msgLoadingURL',[data.url]);
		var x=new XMLHttpRequest();
		x.open('GET',data.url,true);
		x.onloadend=function(){
			if((!this.status||this.status==200)&&this.responseText) {
				M.innerHTML=_('msgLoadedJS',[data.url]);
				T.setValueAndFocus(this.responseText);
				I.disabled=false;
			} else error();
		};
		x.send();
	}
},{exit:B.onclick,readonly:true});
initCSS();initI18n();
