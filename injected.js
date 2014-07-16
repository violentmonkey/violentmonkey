(function(){
/**
* http://www.webtoolkit.info/javascript-utf8.html
*/
function utf8decode (utftext) {
	var string = "";
	var i = 0;
	var c = 0, c1 = 0, c2 = 0, c3 = 0;
	while ( i < utftext.length ) {
		c = utftext.charCodeAt(i);
		if (c < 128) {string += String.fromCharCode(c);i++;}
		else if((c > 191) && (c < 224)) {
			c2 = utftext.charCodeAt(i+1);
			string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
			i += 2;
		} else {
			c2 = utftext.charCodeAt(i+1);
			c3 = utftext.charCodeAt(i+2);
			string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
			i += 3;
		}
	}
	return string;
}

// Messages
var id=Math.random();
function post(data,callback){
	if(!data.data) data.data={};
	data.data['frameid']=id;
	chrome.runtime.sendMessage(data);
}
chrome.runtime.onMessage.addListener(function(req,src) {
	if(req.frameid&&req.frameid!=id) return;
	var maps={
		Command:command,
		GetPopup: getPopup,
	},f=maps[req.cmd];
	if(f) f(req.data,src);
});
function getPopup(){
	chrome.runtime.sendMessage({cmd:'SetPopup',data:[menu,ids]});
}

// Communicator
var comm={
	vmid:'VM'+Math.random(),
	sid:null,
	did:null,
	state:0,
	load:function(){},
	utf8decode:utf8decode,
	prop1:Object.getOwnPropertyNames(window),
	prop2:(function(n,p){
		while(n=Object.getPrototypeOf(n)) p=p.concat(Object.getOwnPropertyNames(n));
		return p;
	})(window,[]),
	init:function(s,d){
		this.sid=this.vmid+s;
		this.did=this.vmid+d;
		document.addEventListener(this.sid,this['handle'+s].bind(this),false);
	},
	post:function(d){
		var e=document.createEvent("MutationEvent");
		e.initMutationEvent(this.did,false,false,null,null,null,JSON.stringify(d),e.ADDITION);
		document.dispatchEvent(e);
	},
	handleR:function(e){
		var o=JSON.parse(e.attrName),comm=this,maps={
			LoadScript:comm.loadScript.bind(comm),
			Command:function(o){
				var f=comm.command[o];
				if(f) f();
			},
			GotRequestId:function(o){comm.qrequests.shift().start(o);},
			HttpRequested:function(o){
				var c=comm.requests[o.id];
				if(c) c.callback(o);
			},
		},f=maps[o.cmd];
		if(f) f(o.data);
	},
	loadScript:function(o){
		var start=[],idle=[],end=[],cache,require,values,comm=this,urls={};
		comm.command={};comm.requests={};comm.qrequests=[];
		function Request(details){
			this.callback=function(d){
				var i,c=details['on'+d.type];
				if(c) {
					if(d.data.response) {
						if(!this.data.length) {
							if(d.resType) {	// blob or arraybuffer
								var m=d.data.response.match(/^data:(.*?);base64,(.*)$/);
								if(!m) d.data.response=null;
								else {
									var b=window.atob(m[2]);
									if(details.responseType=='blob') {
										this.data.push(new Blob([b],{type:m[1]}));
									} else {	// arraybuffer
										m=new Uint8Array(b.length);
										for(i=0;i<b.length;i++) m[i]=b.charCodeAt(i);
										this.data.push(m.buffer);
									}
								}
							} else if(details.responseType=='json')	// json
								this.data.push(JSON.parse(d.data.response));
							else	// text
								this.data.push(d.data.response);
						}
						d.data.response=this.data[0];
					}
					// finalUrl not supported
					Object.defineProperty(d.data,'finalUrl',{
						get:function(){console.log('[Violentmonkey]Warning: finalUrl not supported for GM_xmlhttpRequest yet!');}
					});
					c(d.data);
				}
				if(!this.id)	// synchronous, not tested yet
					for(i in d.data) this.req[i]=d.data[i];
				if(d.type=='load') delete comm.requests[this.id];
			};
			this.start=function(id){
				this.id=id;
				comm.requests[id]=this;
				var data={
					id:id,
					method:details.method,
					url:details.url,
					data:details.data,
					async:!details.synchronous,
					user:details.user,
					password:details.password,
					headers:details.headers,
					overrideMimeType:details.overrideMimeType,
				};
				if(['arraybuffer','blob'].indexOf(details.responseType)>=0) data.responseType='blob';
				comm.post({cmd:'HttpRequest',data:data});
			};
			this.req={
				abort:function(){comm.post({cmd:'AbortRequest',data:this.id});}
			};
			this.data=[];
			comm.qrequests.push(this);
			comm.post({cmd:'GetRequestId'});
		}
		function wrapper(){
			// functions and properties
			function wrapFunction(o,i,c){
				var f=function(){
					var r;
					try{r=Function.apply.apply(o[i],[o,arguments]);}
					catch(e){console.log('Error calling '+i+': \n'+e.stack);}
					if(c) r=c(r);return r;
				};
				f.__proto__=o[i];f.prototype=o[i].prototype;
				return f;
			}
			function wrapWindow(w){return w==window?t:w;}
			function wrapItem(i){
				try{	// avoid reading protected data
					if(typeof window[i]=='function') {
						if(itemWrapper) t[i]=itemWrapper(window,i,wrapWindow);
						else t[i]=window[i];
					} else Object.defineProperty(t,i,{
						get:function(){return wrapWindow(window[i]);},
						set:function(v){window[i]=v;},
					});
				}catch(e){}
			}
			var t=this,itemWrapper=null;
			comm.prop1.forEach(wrapItem);
			itemWrapper=wrapFunction;
			comm.prop2.forEach(wrapItem);
		}
		function wrapGM(c){
			// Add GM functions
			// Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
			var gm={},value=values[c.uri]||{},w,g=c.meta.grant||[];
			if(!g.length||g.length==1&&g[0]=='none') {	// @grant none
				w={};g.pop();
			} else {
				w=new wrapper();
			}
			if(g.indexOf('unsafeWindow')<0) g.push('unsafeWindow');
			function propertyToString(){return 'Property for Violentmonkey: designed by Gerald';}
			function addProperty(name,prop,obj){
				if('value' in prop) prop.writable=false;
				prop.configurable=false;
				Object.defineProperty(obj,name,prop);
				if(typeof obj[name]=='function') obj[name].toString=propertyToString;
			}
			var resources=c.meta.resources||{},gf={
				unsafeWindow:{value:window},
				GM_info:{get:function(){
					var m=c.code.match(/\/\/\s+==UserScript==\s+([\s\S]*?)\/\/\s+==\/UserScript==\s/),
							script={
								description:c.meta.description||'',
								excludes:c.meta.exclude.concat(),
								includes:c.meta.include.concat(),
								matches:c.meta.match.concat(),
								name:c.meta.name||'',
								namespace:c.meta.namespace||'',
								resources:{},
								'run-at':c.meta['run-at']||'document-end',
								unwrap:false,
								version:c.meta.version||'',
							},
							o={};
					addProperty('script',{value:{}},o);
					addProperty('scriptMetaStr',{value:m?m[1]:''},o);
					addProperty('scriptWillUpdate',{value:c.update},o);
					addProperty('version',{value:undefined},o);
					for(m in script) addProperty(m,{value:script[m]},o.script);
					for(m in c.meta.resources) addProperty(m,{value:c.meta.resources[m]},o.script.resources);
					return o;
				}},
				GM_deleteValue:{value:function(key){delete value[key];comm.post({cmd:'SetValue',data:{uri:c.uri,values:value}});}},
				GM_getValue:{value:function(k,d){
					var v=value[k];
					if(v) {
						k=v[0];
						v=v.slice(1);
						switch(k){
							case 'n': d=Number(v);break;
							case 'b': d=v=='true';break;
							case 'o': try{d=JSON.parse(v);}catch(e){console.log(e);}break;
							default: d=v;
						}
					}
					return d;
				}},
				GM_listValues:{value:function(){return Object.getOwnPropertyNames(value);}},
				GM_setValue:{value:function(key,val){
					var t=(typeof val)[0];
					switch(t){
						case 'o':val=t+JSON.stringify(val);break;
						default:val=t+val;
					}
					value[key]=val;comm.post({cmd:'SetValue',data:{uri:c.uri,values:value}});
				}},
				GM_getResourceText:{value:function(name){
					var i,u;
					for(i in resources) if(name==i) {
						u=cache[resources[i]];
						if(u) u=comm.utf8decode(window.atob(u));
						return u;
					}
				}},
				GM_getResourceURL:{value:function(name){
					var i,u,r,j,b;
					for(i in resources) if(name==i) {
						i=resources[i];u=urls[i];
						if(!u&&(r=cache[i])) {
							r=window.atob(r);
							b=new Uint8Array(r.length);
							for(j=0;j<r.length;j++) b[j]=r.charCodeAt(j);
							b=new Blob([b]);
							urls[i]=u=URL.createObjectURL(b);
						}
						return u;
					}
				}},
				GM_addStyle:{value:function(css){
					if(!document.head) return;
					var v=document.createElement('style');
					v.innerHTML=css;
					document.head.appendChild(v);
					return v;
				}},
				GM_log:{value:function(d){console.log(d);}},
				GM_openInTab:{value:function(url){comm.post({cmd:'NewTab',data:url});}},
				GM_registerMenuCommand:{value:function(cap,func,acc){
					comm.command[cap]=func;comm.post({cmd:'RegisterMenu',data:[cap,acc]});
				}},
				GM_xmlhttpRequest:{value:function(details){
					var r=new Request(details);
					return r.req;
				}},
			};
			g.forEach(function(i){var o=gf[i];if(o) addProperty(i,o,gm);});
			return [w,gm];
		}
		function run(l){while(l.length) runCode(l.shift());}
		function runCode(c){
			var req=c.meta.require||[],i,r=[],code=[],w=wrapGM(c);
			Object.getOwnPropertyNames(w[1]).forEach(function(i){r.push(i+'=g["'+i+'"]');});
			if(r.length) code.push('var '+r.join(',')+';delete g;with(this)(function(){');
			for(i=0;i<req.length;i++) if(r=require[req[i]]) code.push(r);
			code.push(c.code);code.push('}).call(window);');
			code=code.join('\n');
			try{
				(new Function('g',code)).call(w[0],w[1]);
			}catch(e){
				console.log('Error running script: '+(c.custom.name||c.meta.name||c.id)+'\n'+e);
			}
		}
		comm.load=function(){
			if(comm.state>0) run(idle);
			if(comm.state>1) run(end);
		};

		o.scripts.forEach(function(i,l){
			if(i&&i.enabled) {
				switch(i.custom['run-at']||i.meta['run-at']){
					case 'document-start': l=start;break;
					case 'document-idle': l=idle;break;
					default: l=end;
				}
				l.push(i);
			}
		});
		require=o.require;
		cache=o.cache;
		values=o.values;
		run(start);comm.load();
	},
},menu=[],ids=[];
function handleC(e){
	var o=JSON.parse(e.attrName),maps={
		SetValue:function(o){post({cmd:'SetValue',data:o});},
		NewTab:function(o){post({cmd:'NewTab',data:o});},
		RegisterMenu:menu.push.bind(menu),
		GetRequestId:getRequestId,
		HttpRequest:httpRequest,
		AbortRequest:abortRequest,
	},f=maps[o.cmd];
	if(f) f(o.data);
}
function command(o){
	comm.post({cmd:'Command',data:o});
}

// Requests
var requests={};
function getRequestId() {
  var id=Date.now()+Math.random().toString().slice(1);
  requests[id]=new XMLHttpRequest();
	comm.post({cmd:'GotRequestId',data:id});
}
function httpRequest(details) {
  function callback(evt) {
		function finish(){
			comm.post({
				cmd: 'HttpRequested',
				data: {
					id: details.id,
					type: evt.type,
					resType: req.responseType,
					data: data
				}
			});
		}
		var data={
			readyState: req.readyState,
			responseHeaders: req.getAllResponseHeaders(),
			status: req.status,
			statusText: req.statusText
		},r;
		try {
			data.responseText=req.responseText;
		} catch(e) {}
		if(req.response&&req.responseType=='blob') {
			r=new FileReader();
			r.onload=function(e){
				data.response=r.result;
				finish();
			};
			r.readAsDataURL(req.response);
		} else {	// default `null` for blob and '' for text
			data.response=req.response;
			finish();
		}
  }
  var i,req,url=null;
  if(details.id) req=requests[details.id]; else req=new XMLHttpRequest();
  try {
    req.open(details.method,details.url,details.async,details.user,details.password);
    if(details.headers) for(i in details.headers) req.setRequestHeader(i,details.headers[i]);
		if(details.responseType) req.responseType='blob';
    if(details.overrideMimeType) req.overrideMimeType(details.overrideMimeType);
    ['abort','error','load','progress','readystatechange','timeout'].forEach(function(i) {
      req['on'+i]=callback;
    });
    req.send(details.data);
    if(!details.id) callback({type:'load'});
  } catch(e) {
		console.log(e);
  }
}
function abortRequest(id) {
  var req=requests[id];
  if(req) req.abort();
  delete requests[id];
}

// For injected scripts
function objEncode(o){
	var t=[],i;
	for(i in o) {
		if(!o.hasOwnProperty(i)) continue;
		if(typeof o[i]=='function') t.push(i+':'+o[i].toString());
		else t.push(i+':'+JSON.stringify(o[i]));
	}
	return '{'+t.join(',')+'}';
}
function initCommunicator(){
	var s=document.createElement('script'),d=document.documentElement,C='C',R='R';
	s.innerHTML='('+(function(c,R,C){
		function updateState(){
			c.state=["loading","interactive","complete"].indexOf(document.readyState);
			c.load();
		}
		c.init(R,C);
		document.addEventListener("readystatechange",updateState,false);
		updateState();
	}).toString()+')('+objEncode(comm)+',"'+R+'","'+C+'")';
	d.appendChild(s);d.removeChild(s);
	comm.handleC=handleC;comm.init(C,R);
	chrome.runtime.sendMessage({cmd:'GetInjected',data:location.href},loadScript);
}
function loadScript(o){
	o.scripts.forEach(function(i){ids.push(i.id);});
	comm.post({cmd:'LoadScript',data:o});
}
initCommunicator();
})();
