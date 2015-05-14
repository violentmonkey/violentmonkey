'use strict';
var db;
var port = null;
var position = 0;

function compareVersion(version1, version2) {
	version1 = (version1 || '').split('.');
	version2 = (version2 || '').split('.');
	for ( var i = 0; i < version1.length || i < version2.length; i ++ ) {
		var delta = (parseInt(version1[i], 10) || 0) - (parseInt(version2[i], 10) || 0);
		if(delta) return delta < 0 ? -1 : 1;
	}
	return 0;
}

function getUniqId() {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function notify(options) {
	chrome.notifications.create(options.id || 'ViolentMonkey', {
		type: 'basic',
		iconUrl: 'images/icon128.png',
		title: options.title + ' - ' + _('extName'),
		message: options.body,
		isClickable: options.isClickable,
	});
}

function initDb(callback) {
	var request = indexedDB.open('Violentmonkey', 1);
	request.onsuccess = function (e) {
		// initiate db
		db = request.result;
		if (callback) callback();
	};
	request.onerror = function (e) {
		console.log('IndexedDB error: ' + e.target.error.message);
	};
	request.onupgradeneeded = function (e) {
		var r = e.currentTarget.result;
		// scripts: id uri custom meta enabled update code position
		var o = r.createObjectStore('scripts', {
			keyPath: 'id',
			autoIncrement: true,
		});
		o.createIndex('uri', 'uri', {unique: true});
		o.createIndex('update', 'update', {unique: false});
		// position should be unique at last
		o.createIndex('position', 'position', {unique: false});
		// require: uri code
		o = r.createObjectStore('require', {keyPath: 'uri'});
		// cache: uri data
		o = r.createObjectStore('cache', {keyPath: 'uri'});
		// values: uri values
		o = r.createObjectStore('values', {keyPath: 'uri'});
	};
}

function getNameURI(script) {
	var ns = script.meta.namespace || '';
	var name = script.meta.name || '';
	var nameURI = escape(ns) + ':' + escape(name) + ':';
	if (!ns && !name) nameURI += script.id;
	return nameURI;
}

function isRemote(url){
	return url && !/^data:/.test(url);
}

function getMeta(script) {
	return {
		id: script.id,
		custom: script.custom,
		meta: script.meta,
		enabled: script.enabled,
		update: script.update,
	};
}

function parseMeta(code) {
	// initialize meta, specify those with multiple values allowed
	var meta = {
		include: [],
		exclude: [],
		match: [],
		require: [],
		resource: [],
		grant: [],
	};
	var flag = -1;
	code.replace(/(?:^|\n)\/\/\s*([@=]\S+)(.*)/g, function(value, group1, group2) {
		if (flag < 0 && group1 == '==UserScript==')
			// start meta
			flag = 1;
		else if(flag > 0 && group1 == '==/UserScript==')
			// end meta
			flag = 0;
		if(flag == 1 && group1[0] == '@') {
			var key = group1.slice(1);
			var val = group2.replace(/^\s+|\s+$/g, '');
			var value = meta[key];
			if(value && value.push) value.push(val);	// multiple values allowed
			else if(!(key in meta)) meta[key] = val;	// only first value will be stored
		}
	});
	meta.resources = {};
	meta.resource.forEach(function(line) {
		var pair = line.match(/^(\w\S*)\s+(.*)/);
		if(pair) meta.resources[pair[1]] = pair[2];
	});
	delete meta.resource;
	// @homepageURL: compatible with @homepage
	if(! meta.homepageURL && meta.homepage) meta.homepageURL = meta.homepage;
	return meta;
}

function newScript() {
	var script = {
		custom: {},
		enabled: 1,
		update: 1,
		code: '// ==UserScript==\n// @name New Script\n// ==/UserScript==\n',
	};
	script.meta = parseMeta(script.code);
	return script;
}

function removeScript(id, src, callback) {
	var o = db.transaction('scripts', 'readwrite').objectStore('scripts');
	o.delete(id);
	if (callback) callback();
}

function vacuum(o, src, callback) {
	function init(){
		var o = db.transaction('scripts').objectStore('scripts');
		o.index('position').openCursor().onsuccess = function (e) {
			var r = e.target.result;
			if (r) {
				var script = r.value;
				ids.push(script.id);
				script.meta.require.forEach(function (item) {require[item] = 1;});
				for(var i in script.meta.resources) cache[script.meta.resources[i]] = 1;
				if(isRemote(script.meta.icon)) cache[script.meta.icon] = 1;
				values[script.uri] = 1;
				r.continue();
			} else vacuumPosition();
		};
	}
	function vacuumPosition() {
		var id = ids.shift();
		if (id) {
			var o = db.transaction('scripts','readwrite').objectStore('scripts');
			o.get(id).onsuccess = function (e) {
				var r = e.target.result;
				r.position = ++ _pos;
				o.put(r).onsuccess = vacuumPosition;
			};
		} else {
			position = _pos;
			vacuumDB('require', require);
			vacuumDB('cache', cache);
			vacuumDB('values', values);
		}
	}
	function vacuumDB(dbName, dict) {
		working ++;
		// the database must have a keyPath of 'uri'
		var o = db.transaction(dbName, 'readwrite').objectStore(dbName);
		o.openCursor().onsuccess = function (e) {
			var r = e.target.result;
			if (r) {
				var v = r.value;
				if (!dict[v.uri]) o.delete(v.uri);
				else dict[v.uri] ++;	// keep
				r.continue();
			} else finish();
		};
	}
	function finish() {
		if(! -- working) {
			for(var i in require)
				if(require[i] == 1) fetchRequire(i);
			for(i in cache)
				if(cache[i] == 1) fetchCache(i);
			callback();
		}
	}
	var ids = [];
	var cache = {};
	var require = {};
	var values = {};
	var working = 0;
	var _pos=0;
	init();
	return true;
}

function move(data, src, callback) {
	var o = db.transaction('scripts', 'readwrite').objectStore('scripts');
	o.get(data.id).onsuccess = function (e) {
		var script = e.target.result;
		var pos = script.position;
		var range, order;
		if (data.offset < 0) {
			range = IDBKeyRange.upperBound(pos, true);
			order = 'prev';
			data.offset = -data.offset;
		} else {
			range = IDBKeyRange.lowerBound(pos, true);
			order = 'next';
		}
		o.index('position').openCursor(range, order).onsuccess = function (e) {
			var r = e.target.result;
			if (r) {
				data.offset --;
				var v = r.value;
				v.position = pos;
				pos = r.key;
				r.update(v);
				if (data.offset) r.continue();
				else {
					script.position = pos;
					o.put(script);
				}
			}
		};
	};
	if(callback) callback();
}

function str2RE(str) {
	return RegExp('^' + str.replace(/(\.|\?|\/)/g, '\\$1').replace(/\*/g, '.*?') + '$');
}

function autoReg(str) {
	if (/^\/.*\/$/.test(str))
		return RegExp(str.slice(1, -1));	// Regular-expression
	else
		return str2RE(str);	// String with wildcards
}

var match_reg = /(.*?):\/\/([^\/]*)\/(.*)/;
function matchTest(str, urlParts){
	if (str == '<all_urls>') return true;
	var parts = str.match(match_reg);
	return !!(parts &&
		// scheme
		(
			parts[1] == urlParts[1] ||	// exact match
			parts[1] == '*' && /^https?$/i.test(urlParts[1])	// * = http|https
		) &&
		// host
		(
			parts[2] == '*' ||	// * matches all
			parts[2] == urlParts[2] ||	// exact match
			/^\*\.[^*]*$/.test(parts[2]) && str2RE(parts[2]).test(urlParts[2])	// *.example.com
		) &&
		// pathname
		str2RE(parts[3]).test(urlParts[3])
	);
}

function testURL(url, script){
	var custom = script.custom;
	var meta = script.meta;
	var inc = [], exc = [], mat = [];
	var ok = true;
	if(custom._match !== false && meta.match) mat = mat.concat(meta.match);
	if(custom.match) mat = mat.concat(custom.match);
	if(custom._include !== false && meta.include) inc = inc.concat(meta.include);
	if(custom.include) inc = inc.concat(custom.include);
	if(custom._exclude !== false && meta.exclude) exc = exc.concat(meta.exclude);
	if(custom.exclude) exc = exc.concat(custom.exclude);
	// @match
	if(mat.length) {
		var urlParts = url.match(match_reg);
		mat.some(function(str) {
			return (ok = matchTest(str, urlParts));
		});
	}
	// @include
	else inc.some(function(str) {
		return (ok = autoReg(str).test(url));
	});
	// exclude
	if(ok) exc.some(function(str) {
		ok = ! autoReg(str).test(url);
		return ! ok;
	});
	return ok;
}

// get full data of a single script for user edit
function getScript(id, src, callback) {
	var o = db.transaction('scripts').objectStore('scripts');
	o.get(id).onsuccess = function (e) {
		var v = e.target.result;
		if(v) {
			var script = getMeta(v);
			script.code = v.code;
			if(callback) callback(script);
		}
	};
	return true;
}

// get meta data of scripts for popup menu
function getMetas(ids, src, callback) {
	function get(){
		var id = ids.shift();
		if (id)
			o.get(id).onsuccess = function (e) {
				var v=e.target.result;
				if (v) data.push(getMeta(v));
				get();
			};
		else callback(data);
	}
	var o = db.transaction('scripts').objectStore('scripts');
	var data=[];
	get();
	return true;
}

var badges = {};
function setBadge(num, src, callback) {
	var o;
	if(src.id in badges) o = badges[src.id];
	else badges[src.id] = o = {num: 0};
	o.num += num;
	chrome.browserAction.setBadgeBackgroundColor({color: '#808', tabId: src.tab.id});
	chrome.browserAction.setBadgeText({
		text: o.num ? o.num.toString() : '',
		tabId: src.tab.id,
	});
	if(o.timer) clearTimeout(o.timer);
	o.timer = setTimeout(function(){delete badges[src.id];}, 300);
	callback();
}

function getCacheB64(ids, callback) {
	function loop() {
		var id = ids.pop();
		if (id)
			o.get(id).onsuccess = function(e){
				var v = e.target.result;
				if(v) data[id] = v.data;
				loop();
			};
		else callback(data);
	}
	var o = db.transaction('cache').objectStore('cache');
	var data = {};
	loop();
}

function getInjected(url, src, callback) {
	function getScripts(){
		var o = db.transaction('scripts').objectStore('scripts');
		var require = {};
		var cache = {};
		var values = [];
		o.index('position').openCursor().onsuccess = function (e) {
			var r = e.target.result;
			if (r) {
				var v = r.value;
				if (testURL(url, v)) {
					data.scripts.push(v);
					values.push(v.uri);
					v.meta.require.forEach(function(i){require[i] = 1;});
					for(var i in v.meta.resources) cache[v.meta.resources[i]] = 1;
				}
				r.continue();
			} else {
				count = 3;
				getRequire(Object.getOwnPropertyNames(require));
				getCacheB64(Object.getOwnPropertyNames(cache), function (cache) {
					data.cache = cache;
					finish();
				});
				getValues(values);
			}
		};
	}
	function getRequire(require) {
		function loop() {
			var uri = require.pop();
			if(uri)
				o.get(uri).onsuccess = function(e) {
					var r = e.target.result;
					if (r) data.require[uri] = r.code;
					loop();
				};
			else finish();
		}
		var o = db.transaction('require').objectStore('require');
		loop();
	}
	function getValues(values) {
		function loop(){
			var uri = values.pop();
			if (uri)
				o.get(uri).onsuccess = function (e) {
					var v = e.target.result;
					if (v) data.values[uri] = v.values;
					loop();
				};
			else finish();
		}
		var o = db.transaction('values').objectStore('values');
		loop();
	}
	function finish(){
		if (! -- count) {
			callback(data);
			if(src.url == src.tab.url)
				chrome.tabs.sendMessage(src.tab.id, {cmd: 'GetBadge'});
		}
	}
	var data = {
		scripts: [],
		values: {},
		require: {},
		injectMode: getOption('injectMode'),
	};
	var count = 1;
	if (data.isApplied = getOption('isApplied')) getScripts();
	else finish();
	return true;
}

function fetchURL(url, cb, type, headers) {
  var req = new XMLHttpRequest();
  req.open('GET', url, true);
  if (type) req.responseType = type;
	if (headers) for(var i in headers)
		req.setRequestHeader(i, headers[i]);
  if(cb) req.onloadend = cb;
  req.send();
}

function saveCache(url, data, callback) {
	var o = db.transaction('cache', 'readwrite').objectStore('cache');
	o.put({uri: url, data: data}).onsuccess = callback;
}

function saveRequire(url, data, callback) {
	var o = db.transaction('require', 'readwrite').objectStore('require');
	o.put({uri: url, code: data}).onsuccess = callback;
}

var u_cache = {};
function fetchCache(url, check) {
	function saveResult(blob) {
		var r = new FileReader();
		r.onload = function(e) {
			saveCache(url, window.btoa(this.result), function () {delete u_cache[url];});
		};
		r.readAsBinaryString(blob);
	}
	if (!u_cache[url]) {
		u_cache[url] = 1;
		fetchURL(url, function() {
			if (this.status != 200) return;
			if (check) check(this.response, saveResult);
			else saveResult(this.response);
		}, 'blob');
	}
}

var u_require = {};
function fetchRequire(url) {
	if(u_require[url]) return;
	u_require[url] = 1;
	fetchURL(url, function(){
		if (this.status == 200)
			saveRequire(url, this.responseText, function(){delete u_require[url];});
	});
}

/**
 * broadcast script change
 * {
 *   id: required if script is not given
 *   script: optional
 *   message: optional
 *   code: optional
 *     0 for updated, 1 for installed,
 *     others for message: 3 for updating
 * }
 */
function updateItem(res) {
	if (port) try {
		port.postMessage(res);
	} catch(e) {
		port = null;
		console.log(e);
	}
}

function queryScript(id, meta, callback) {
	var o = db.transaction('scripts').objectStore('scripts');
	function finish(script) {
		if(!script) script = newScript();
		if(callback) callback(script);
	}
	function queryMeta() {
		var uri = getNameURI({id: '', meta: meta});
		if (uri != '::')
			o.index('uri').get(uri).onsuccess = function (e) {
				finish(e.target.result);
			};
		else finish();
	}
	function queryId() {
		if (id)
			o.get(id).onsuccess = function(e) {
				var script = e.target.result;
				if(script) finish(script);
				else queryMeta();
			};
		else queryMeta();
	}
	queryId();
}

function saveScript(script) {
	var o = db.transaction('scripts', 'readwrite').objectStore('scripts');
	script.enabled = script.enabled ? 1 : 0;
	script.update = script.update ? 1 : 0;
	if (!script.position) script.position = ++ position;
	return o.put(script);
}

function parseScript(data, src, callback) {
	function finish() {
		updateItem(ret);
		if (callback) callback(ret);
	}
	var ret = {
		code: 0,
		message: 'message' in data ? data.message : _('msgUpdated'),
	};
	if (data.status && data.status != 200 || data.code == '') {
		// net error
		ret.code = -1;
		ret.message = _('msgErrorFetchingScript');
		finish();
	} else {
		// store script
		var meta = parseMeta(data.code);
		queryScript(data.id, meta, function(script) {
			if (!script.id) {
				ret.code=1;
				ret.message=_('msgInstalled');
			}
			// add additional data for import and user edit
			if (data.more)
				for(var i in data.more)
					if(i in script) script[i] = data.more[i];
			script.meta = meta;
			script.code = data.code;
			script.uri = getNameURI(script);
			// use referer page as default homepage
			if (data.from && !script.meta.homepageURL && !script.custom.homepageURL && !/^(file|data):/.test(data.from))
				script.custom.homepageURL = data.from;
			if (data.url && !/^(file|data):/.test(data.url))
				script.custom.lastInstallURL = data.url;
			saveScript(script).onsuccess = function(e) {
				ret.id = script.id = e.target.result;
				ret.script = getMeta(script);
				finish();
				if (!meta.grant.length && !getOption('ignoreGrant'))
					notify({
						id: 'VM-NoGrantWarning',
						title: _('Warning'),
						body: _('msgWarnGrant', [meta.name||_('labelNoName')]),
						isClickable: true,
					});
			};
		});
		// @require
		meta.require.forEach(function (url) {
			var cache = data.require && data.require[url];
			if(cache) saveRequire(url, cache);
			else fetchRequire(url);
		});
		// @resource
		for(var i in meta.resources) {
			var url = meta.resources[i];
			var cache = data.resources && data.resources[url];
			if(cache) saveCache(url, cache);
			else fetchCache(url);
		}
		// @icon
		if(isRemote(meta.icon)) fetchCache(meta.icon, function (blob, cb) {
			var free = function() {
				URL.revokeObjectURL(url);
			};
			var url = URL.createObjectURL(blob);
			var image = new Image;
			image.onload = function() {
				free();
				cb(blob);
			};
			image.onerror = function() {
				free();
			};
			image.src = url;
		});
	}
	return true;
}

function setValue(data, src, callback) {
	var o = db.transaction('values', 'readwrite').objectStore('values');
	o.put({uri:data.uri, values:data.values});
	if (callback) callback();
}

function updateMeta(meta, src, callback) {
	var o = db.transaction('scripts', 'readwrite').objectStore('scripts');
	o.get(meta.id).onsuccess = function (e) {
		var script = e.target.result;
		if (!script) return;
		for (var i in meta)
			if (i in script) script[i] = meta[i];
		o.put(script).onsuccess = function (e) {
			updateItem({
				code: 0,
				id: script.id,
				script: getMeta(script),
			});
		};
	};
	if (callback) callback();
}

var _update = {};
function realCheckUpdate(script) {
  function update() {
    if(downloadURL) {
      ret.message = _('msgUpdating');
      fetchURL(downloadURL, function(){
        parseScript({
					id: script.id,
          status: this.status,
          code: this.responseText,
        });
      });
    } else ret.message = '<span class=new>' + _('msgNewVersion') + '</span>';
    updateItem(ret);
		finish();
  }
	function finish(){
		delete _update[script.id];
	}
	if (_update[script.id]) return;
	_update[script.id] = 1;
  var ret = {id: script.id, code: 3};
	var downloadURL =
		script.custom.downloadURL ||
		script.meta.downloadURL ||
		script.custom.lastInstallURL;
	var updateURL =
		script.custom.updateURL ||
		script.meta.updateURL ||
		downloadURL;
  if(updateURL) {
    ret.message = _('msgCheckingForUpdate');
		updateItem(ret);
    fetchURL(updateURL, function() {
      ret.message = _('msgErrorFetchingUpdateInfo');
      if (this.status == 200)
				try {
					var meta = parseMeta(this.responseText);
					if(compareVersion(script.meta.version, meta.version) < 0)
						return update();
					ret.message = _('msgNoUpdate');
				} catch(e) {}
			ret.code = 2;
      updateItem(ret);
			finish();
    }, null, {
			Accept:'text/x-userscript-meta',
		});
  } else finish();
}

function checkUpdate(id, src, callback) {
	var o = db.transaction('scripts').objectStore('scripts');
	o.get(id).onsuccess = function (e) {
		var script = e.target.result;
		if(script) realCheckUpdate(script);
		if(callback) callback();
	};
	return true;
}

function checkUpdateAll(e, src, callback) {
	setOption('lastUpdate', Date.now());
	var o = db.transaction('scripts').objectStore('scripts');
	o.index('update').openCursor(1).onsuccess = function (e) {
		var r = e.target.result;
		if (r) {
			realCheckUpdate(r.value);
			r.continue();
		} else if(callback) callback();
	};
	return true;
}

var _autoUpdate = false;
function autoUpdate(data, src, callback) {
  function check() {
		if(getOption('autoUpdate')) {
			if (Date.now() - getOption('lastUpdate') >= 864e5)
				checkUpdateAll();
			setTimeout(check, 36e5);
		} else _autoUpdate = false;
  }
  if (!_autoUpdate) {
		_autoUpdate = true;
		check();
	}
	if (callback) callback();
}

function getData(e, src, callback) {
	function getScripts() {
		var o = db.transaction('scripts').objectStore('scripts');
		var cache = {};
		o.index('position').openCursor().onsuccess = function (e) {
			var r = e.target.result;
			if (r) {
				var script = r.value;
				if(isRemote(script.meta.icon))
					cache[script.meta.icon] = 1;
				data.scripts.push(getMeta(script));
				r.continue();
			} else getCache(Object.getOwnPropertyNames(cache));
		};
	}
	function getCache(uris) {
		getCacheB64(uris, function(cache) {
			for(var i in cache)
				cache[i] = 'data:image/png;base64,' + cache[i];
			data.cache = cache;
			callback(data);
		});
	}
	var data = {scripts: []};
	getScripts();
	return true;
}

function exportZip(exp, src, callback) {
	function getScripts() {
		function loop() {
			var id = exp.data.shift();
			if (id)
				o.get(id).onsuccess = function (e) {
					var script = e.target.result;
					if(script) {
						data.scripts.push(script);
						if(exp.values) values.push(script.uri);
					}
					loop();
				};
			else getValues(values);
		}
		var values = [];
		var o = db.transaction('scripts').objectStore('scripts');
		loop();
	}
	function getValues(values) {
		function loop() {
			var uri = values.shift();
			if (uri)
				o.get(uri).onsuccess = function (e) {
					var v = e.target.result;
					if (v) data.values[uri] = v.values;
					loop();
				};
			else finish();
		}
		if(exp.values) {
			var o = db.transaction('values').objectStore('values');
			data.values = {};
			loop();
		} else finish();
	}
	function finish() {
		callback(data);
	}
	var data = {scripts: []};
	getScripts();
	return true;
}

// Requests
var requests = {};
var requests_dict = {};
var special_headers = ['user-agent', 'referer', 'origin'];
function getRequestId(data, src, callback) {
  var id = getUniqId();
  requests[id] = {
		xhr: new XMLHttpRequest(),
	};
	callback(id);
}
function httpRequest(details, src, callback) {
  function reqCallback(evt) {
		function finish() {
			chrome.tabs.sendMessage(src.tab.id, {
				cmd: 'HttpRequested',
				data: {
					id: details.id,
					type: evt.type,
					resType: xhr.responseType,
					data: data
				}
			});
		}
		var data = {
			finalUrl: req.finalUrl,
			readyState: xhr.readyState,
			responseHeaders: xhr.getAllResponseHeaders(),
			status: xhr.status,
			statusText: xhr.statusText
		};
		try {
			data.responseText = xhr.responseText;
		} catch(e) {}
		if(xhr.response && xhr.responseType == 'blob') {
			var r = new FileReader();
			r.onload = function(e) {
				data.response = r.result;
				finish();
			};
			r.readAsDataURL(xhr.response);
		} else {
			// default `null` for blob and '' for text
			data.response = xhr.response;
			finish();
		}
		if(evt.type == 'loadend') {
			if(req.coreId) delete requests_dict[req.coreId];
			delete requests[details.id];
		}
  }
  var req = requests[details.id];
	if (!req) return;
	var xhr = req.xhr;
  try {
		// details.async = true;
    xhr.open(details.method, details.url, true, details.user, details.password);
		xhr.setRequestHeader('VM-Verify', details.id);
    if(details.headers)
			for(var i in details.headers) {
				var v = details.headers[i];
				if(special_headers.indexOf(i.toLowerCase()) >= 0)
					xhr.setRequestHeader('VM-' + i, v);
				else xhr.setRequestHeader(i, v);
			}
		if(details.responseType)
			xhr.responseType = 'blob';
    if(details.overrideMimeType)
			xhr.overrideMimeType(details.overrideMimeType);
    ['abort', 'error', 'load', 'loadend', 'progress', 'readystatechange', 'timeout'].forEach(function (i) {
      xhr['on'+i] = reqCallback;
    });
		req.finalUrl = details.url;
		xhr.send(details.data);
  } catch(e) {
		console.log(e);
  }
}
function abortRequest(id) {
  var req = requests[id];
  if(req) req.xhr.abort();
	if(req.coreId) delete requests_dict[req.coreId];
  delete requests[id];
}

chrome.runtime.onConnect.addListener(function (_port) {
	port = _port;
	_port.onDisconnect.addListener(function () {port = null;});
});

function initPosition(callback) {
	position = 0;
	var o = db.transaction('scripts', 'readwrite').objectStore('scripts');
	o.index('position').openCursor(null, 'prev').onsuccess = function (e) {
		var r = e.target.result;
		if(r && position < r.key) position = r.key;
		if(callback) callback();
	};
}

function initMessages() {
	chrome.runtime.onMessage.addListener(function(req, src, callback) {
		var maps = {
			NewScript: function (o, src, callback) {callback(newScript());},
			RemoveScript: removeScript,
			GetData: getData,
			GetInjected: getInjected,
			CheckUpdate: checkUpdate,
			CheckUpdateAll: checkUpdateAll,
			UpdateMeta: updateMeta,
			SetValue: setValue,
			ExportZip: exportZip,
			ParseScript: parseScript,
			GetScript: getScript,
			GetMetas: getMetas,
			SetBadge: setBadge,
			AutoUpdate: autoUpdate,
			Vacuum: vacuum,
			Move: move,
			ParseMeta: function(o, src, callback) {callback(parseMeta(o));},
			GetRequestId: getRequestId,
			HttpRequest: httpRequest,
			AbortRequest: abortRequest,
		};
		var func = maps[req.cmd];
		if(func) return func(req.data, src, function() {
			// if callback function is not given in content page, callback will fail
			try {
				callback.apply(null, arguments);
			} catch(e) {}
		});
	});
}

initDb(function() {
	initPosition(initMessages);
	chrome.browserAction.setIcon({
		path: 'images/icon19' + (getOption('isApplied') ? '' : 'w') + '.png',
	});
	setTimeout(autoUpdate, 2e4);
});

// Confirm page
chrome.webRequest.onBeforeRequest.addListener(function(req) {
	if(/\.user\.js([\?#]|$)/.test(req.url)) {
		var x = new XMLHttpRequest();
		x.open('GET', req.url, false);
		x.send();
		if((!x.status || x.status == 200) && !/^\s*</.test(x.responseText)) {
			if(req.tabId < 0)
				chrome.tabs.create({
					url: chrome.extension.getURL('/confirm.html') + '?url=' + encodeURIComponent(req.url),
				});
			else
				chrome.tabs.get(req.tabId, function(t){
					chrome.tabs.create({
						url: chrome.extension.getURL('/confirm.html') + '?url=' + encodeURIComponent(req.url) + '&from=' + encodeURIComponent(t.url),
					});
				});
			return {redirectUrl: 'javascript:history.back()'};
		}
	}
}, {
	urls: ['<all_urls>'],
	types: ['main_frame'],
}, ['blocking']);

// Modifications on headers
chrome.webRequest.onBeforeSendHeaders.addListener(function(details) {
	var headers = details.requestHeaders
	var new_headers = [];
	var vm_headers = {};
	headers.forEach(function(header) {
		if(header.name.substr(0,3) == 'VM-')
			vm_headers[header.name.substr(3)] = header.value;
		else
			new_headers.push(header);
	});
	var verify = vm_headers['Verify'];
	if(verify) {
		var req = requests[verify];
		if(req) {
			delete vm_headers['Verify'];
			requests_dict[details.requestId] = verify;
			req.coreId = details.requestId;
			for(var i in vm_headers)
				if(special_headers.indexOf(i.toLowerCase()) >= 0)
					new_headers.push({name: i, value: vm_headers[i]});
		}
	}
	return {requestHeaders: new_headers};
}, {
	urls: ['<all_urls>'],
	types: ['xmlhttprequest'],
}, ["blocking", "requestHeaders"]);

// Watch URL redirects
chrome.webRequest.onBeforeRedirect.addListener(function(details) {
	var verify = requests_dict[details.requestId]
	if (verify) {
		var req = requests[verify];
		if (req) req.finalUrl = details.redirectUrl;
	}
}, {
	urls: ['<all_urls>'],
	types: ['xmlhttprequest'],
});

chrome.notifications.onClicked.addListener(function(id) {
	if(id == 'VM-NoGrantWarning')
		chrome.tabs.create({url: 'http://wiki.greasespot.net/@grant'});
});
