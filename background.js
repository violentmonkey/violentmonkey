var db,port=null,pos=0;
function initDb(callback) {
	var request=indexedDB.open('Violentmonkey',1);
	request.onsuccess=function(e){db=request.result;if(callback) callback();};
	request.onerror=function(e){console.log('IndexedDB error: '+e.target.webkitErrorMessage);};
	request.onupgradeneeded=function(e){
		var r=e.currentTarget.result,o,i;
		// settings: key value
		o=r.createObjectStore('settings',{keyPath:'key'});
		[
			{key:'showDetails',value:false},
			{key:'lastUpdate',value:0},
			{key:'maxPosition',value:0},
			{key:'withData',value:true},
			{key:'showButton',value:true},
			{key:'isApplied',value:true},
			{key:'autoUpdate',value:true},
			{key:'search',value:_('defaultSearch')},
		].forEach(function(i){o.add(i);});
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
function newPosition(){
	setOption({key:'maxPosition',value:++pos});
	return pos;
}
function getNameURI(i) {
  var ns=i.meta.namespace||'',n=i.meta.name||'',k=escape(ns)+':'+escape(n)+':';
  if(!ns&&!n) k+=i.id;
  return k;
}
function getMeta(j){return {id:j.id,custom:j.custom,meta:j.meta,enabled:j.enabled,update:j.update};}
function parseMeta(d){
	var o=-1,meta={include:[],exclude:[],match:[],require:[],resources:{}};
	meta.resource=[];
	d.replace(/(?:^|\n)\/\/\s*([@=]\S+)(.*)/g,function(m,k,v){
		if(o<0&&k=='==UserScript==') o=1;
		else if(k=='==/UserScript==') o=0;
		if(o==1&&k[0]=='@') k=k.slice(1); else return;
		v=v.replace(/^\s+|\s+$/g,'');
		if(meta[k]&&meta[k].push) meta[k].push(v);	// multiple values allowed
		else if(!(k in meta)) meta[k]=v;	// only first value will be stored
	});
	meta.resource.forEach(function(i){
		o=i.match(/^(\w+)\s+(.*)/);
		if(o) meta.resources[o[1]]=o[2];
	});
	delete meta.resource;
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
	if(!i.position) i.position=newPosition();
	if(callback) callback();
	return o.put(i);
}
function vacuum(o,src,callback) {
	var cc={},rq={},vl={},w=0;
	function vacuumPosition(){
		var o=db.transaction('scripts','readwrite').objectStore('scripts'),p=0;
		o.index('position').openCursor().onsuccess=function(e){
			var r=e.target.result,v,i;
			if(r) {
				v=r.value;p++;
				if(v.position!=p) {v.position=p;o.put(v);}
				v.meta.require.forEach(function(i){rq[i]=1;});
				for(i in v.meta.resources) cc[i]=1;
				if(v.meta.icon) cc[v.meta.icon]=1;vl[v.uri]=1;
				r.continue();
			} else {
				vacuumDB('require',rq);
				vacuumDB('cache',cc);
				vacuumDB('values',vl);
			}
		};
	}
	function vacuumDB(dbName,dic){
		w++;
		var o=db.transaction(dbName,'readwrite').objectStore(dbName);
		o.openCursor().onsuccess=function(e){
			var r=e.target.result,v;
			if(r) {
				v=r.value;
				if(!dic[v.uri]) o.delete(v.uri);
				r.continue();
			} else finish();
		};
	}
	function finish(){
		if(!--w) chrome.tabs.sendMessage(src.tab.id,{cmd:'Vacuumed'});
	}
	vacuumPosition();
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
			var p=e.target.result,v,y;
			if(p) {
				data.offset--;
				v=p.value;y=v.position;
				v.position=x;o.put(v);x=y;
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
  var m=s.match(match_reg);
  if(!m) return false;
  if(m[1]=='*') {
    if(u[1]!='http'&&u[1]!='https') return false;
  } else if(m[1]!=u[1]) return false;
  if(m[2]!='*') {
    if(m[2].slice(0,2)=='*.') {
      if(u[2]!=m[2].slice(2)&&u[2].slice(1-m[2].length)!=m[2].slice(1)) return false;
    } else if(m[2]!=u[2]) return false;
  }
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
function findScript(o,src,callback) {	// for injected
	function getSettings(){
		var o=db.transaction('settings').objectStore('settings');
		o.get('isApplied').onsuccess=function(e){
			var r=e.target.result;
			if(data.isApplied=r.value) getScripts();
			else finish();
		};
	}
	function getScripts(){
		function addCache(i,c,d){
			if(!(i in d)) {c.push(i);d[i]=null;}
		}
		var o=db.transaction('scripts').objectStore('scripts'),n=0;
		o.index('position').openCursor().onsuccess=function(e){
			var i,r=e.target.result,v;
			if(r) {
				v=r.value;
				if(testURL(src.tab.url,v)) {
					data.scripts.push(v);if(v.enabled) n++;
					values.push(v.uri);
					v.meta.require.forEach(function(i){addCache(i,require,data.require);});
					for(i in v.meta.resources) addCache(v.meta.resources[i],cache,data.cache);
				}
				r.continue();
			} else {
				if(n) {
					chrome.browserAction.setBadgeBackgroundColor({color:'#808',tabId:src.tab.id});
					chrome.browserAction.setBadgeText({text:n.toString(),tabId:src.tab.id});
				}
				getRequire();
			}
		};
	}
	function getRequire(){
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
		function loop(){
			var i=cache.pop();
			if(i) o.get(i).onsuccess=function(e){
				var r=e.target.result;
				if(r) data.cache[i]=new Int8Array(r.data);
				loop();
			}; else getValues();
		}
		var o=db.transaction('cache').objectStore('cache');
		loop();
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
	function finish(){callback(data);}
	var data={isApplied:true,scripts:[],require:{},cache:{},values:{}},cache=[],values=[],require=[];
	getSettings();
}
function fetchURL(url, cb, type) {
  var req = new XMLHttpRequest();
  req.open('GET', url, true);
  if (type) req.responseType = type;
  if (cb) req.onloadend = cb;
  req.send();
}
function fetchCache(url) {
	fetchURL(url, function() {
		if (this.status!=200) return;
		var o=db.transaction('cache','readwrite').objectStore('cache');
		o.put({uri:url,data:this.response});
	}, 'arraybuffer');
}
function fetchRequire(url) {
	fetchURL(url, function() {
		if (this.status!=200) return;
		var o=db.transaction('require','readwrite').objectStore('require');
		o.put({uri:url,code:this.responseText});
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
	function queryMeta() {
		var uri=getNameURI({id:'',meta:meta});
		if(uri!='::') o.index('uri').get(uri).onsuccess=function(e){
			var r=e.target.result;
			if(r) callback(r); else callback(newScript());
		}; else callback(newScript());
	}
	function queryId() {
		if(id) o.get(id).onsuccess=function(e){
			var r=e.target.result;
			if(r) callback(r); else queryMeta();
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
			if(o.more) for(i in o.more) c[i]=o.more[i];	// for import and user edit
			c.meta=meta;c.code=o.code;r.obj=getMeta(c);c.uri=getNameURI(c);
			if(o.from&&!c.meta.homepage&&!c.custom.homepage&&!/^(file|data):/.test(o.from)) c.custom.homepage=o.from;
			if(o.url&&!c.meta.downloadURL&&!c.custom.downloadURL) c.custom.downloadURL=o.url;
			saveScript(c,src).onsuccess=function(e){
				r.id=c.id=e.target.result;finish();
			};
		});
		meta.require.forEach(fetchRequire);	// @require
		for(d in meta.resources) fetchCache(meta.resources[d]);	// @resource
		if(meta.icon) fetchCache(meta.icon);	// @icon
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
function getOption(data,src,callback){
	var o=db.transaction('settings').objectStore('settings');
	o.get(data).onsuccess=function(e){
		var r=e.target.result;
		if(callback) callback(r.value);
	};
}
function setOption(data,src,callback){
	var o=db.transaction('settings','readwrite').objectStore('settings');
	o.put({key:data.key,value:data.value});
	if(callback) callback(data.value);
}
function enableScript(d,src,callback) {
	var o=db.transaction('scripts','readwrite').objectStore('scripts');
	o.get(d.id).onsuccess=function(e){
		var r=e.target.result;
		if(!r) return;
		r.enabled=d.data?1:0;
		o.put(r).onsuccess=function(e){	// store script without another transaction
		//saveScript(r,src).onsuccess=function(e){
			updateItem({id:d.id,obj:getMeta(r),status:0});
		};
	};
	if(callback) callback();
}
function checkUpdateO(o) {
  var r={id: o.id, hideUpdate: 1, status: 2};
  function update() {
    var u = o.custom.downloadURL || o.meta.downloadURL;
    if (u) {
      r.message = _('msgUpdating');
      fetchURL(u, function() {
        parseScript({
					id: o.id,
          status: this.status,
          code: this.responseText
        });
      });
    } else r.message = '<span class=new>' + _('msgNewVersion') + '</span>';
    updateItem(r);
  }
  var u = o.custom.updateURL || o.meta.updateURL;
  if (u) {
    r.message = _('msgCheckingForUpdate');
    updateItem(r);
    fetchURL(u, function() {
      r.message = _('msgErrorFetchingUpdateInfo');
      if (this.status == 200) try {
        var m = parseMeta(this.responseText);
        if (canUpdate(o.meta.version, m.version)) return update();
        r.message = _('msgNoUpdate');
      } catch (e) {}
      delete r.hideUpdate;
      updateItem(r);
    });
  }
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
		getOption('autoUpdate',null,function(a){
			if(a) getOption('lastUpdate',null,function(l){
				if(Date.now()-l>=864e5) checkUpdateAll();
				setTimeout(check,36e5);
			}); else checking=false;
		});
  }
  if(!checking) {checking=true;check();}
}
function autoUpdate(o,src,callback){
	o=!!o;
	setOption({key:'autoUpdate',value:o},src,autoCheck);
	if(callback) callback(o);
}
function getData(data,src,callback) {
	function getSettings(){
		var o=db.transaction('settings').objectStore('settings');
		o.openCursor().onsuccess=function(e){
			var r=e.target.result,v;
			if(r) {
				v=r.value;
				settings[v.key]=v.value;
				r.continue();
			} else getScripts();
		};
	}
	function getScripts(){
		var o=db.transaction('scripts').objectStore('scripts');
		o.index('position').openCursor().onsuccess=function(e){
			var r=e.target.result,v;
			if(r) {
				v=r.value;
				if(v.meta.icon&&!(v.meta.icon in settings.cache)) {
					cache.push(v.meta.icon);
					settings.cache[v.meta.icon]=null;
				}
				settings.scripts.push(getMeta(v));
				r.continue();
			} else getCache();
		};
	}
	function getCache(){
		var o=db.transaction('cache').objectStore('cache');
		function loop(){
			var i=cache.pop();
			if(i) {
				o.get(i).onsuccess=function(e){
					var r=e.target.result;
					if(r) {
						var b=new Blob([r.data],{type:'image/png'});
						settings.cache[i]=URL.createObjectURL(b);
						URL.revokeObjectURL(b);
					}
					loop();
				};
			} else callback(settings);
		}
		loop();
	}
	var settings={scripts:[],cache:{}},cache=[];
	getSettings();
}
function exportZip(z,src,callback){
	function getScripts(){
		function loop(){
			var i=z.data.shift();
			if(i) o.get(i).onsuccess=function(e){
				var r=e.target.result;
				if(r) {
					d.data.push(r);
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
	var d={data:[]},values=[];
	getScripts();
}

chrome.runtime.onConnect.addListener(function(p){
	port=p;
	p.onDisconnect.addListener(function(){port=null;});
});
chrome.runtime.onMessage.addListener(function(req,src,callback) {
	var maps={
		NewScript:function(o,src,callback){
			o=newScript();
			saveScript(o,src).onsuccess=function(e){
				o.id=e.target.result;
				chrome.tabs.sendMessage(src.tab.id,{cmd:'NewScript',data:o});
			};
			if(callback) callback();
		},
		RemoveScript: removeScript,
		GetData: getData,
		FindScript: findScript,
		CheckUpdate: checkUpdate,
		CheckUpdateAll: checkUpdateAll,
		SaveScript: saveScript,
		EnableScript: enableScript,
		SetValue: setValue,
		GetOption: getOption,
		SetOption: setOption,
		ExportZip: exportZip,
		ParseScript: parseScript,
		GetScript: getScript,	// for user edit
		GetMetas: getMetas,	// for popup menu
		AutoUpdate: autoUpdate,
		Vacuum: vacuum,
		Move: move,
		LoadDirectly:loadDirectly,
	},f=maps[req.cmd];
	if(f) f(req.data,src,callback);
	return true;
});
initDb(function(){
	getOption('maxPosition',function(p){
		if(p) pos=p;
	});
	getOption('isApplied',null,function(o){
		chrome.browserAction.setIcon({path:'images/icon19'+(o?'':'w')+'.png'});
	});
	setTimeout(autoCheck,2e3);
});
var directUrls={};
function loadDirectly(o,src,callback){
	directUrls[o]=1;
	if(callback) callback();
}
chrome.webRequest.onBeforeRequest.addListener(function(o){
	if(directUrls[o.url]) delete directUrls[o.url];
	else if(/\.user\.js(\?|$)/.test(o.url)) {
		if(o.tabId<0) chrome.tabs.create({url:chrome.extension.getURL('/confirm.html')+'?url='+encodeURIComponent(o.url)});
		else chrome.tabs.get(o.tabId,function(t){
			chrome.tabs.create({url:chrome.extension.getURL('/confirm.html')+'?url='+encodeURIComponent(o.url)+'&from='+encodeURIComponent(t.url)});
		});
		return {redirectUrl:'javascript:history.back()'};
	}
},{
	urls:['*://*/*','file://*/*'],types:['main_frame']
},['blocking']);
