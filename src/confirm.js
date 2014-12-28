var M=$('#msg'),I=$('#bInstall'),U=$('#url'),B=$('#bClose'),C=$('#cClose'),data={},T;
function showMsg(m,t){M.innerHTML=m;M.setAttribute('title',t||m);}
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
			require:data.require,
			resources:data.resources,
		},
	});
	I.disabled=true;
};
chrome.runtime.onMessage.addListener(function(req,src,callback) {
	var maps={
		ShowMessage: function(o){
			showMsg(o.message);
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
	U.innerHTML=_('msgScriptURL',[data.url||'-']);
	function error(){showMsg(_('msgErrorLoadingData'));}
	function loaded(){showMsg(_('msgLoadedData'));I.disabled=false;}
	if(data.url) {
		U.setAttribute('title',data.url);
		showMsg(_('msgLoadingData'));
		var x=new XMLHttpRequest();
		x.open('GET',data.url,true);
		x.onloadend=function(){
			if((!this.status||this.status==200)&&this.responseText) {
				T.setValueAndFocus(this.responseText);
				chrome.runtime.sendMessage({cmd:'ParseMeta',data:this.responseText},function(o){
					function next() {
						i++;
						if(i>=l) {
							if(err.length) showMsg(_('msgErrorLoadingDependency'),err.join('\n'));
							else loaded();
						} else showMsg(_('msgLoadingDependency',[i,l]));
					}
					function loadDependency(d,r,b) {
						r.forEach(function(u){
							var x=new XMLHttpRequest();
							x.open('GET',u,true);
							if(b) x.responseType='blob';
							x.onloadend=function(){
								if(this.status==200) {
									if(b) {
										var r=new FileReader();
										r.onload=function(e){
											d[u]=window.btoa(r.result);
											next();
										};
										r.readAsBinaryString(this.response);
										return;
									} else d[u]=this.responseText;
								} else err.push(u);
								next();
							};
							x.send();
						});
					}
					var i=0,l,err=[],u=[];
					for(l in o.resources) u.push(o.resources[l]);
					l=o.require.length+u.length;
					if(l) {
						showMsg(_('msgLoadingDependency',[i,l]));
						data.require={};
						loadDependency(data.require,o.require);
						data.resources={};
						loadDependency(data.resources,u,true);
					} else loaded();
				});
			} else error();
		};
		x.send();
	} else error();
},{exit:B.onclick,readonly:true});
initI18n();
