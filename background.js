var db,port=null,pos=0;
function getUniqId() {
	function int2str(i) {
		var k='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_+',
				s='',m;
		while(i>0) {
			m=i%64;
			s+=k[m];
			i=Math.floor(i/64);
		}
		return s;
	}
	return int2str(Date.now()%0x80000)+int2str(Math.floor(Math.random()*0x8000000000));
}
function notify(title,options) {
	function show() {
		var n=new Notification(title+' - '+_('extName'),{
			body:options.body,
			icon:'images/icon128.png',
		});
		n.onclick=options.onclick;
	}
	show();
	/*Notification.requestPermission(function(e){
		if(e=='granted') show(); else console.log('Notification: '+options.body);
	});*/
}
function initDb(callback) {
	var request=indexedDB.open('Violentmonkey',1);
	request.onsuccess=function(e){db=request.result;if(callback) callback();};
	request.onerror=function(e){console.log('IndexedDB error: '+e.target.error.message);};
	request.onupgradeneeded=function(e){
		var r=e.currentTarget.result,o;
		// scripts: id uri custom meta enabled update code position
		o=r.createObjectStore('scripts',{keyPath:'id',autoIncrement:true});
		o.createIndex('uri','uri',{unique:true});
		o.createIndex('update','update',{unique:false});
		o.createIndex('position','position',{unique:false});	// should be unique at last
		// require: uri code
		o=r.createObjectStore('require',{keyPath:'uri'});
		// cache: uri data
		o=r.createObjectStore('cache',{keyPath:'uri'});
		// values: uri values
		o=r.createObjectStore('values',{keyPath:'uri'});
	};
}
function getNameURI(i) {
  var ns=i.meta.namespace||'',n=i.meta.name||'',k=escape(ns)+':'+escape(n)+':';
  if(!ns&&!n) k+=i.id;
  return k;
}
function isRemote(url){
	return url&&!/^data:/.test(url);
}
function getMeta(j){return {id:j.id,custom:j.custom,meta:j.meta,enabled:j.enabled,update:j.update};}
function parseMeta(d){
	var o=-1,meta={include:[],exclude:[],match:[],require:[],resource:[],grant:[]};
	d.replace(/(?:^|\n)\/\/\s*([@=]\S+)(.*)/g,function(m,k,v){
		if(o<0&&k=='==UserScript==') o=1;
		else if(k=='==/UserScript==') o=0;
		if(o==1&&k[0]=='@') k=k.slice(1); else return;
		v=v.replace(/^\s+|\s+$/g,'');
		if(meta[k]&&meta[k].push) meta[k].push(v);	// multiple values allowed
		else if(!(k in meta)) meta[k]=v;	// only first value will be stored
	});
	meta.resources={};
	meta.resource.forEach(function(i){
		o=i.match(/^(\w\S*)\s+(.*)/);
		if(o) meta.resources[o[1]]=o[2];
	});
	delete meta.resource;
	if(!meta.homepageURL&&meta.homepage) meta.homepageURL=meta.homepage;	// @homepageURL instead of @homepage
	return meta;
}
function newScript() {
  var r={
    custom: {},
    enabled: 1,
    update: 1,
    code: '// ==UserScript==\n// @name New Script\n// ==/UserScript==\n'
  };
  r.meta=parseMeta(r.code);
  return r;
}
function removeScript(i,src,callback) {
	var o=db.transaction('scripts','readwrite').objectStore('scripts');
	o.delete(i);
	if(callback) callback();
}
function saveScript(i,src,callback) {
	var o=db.transaction('scripts','readwrite').objectStore('scripts');
	i.enabled=i.enabled?1:0;
	i.update=i.update?1:0;
	if(!i.position) i.position=++pos;
	if(callback) callback();
	return o.put(i);
}
function vacuum(o,src,callback) {
	var ids=[],cc={},rq={},vl={},w=0,p=0;
	function init(){
		var o=db.transaction('scripts').objectStore('scripts');
		o.index('position').openCursor().onsuccess=function(e){
			var r=e.target.result,v,i;
			if(r) {
				v=r.value;ids.push(v.id);
				v.meta.require.forEach(function(i){rq[i]=1;});
				for(i in v.meta.resources) cc[v.meta.resources[i]]=1;
				if(isRemote(v.meta.icon)) cc[v.meta.icon]=1;
				vl[v.uri]=1;
				r.continue();
			} else vacuumPosition();
		};
	}
	function vacuumPosition(){
		var i=ids.shift();
		if(i) {
			var o=db.transaction('scripts','readwrite').objectStore('scripts');
			o.get(i).onsuccess=function(e){
				var r=e.target.result;r.position=++p;
				o.put(r).onsuccess=vacuumPosition;
			};
		} else {
			pos=p;
			vacuumDB('require',rq);
			vacuumDB('cache',cc);
			vacuumDB('values',vl);
		}
	}
	function vacuumDB(dbName,dic){
		w++;
		var o=db.transaction(dbName,'readwrite').objectStore(dbName);
		o.openCursor().onsuccess=function(e){
			var r=e.target.result,v;
			if(r) {
				v=r.value;
				if(!dic[v.uri]) o.delete(v.uri);
				else dic[v.uri]++;	// stored
				r.continue();
			} else finish();
		};
	}
	function finish(){
		if(!--w) {
			var i;
			for(i in rq) if(rq[i]==1) fetchRequire(i);
			for(i in cc) if(cc[i]==1) fetchCache(i);
			chrome.tabs.sendMessage(src.tab.id,{cmd:'Vacuumed'});
		}
	}
	init();
	if(callback) callback();
}
function move(data,src,callback){
	var o=db.transaction('scripts','readwrite').objectStore('scripts');
	o.get(data.id).onsuccess=function(e){
		var r=e.target.result,k,s,x=r.position;
		if(data.offset<0) {
			k=IDBKeyRange.upperBound(x,true);
			s='prev';
			data.offset=-data.offset;
		} else {
			k=IDBKeyRange.lowerBound(x,true);
			s='next';
		}
		o.index('position').openCursor(k,s).onsuccess=function(e){
			var p=e.target.result,v;
			if(p) {
				data.offset--;
				v=p.value;v.position=x;o.put(v);x=p.key;
				if(data.offset) p.continue();
				else {r.position=x;o.put(r);}
			}
		};
	};
	if(callback) callback();
}
function str2RE(s){return s.replace(/(\.|\?|\/)/g,'\\$1').replace(/\*/g,'.*?');}
function autoReg(s, w) {
  if(!w&&s[0]=='/'&&s.slice(-1)=='/') return RegExp(s.slice(1,-1));
  return RegExp('^'+str2RE(s)+'$');
}
var match_reg=/(.*?):\/\/([^\/]*)\/(.*)/;
function matchTest(s,u) {
	if(s=='<all_urls>') return true;
  var m=s.match(match_reg);
  if(!m) return false;
	// scheme
	if(!(
		m[1]=='*'&&/^https?$/i.test(u[1])	// * = http|https
		||m[1]==u[1]
	)) return false;
	// host
  if(m[2]!='*') {
    if(m[2].slice(0,2)=='*.') {
      if(u[2]!=m[2].slice(2)&&u[2].slice(1-m[2].length)!=m[2].slice(1)) return false;
    } else if(m[2]!=u[2]) return false;
  }
	// pathname
  if(!autoReg(m[3],1).test(u[3])) return false;
  return true;
}
function testURL(url,e) {
  var f=true,i,inc=[],exc=[],mat=[],u=url.match(match_reg);
  if(e.custom._match!=false&&e.meta.match) mat=mat.concat(e.meta.match);
  if(e.custom.match) mat=mat.concat(e.custom.match);
  if(e.custom._include!=false&&e.meta.include) inc=inc.concat(e.meta.include);
  if(e.custom.include) inc=inc.concat(e.custom.include);
  if(e.custom._exclude!=false&&e.meta.exclude) exc=exc.concat(e.meta.exclude);
  if(e.custom.exclude) exc=exc.concat(e.custom.exclude);
  if(mat.length) {
    for(i=0;i<mat.length;i++) if(f=matchTest(mat[i],u)) break;
  } else for(i=0;i<inc.length;i++) if(f=autoReg(inc[i]).test(url)) break;
  if(f) for(i=0;i<exc.length;i++) if(!(f=!autoReg(exc[i]).test(url))) break;
  return f;
}
function getScript(id,src,callback) {	// for user edit
	var o=db.transaction('scripts').objectStore('scripts');
	o.get(id).onsuccess=function(e){
		var r=e.target.result,v;
		if(r) {
			v=getMeta(r);
			v.code=r.code;
			if(callback) callback(v);
		}
	};
}
function getMetas(ids,src,callback) {	// for popup menu
	var o=db.transaction('scripts').objectStore('scripts'),data=[],id;
	function getOne(){
		var id=ids.shift();
		if(id) o.get(id).onsuccess=function(e){
			var r=e.target.result;
			if(r) data.push(getMeta(r));
			getOne();
		}; else callback(data);
	}
	getOne();
}
var badges={};
function setBadge(n,src,callback) {
	var o;
	if(src.id in badges) o=badges[src.id];
	else badges[src.id]=o={num:0};
	o.num+=n;
	chrome.browserAction.setBadgeBackgroundColor({color:'#808',tabId:src.tab.id});
	chrome.browserAction.setBadgeText({text:o.num.toString(),tabId:src.tab.id});
	if(o.timer) clearTimeout(o.timer);
	o.timer=setTimeout(function(){delete badges[src.id];},300);
	callback();
}
function getCacheB64(ids,src,callback) {
	var o=db.transaction('cache').objectStore('cache'),data={};
	function loop(){
		var i=ids.pop();
		if(i) o.get(i).onsuccess=function(e){
			var r=e.target.result,b,u;
			if(r) {
				if(typeof r.data=='string') data[i]=r.data;
				else
					// XXX: old data, update it
					setTimeout(function(){fetchCache(i)},1);
			}
			loop();
		}; else callback(data);
	}
	loop();
}
function getInjected(url,src,callback) {	// for injected
	function getScripts(){
		var o=db.transaction('scripts').objectStore('scripts'),require={};
		o.index('position').openCursor().onsuccess=function(e){
			var i,r=e.target.result,v;
			if(r) {
				v=r.value;
				if(testURL(url,v)) {
					data.scripts.push(v);if(v.enabled) n++;
					values.push(v.uri);
					v.meta.require.forEach(function(i){require[i]=1;});
					for(i in v.meta.resources) cache[v.meta.resources[i]]=1;
				}
				r.continue();
			} else getRequire(Object.getOwnPropertyNames(require));
		};
	}
	function getRequire(require){
		function loop(){
			var i=require.pop();
			if(i) o.get(i).onsuccess=function(e){
				var r=e.target.result;
				if(r) data.require[i]=r.code;
				loop();
			}; else getCache();
		}
		var o=db.transaction('require').objectStore('require');
		loop();
	}
	function getCache(){
		getCacheB64(Object.getOwnPropertyNames(cache),src,function(o){
			data.cache=o;
			getValues();
		});
	}
	function getValues(){
		function loop(){
			var i=values.pop();
			if(i) o.get(i).onsuccess=function(e){
				var r=e.target.result;
				if(r) data.values[i]=r.values;
				loop();
			}; else finish();
		}
		var o=db.transaction('values').objectStore('values');
		loop();
	}
	function finish(){
		callback(data);
		if(n&&src.url==src.tab.url) chrome.tabs.sendMessage(src.tab.id,{cmd:'GetBadge'});
	}
	var data={scripts:[],values:{},require:{}},cache={},values=[],n=0;
	if(data.isApplied=settings.isApplied) getScripts(); else finish();
}
function fetchURL(url, cb, type, headers) {
  var req=new XMLHttpRequest(),i;
  req.open('GET', url, true);
  if(type) req.responseType = type;
	if(headers) for(i in headers)
		req.setRequestHeader(i,headers[i]);
  if(cb) req.onloadend = cb;
  req.send();
}
var u_cache={},u_require={};
function saveCache(url,data,callback) {
	var o=db.transaction('cache','readwrite').objectStore('cache');
	o.put({uri:url,data:data}).onsuccess=callback;
}
function fetchCache(url) {
	if(u_cache[url]) return;
	u_cache[url]=1;
	fetchURL(url, function() {
		if (this.status!=200) return;
		//saveCache(url,this.response,function(){delete u_cache[url];});
		var r=new FileReader();
		r.onload=function(e){
			saveCache(url,window.btoa(r.result),function(){delete u_cache[url];});
		};
		r.readAsBinaryString(this.response);
	}, 'blob');
}
function saveRequire(url,data,callback) {
	var o=db.transaction('require','readwrite').objectStore('require');
	o.put({uri:url,code:data}).onsuccess=callback;
}
function fetchRequire(url) {
	if(u_require[url]) return;
	u_require[url]=1;
	fetchURL(url, function(){
		if(this.status==200) saveRequire(url,this.responseText,function(){delete u_require[url];});
	});
}
function updateItem(r){
	if(port) try{
		port.postMessage(r);
	}catch(e){
		port=null;
		console.log(e);
	}
}
function queryScript(id,meta,callback){
	var o=db.transaction('scripts').objectStore('scripts');
	function finish(r){
		if(!r) r=newScript();
		if(callback) callback(r);
	}
	function queryMeta() {
		var uri=getNameURI({id:'',meta:meta});
		if(uri!='::') o.index('uri').get(uri).onsuccess=function(e){
			finish(e.target.result);
		}; else finish();
	}
	function queryId() {
		if(id) o.get(id).onsuccess=function(e){
			var r=e.target.result;
			if(r) finish(r); else queryMeta();
		}; else queryMeta();
	}
	queryId();
}
function parseScript(o,src,callback) {
	var i,r={status:0,message:'message' in o?o.message:_('msgUpdated')};
	function finish(){
		if(src) chrome.tabs.sendMessage(src.tab.id,{cmd:'ShowMessage',data:r});
		updateItem(r);
	}
	if(o.status&&o.status!=200||o.code=='') {	// net error
		r.status=-1;r.message=_('msgErrorFetchingScript');finish();
	} else {	// store script
		var meta=parseMeta(o.code);
		queryScript(o.id,meta,function(c){
			if(!c.id){r.status=1;r.message=_('msgInstalled');}
			if(o.more) for(i in o.more) if(i in c) c[i]=o.more[i];	// for import and user edit
			c.meta=meta;c.code=o.code;c.uri=getNameURI(c);
			if(o.from&&!c.meta.homepageURL&&!c.custom.homepageURL&&!/^(file|data):/.test(o.from)) c.custom.homepageURL=o.from;
			if(o.url&&!/^(file|data):/.test(o.url)) c.custom.lastInstallURL=o.url;
			saveScript(c,src).onsuccess=function(e){
				r.id=c.id=e.target.result;r.obj=getMeta(c);finish();
				if(!meta.grant.length)
					notify(_('Warning'),{
						body:_('msgWarnGrant',[meta.name||_('labelNoName')]),
						onclick:function(){
							chrome.tabs.create({url:'http://wiki.greasespot.net/@grant'});
							this.close();
						},
					});
			};
		});
		meta.require.forEach(function(u){	// @require
			var c=o.require&&o.require[u];
			if(c) saveRequire(u,c); else fetchRequire(u);
		});
		for(d in meta.resources) {	// @resource
			var u=meta.resources[d],c=o.resources&&o.resources[u];
			if(c) saveCache(u,c); else fetchCache(u);
		}
		if(isRemote(meta.icon)) fetchCache(meta.icon);	// @icon
	}
	if(callback) callback();
}
function canUpdate(o,n){
  o=(o||'').split('.');
  n=(n||'').split('.');
  var r=/(\d*)([a-z]*)(\d*)([a-z]*)/i;
  while(o.length&&n.length){
    var vo=o.shift().match(r),vn=n.shift().match(r);
    vo.shift();vn.shift();
    vo[0]=parseInt(vo[0]||0,10);
    vo[2]=parseInt(vo[2]||0,10);
    vn[0]=parseInt(vn[0]||0,10);
    vn[2]=parseInt(vn[2]||0,10);
    while(vo.length&&vn.length){
      var eo=vo.shift(),en=vn.shift();
      if(eo!=en) return eo<en;
    }
  }
  return n.length;
}
function setValue(data,src,callback){
	var o=db.transaction('values','readwrite').objectStore('values');
	o.put({uri:data.uri,values:data.values});
	if(callback) callback();	// it seems that CALLBACK does not work with READWRITE transaction
}
function getOption(k,src,callback){
	var v=localStorage.getItem(k)||'',r=true;
	try{
		v=JSON.parse(v);
		settings[k]=v;
	}catch(e){
		v=null;
		r=false;
	}
	if(callback) callback(v);
	return r;
}
function setOption(o,src,callback){
	if(!o.check||(o.key in settings)) {
		localStorage.setItem(o.key,JSON.stringify(o.value));
		settings[o.key]=o.value;
	}
	if(callback) callback(o.value);
}
function initSettings(){
	function init(k,v){
		if(!getOption(k)) setOption({key:k,value:v});
	}
	init('isApplied',true);
	init('autoUpdate',true);
	init('lastUpdate',0);
	init('withData',true);
	init('closeAfterInstall',false);
	init('dataVer',0);
}
function updateMeta(d,src,callback) {
	var o=db.transaction('scripts','readwrite').objectStore('scripts');
	o.get(d.id).onsuccess=function(e){
		var r=e.target.result,i;
		if(!r) return;
		for(i in d) if(i in r) r[i]=d[i];
		o.put(r).onsuccess=function(e){	// store script without another transaction
			updateItem({id:d.id,obj:getMeta(r),status:0});
		};
	};
	if(callback) callback();
}
var _update={};
function checkUpdateO(o) {
	if(_update[o.id]) return;_update[o.id]=1;
	function finish(){delete _update[o.id];}
  var r={id:o.id,updating:1,status:2};
  function update() {
    if(du) {
      r.message=_('msgUpdating');
      fetchURL(du,function(){
        parseScript({
					id: o.id,
          status: this.status,
          code: this.responseText
        });
      });
    } else r.message='<span class=new>'+_('msgNewVersion')+'</span>';
    updateItem(r);finish();
  }
	var du=o.custom.downloadURL||o.meta.downloadURL||o.custom.lastInstallURL,
			u=o.custom.updateURL||o.meta.updateURL||du;
  if(u) {
    r.message=_('msgCheckingForUpdate');updateItem(r);
    fetchURL(u,function() {
      r.message=_('msgErrorFetchingUpdateInfo');
      if(this.status==200) try {
        var m=parseMeta(this.responseText);
        if(canUpdate(o.meta.version,m.version)) return update();
        r.message=_('msgNoUpdate');
      } catch(e){}
      delete r.updating;
      updateItem(r);finish();
    },null,{Accept:'text/x-userscript-meta'});
  } else finish();
}
function checkUpdate(id,src,callback) {
	var o=db.transaction('scripts').objectStore('scripts');
	o.get(id).onsuccess=function(e){
		var r=e.target.result;
		if(r) checkUpdateO(r);
		if(callback) callback();
	};
}
function checkUpdateAll(e,src,callback) {
	setOption({key:'lastUpdate',value:Date.now()});
	var o=db.transaction('scripts').objectStore('scripts');
	o.index('update').openCursor(1).onsuccess=function(e){
		var r=e.target.result;
		if(!r) {
			if(callback) callback();
			return;
		}
		checkUpdateO(r.value);
		r.continue();
	};
}
var checking=false;
function autoCheck() {
  function check() {
		if(settings.autoUpdate) {
			if(Date.now()-settings.lastUpdate>=864e5) checkUpdateAll();
			setTimeout(check,36e5);
		} else checking=false;
  }
  if(!checking) {checking=true;check();}
}
function autoUpdate(o,src,callback){
	o=!!o;
	setOption({key:'autoUpdate',value:o},src,autoCheck);
	if(callback) callback(o);
}
function getData(d,src,callback) {
	function getScripts(){
		var o=db.transaction('scripts').objectStore('scripts');
		o.index('position').openCursor().onsuccess=function(e){
			var r=e.target.result,v;
			if(r) {
				v=r.value;
				if(isRemote(v.meta.icon)) cache[v.meta.icon]=1;
				data.scripts.push(getMeta(v));
				r.continue();
			} else getCache();
		};
		function getCache(){
			getCacheB64(Object.getOwnPropertyNames(cache),src,function(o){
				for(var i in o) o[i]='data:image/png;base64,'+o[i];
				data.cache=o;
				callback(data);
			});
		}
	}
	var data={settings:settings,scripts:[]},cache={};
	getScripts();
}
function exportZip(z,src,callback){
	function getScripts(){
		function loop(){
			var i=z.data.shift();
			if(i) o.get(i).onsuccess=function(e){
				var r=e.target.result;
				if(r) {
					d.scripts.push(r);
					if(z.values) values.push(r.uri);
				}
				loop();
			}; else getValues();
		}
		var o=db.transaction('scripts').objectStore('scripts');
		loop();
	}
	function getValues(){
		function loop(){
			var i=values.shift();
			if(i) o.get(i).onsuccess=function(e){
				var r=e.target.result;
				if(r) d.values[i]=r.values;
				loop();
			}; else finish();
		}
		if(z.values) {
			var o=db.transaction('values').objectStore('values');
			d.values={};loop();
		} else finish();
	}
	function finish(){callback(d);}
	var d={scripts:[],settings:settings},values=[];
	getScripts();
}

