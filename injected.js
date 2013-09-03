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
	init:function(s,d){
		comm.sid=comm.vmid+s;
		comm.did=comm.vmid+d;
		document.addEventListener(comm.sid,comm['handle'+s],false);
	},
	post:function(d){
		var e=document.createEvent("MutationEvent");
		e.initMutationEvent(comm.did,false,false,null,null,null,JSON.stringify(d),e.ADDITION);
		document.dispatchEvent(e);
	},
	handleR:function(e){
		var o=JSON.parse(e.attrName),maps={
			LoadScript:comm.loadScript,
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
		var start=[],body=[],end=[],cache,require,values,elements;
		comm.command={};comm.requests={};comm.qrequests=[];
		function wrapper(c){
			var t=this,value=values[c.uri];if(!value) value={};

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
			var itemWrapper=null;
			Object.getOwnPropertyNames(window).forEach(wrapItem);
			itemWrapper=wrapFunction;
			n=window;while(n=Object.getPrototypeOf(n)) Object.getOwnPropertyNames(n).forEach(wrapItem);

			function getCache(name){for(var i in resources) if(name==i) return cache[resources[i]];}
			function propertyToString(){return 'Property for Violentmonkey: designed by Gerald';}
			function addProperty(name,prop,obj){
				if('value' in prop) prop.writable=false;
				prop.configurable=false;
				if(!obj) {obj=t;elements.push(name);}
				Object.defineProperty(obj,name,prop);
				if(typeof obj[name]=='function') obj[name].toString=propertyToString;
			}
			var resources=c.meta.resources||{};elements=[];
			addProperty('unsafeWindow',{value:window});
			// GM functions
			// Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
			addProperty('GM_info',{get:function(){
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
			}});
			addProperty('GM_deleteValue',{value:function(key){delete value[key];comm.post({cmd:'SetValue',data:{uri:c.uri,values:value}});}});
			addProperty('GM_getValue',{value:function(k,d){
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
			}});
			addProperty('GM_listValues',{value:function(){return Object.getOwnPropertyNames(value);}});
			addProperty('GM_setValue',{value:function(key,val){
				var t=(typeof val)[0];
				switch(t){
					case 'o':val=t+JSON.stringify(val);break;
					default:val=t+val;
				}
				value[key]=val;comm.post({cmd:'SetValue',data:{uri:c.uri,values:value}});
			}});
			addProperty('GM_getResourceText',{value:function(name){
				var b=getCache(name);
				if(b) b=utf8decode(b);
				return b;
			}});
			addProperty('GM_getResourceURL',{value:function(name){
				return getCache(name);
			}});
			addProperty('GM_addStyle',{value:function(css){
				if(!document.head) return;
				var v=document.createElement('style');
				v.innerHTML=css;
				document.head.appendChild(v);
				return v;
			}});
			addProperty('GM_log',{value:console.log});
			addProperty('GM_openInTab',{value:function(url){window.open(url);}});
			addProperty('GM_registerMenuCommand',{value:function(cap,func,acc){
				comm.command[cap]=func;comm.post({cmd:'RegisterMenu',data:[cap,acc]});
			}});
			function Request(details){
				this.callback=function(d){
					var c=details['on'+d.type];
					if(c) c(d.data);
					if(!this.id) for(var i in d.data) this.req[i]=d.data[i];
					if(d.type=='load') delete comm.requests[this.id];
				};
				this.start=function(id){
					this.id=id;
					comm.requests[id]=this;
					comm.post({cmd:'HttpRequest',data:{
						id:id,
						method:details.method,
						url:details.url,
						data:details.data,
						async:!details.synchronous,
						user:details.user,
						password:details.password,
						headers:details.headers,
						overrideMimeType:details.overrideMimeType,
					}});
				};
				this.req={
					abort:function(){comm.post({cmd:'AbortRequest',data:this.id});}
				};
				comm.qrequests.push(this);
				comm.post({cmd:'GetRequestId'});
			};
			addProperty('GM_xmlhttpRequest',{value:function(details){
				var r=new Request(details);
				return r.req;
			}});
		}
		function runStart(){while(start.length) runCode(start.shift());}
		function runBody(){
			if(document.body) {
				window.removeEventListener('DOMNodeInserted',runBody,true);
				while(body.length) runCode(body.shift());
			}
		}
		function runEnd(){while(end.length) runCode(end.shift());}
		function runCode(c){
			var w=new wrapper(c),req=c.meta.require||[],i,r,f,code=[];
			elements.forEach(function(i){code.push(i+'=window.'+i);});
			code=['(function(){var '+code.join(',')+';'];
			for(i=0;i<req.length;i++) if(r=require[req[i]]) code.push(r);
			code.push(c.code);code.push('})();');
			code=code.join('\n');
			f=new Function('w','with(w) eval('+JSON.stringify(code)+');');
			try{f.call(w,w);}catch(e){
				console.log('Error running script: '+(c.custom.name||c.meta.name||c.id)+'\n'+e);
			}
		}

		var l;
		o.scripts.forEach(function(i){
			if(i&&i.enabled) {
				switch(i.custom['run-at']||i.meta['run-at']){
					case 'document-start': l=start;break;
					case 'document-body': l=body;break;
					default: l=end;
				}
				l.push(i);
			}
		});
		require=o.require;
		cache=o.cache;
		values=o.values;
		runStart();
		window.addEventListener('DOMNodeInserted',runBody,true);
		window.addEventListener('DOMContentLoaded',runEnd,false);
		runBody();
		if(document.readyState=='complete') runEnd();
	},
},menu=[],ids=[];
function handleC(e){
	var o=JSON.parse(e.attrName),maps={
		SetValue:function(o){post({cmd:'SetValue',data:o});},
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
    comm.post({
      cmd: 'HttpRequested',
      data: {
        id: details.id,
        type: evt.type,
        data: {
          readyState: req.readyState,
          responseHeaders: req.getAllResponseHeaders(),
          responseText: req.responseText,
          status: req.status,
          statusText: req.statusText
        }
      }
    });
  }
  var i,req;
  if(details.id) req=requests[details.id]; else req=new XMLHttpRequest();
  try {
    req.open(details.method,details.url,details.async,details.user,details.password);
    if(details.headers) for(i in details.headers) req.setRequestHeader(i,details.headers[i]);
    if(details.overrideMimeType) req.overrideMimeType(details.overrideMimeType);
    ['abort','error','load','progress','readystatechange','timeout'].forEach(function(i) {
      req['on'+i]=callback;
    });
    req.send(details.data);
    if(!details.id) callback({type:'load'});
  } catch (e) {
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
	s.innerHTML='(function(){var comm='+objEncode(comm)+';comm.init("'+R+'","'+C+'");})();';
	d.appendChild(s);d.removeChild(s);
	comm.handleC=handleC;comm.init(C,R);
	chrome.runtime.sendMessage({cmd:'GetInjected'},loadScript);
}
function loadScript(o){
	o.scripts.forEach(function(i){ids.push(i.id);});
	comm.post({cmd:'LoadScript',data:o});
}
initCommunicator();