// Requests
var requests={},request_id_map={},special_headers=['user-agent'];
function getRequestId(data,src,callback) {
  var id=getUniqId();
	// XHR, finalUrl, requestId in browser
  requests[id]=[new XMLHttpRequest(),'',''];
	callback(id);
}
function httpRequest(details,src,callback) {
  function reqCallback(evt) {
		function finish(){
			chrome.tabs.sendMessage(src.tab.id,{
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
			finalUrl: reqo[1],
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
		if(evt.type=='loadend') {
			if(reqo[2]) delete request_id_map[reqo[2]];
			delete requests[details.id];
		}
  }
  var i,il,v,reqo=requests[details.id],req;
	if(!reqo) return;req=reqo[0];
  try {
		// details.async=true;
    req.open(details.method,details.url,true,details.user,details.password);
		req.setRequestHeader('VM-Verify',details.id);
    if(details.headers)
			for(i in details.headers) {
				v=details.headers[i];
				if(special_headers.indexOf(i.toLowerCase())>=0)
					req.setRequestHeader('VM-'+i,v);
				else req.setRequestHeader(i,v);
			}
		if(details.responseType) req.responseType='blob';
    if(details.overrideMimeType) req.overrideMimeType(details.overrideMimeType);
    ['abort','error','load','loadend','progress','readystatechange','timeout'].forEach(function(i) {
      req['on'+i]=reqCallback;
    });
		reqo[1]=details.url;
		req.send(details.data);
  } catch(e) {
		console.log(e);
  }
}
function abortRequest(id) {
  var req=requests[id];
  if(req) req.abort();
  delete requests[id];
}

chrome.runtime.onConnect.addListener(function(p){
	port=p;
	p.onDisconnect.addListener(function(){port=null;});
});
var settings={};
initSettings();
initDb(function(){
	var dataVer=1;
	getOption('dataVer',null,function(ver){
		pos=null;
		var o=db.transaction('scripts','readwrite').objectStore('scripts');
		o.index('position').openCursor(null,'prev').onsuccess=function(e){
			var r=e.target.result;
			if(pos===null) pos=r?r.key:0;
			if(ver<dataVer) {
				if(r) {
					r.value.meta=parseMeta(r.value.code);
					o.put(r.value).onsuccess=function(){r.continue();};
				} else {
					console.log('Data upgraded.');
					setOption({key:'dataVer',value:dataVer});
				}
			}
		};
	});
	chrome.runtime.onMessage.addListener(function(req,src,callback) {
		var maps={
			NewScript:function(o,src,callback){callback(newScript());},
			RemoveScript: removeScript,
			GetData: getData,
			GetInjected: getInjected,
			CheckUpdate: checkUpdate,
			CheckUpdateAll: checkUpdateAll,
			SaveScript: saveScript,
			UpdateMeta: updateMeta,
			SetValue: setValue,
			GetOption: getOption,
			SetOption: setOption,
			ExportZip: exportZip,
			ParseScript: parseScript,
			GetScript: getScript,	// for user edit
			GetMetas: getMetas,	// for popup menu
			SetBadge: setBadge,
			AutoUpdate: autoUpdate,
			Vacuum: vacuum,
			Move: move,
			ParseMeta: function(o,src,callback){callback(parseMeta(o));},
			GetRequestId: getRequestId,
			HttpRequest: httpRequest,
			AbortRequest: abortRequest,
		},f=maps[req.cmd];
		if(f) f(req.data,src,callback);
		return true;
	});
	chrome.browserAction.setIcon({path:'images/icon19'+(settings.isApplied?'':'w')+'.png'});
	setTimeout(autoCheck,2e4);
});
chrome.webRequest.onBeforeRequest.addListener(function(o){
	if(/\.user\.js([\?#]|$)/.test(o.url)) {
		var x=new XMLHttpRequest();
		x.open('GET',o.url,false);
		x.send();
		if((!x.status||x.status==200)&&!/^\s*</.test(x.responseText)) {
			if(o.tabId<0) chrome.tabs.create({url:chrome.extension.getURL('/confirm.html')+'?url='+encodeURIComponent(o.url)});
			else chrome.tabs.get(o.tabId,function(t){
				chrome.tabs.create({url:chrome.extension.getURL('/confirm.html')+'?url='+encodeURIComponent(o.url)+'&from='+encodeURIComponent(t.url)});
			});
			return {redirectUrl:'javascript:history.back()'};
		}
	}
},{
	urls:['<all_urls>'],types:['main_frame']
},['blocking']);
// Modifications on headers
chrome.webRequest.onBeforeSendHeaders.addListener(function(details) {
	var headers=details.requestHeaders,new_headers=[],vm_headers={},v,i;
	headers.forEach(function(header){
		if(header.name.substr(0,3)=='VM-')
			vm_headers[header.name.substr(3)]=header.value;
		else
			new_headers.push(header);
	});
	v=vm_headers['Verify'];
	if(v&&(i=requests[v])) {
		delete vm_headers['Verify'];
		request_id_map[details.requestId]=v;
		i[2]=details.requestId;
		for(i in vm_headers)
			if(special_headers.indexOf(i.toLowerCase())>=0)
				new_headers.push({name:i,value:vm_headers[i]});
	}
	return {requestHeaders: new_headers};
},{
	urls:['<all_urls>'],types: ['xmlhttprequest'],
},["blocking", "requestHeaders"]);
// Watch URL redirects
chrome.webRequest.onBeforeRedirect.addListener(function(details) {
	var v=request_id_map[details.requestId],reqo;
	if(v) {
		reqo=requests[v];
		if(reqo) reqo[1]=details.redirectUrl;
	}
},{
	urls:['<all_urls>'],types: ['xmlhttprequest'],
});
