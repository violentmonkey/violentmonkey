'use strict';
zip.workerScriptsPath = 'lib/zip.js/';

function setTitle(node, title, def) {
	node.title = title || '';
	node.innerHTML = title ? safeHTML(title) :
		(def || '<em>' + _('labelNoName') + '</em>');
}

var scriptList = function() {
	var parent = $('#sList');
	/**
	 * list = [
	 *   {
	 *     node: DOM
	 *     script: Object
	 *   },
	 *   ...
	 * ]
	 */
	var list = [];
	var dict = {};
	var cache = {};
	var mask = $('.mask');
	var commands = {
		edit: function(obj) {
			chrome.runtime.sendMessage({
				cmd: 'GetScript',
				data: obj.data.script.id,
			}, Editor.editScript);
		},
		enable: function(obj) {
			var script = obj.data.script;
			chrome.runtime.sendMessage({
				cmd: 'UpdateMeta',
				data: {
					id: script.id,
					enabled: script.enabled ? 0 : 1,
				},
			});
		},
		remove: function(obj) {
			var script = obj.data.script;
			chrome.runtime.sendMessage({
				cmd: 'RemoveScript',
				data: script.id,
			}, function() {
				list.splice(obj.index, 1);
				delete dict[script.id];
				parent.removeChild(obj.data.node);
				if(!list.length) showEmptyHint();
			});
		},
		update: function(obj) {
			chrome.runtime.sendMessage({
				cmd: 'CheckUpdate',
				data: obj.data.script.id,
			});
		},
	};

	function showEmptyHint() {
		mask.classList.remove('hide');
		mask.style.opacity = 1;
		mask.style.zIndex = 9;
		mask.innerHTML = '<div>' + _('labelNoScripts') + '</div>';
		parent.style.opacity = '';
	}

	function hideMask() {
		parent.style.opacity = 1;
		mask.style.opacity = 0;
		setTimeout(function() {
			mask.classList.add('hide');
		}, 1000);
	}

	function setData(data) {
		list = [];
		dict = {};
		cache = data.cache || {};
		if(data.scripts.length) {
			hideMask();
			parent.innerHTML = '';
			data.scripts.forEach(addScript);
		} else
			showEmptyHint();
		Transporter.initList();
	}

	function findNode(target) {
		for(var node = target; node && node.parentNode != parent; node = node.parentNode);
		var index = -1;
		list.some(function(data, i) {
			if(data.node === node) {
				index = i;
				return true;
			}
		});
		return index >= 0 && {
			index: index,
			data: node,
		};
	}

	function findItem(target) {
		var data = findNode(target);
		if(data) data.data = list[data.index];
		return data;
	}

	function allowUpdate(script){
		return script.update && (
			script.custom.updateURL ||
			script.meta.updateURL ||
			script.custom.downloadURL ||
			script.meta.downloadURL ||
			script.custom.lastInstallURL
		);
	}

	function setAuthor(node, author) {
		var matches = author.match(/^(.*?)\s<(\S*?@\S*?)>$/);
		var label = _('labelAuthor');
		if(matches)
			node.innerHTML = label + '<a href=mailto:' + matches[2] + '>' + matches[1] + '</a>';
		else
			node.innerText = author ? label + author : '';
		node.title = author || '';
	}

	var images = {};
	function loadImage(node, src) {
		if(src in images) {
			var data = images[src];
			if(Array.isArray(data)) data.push(node);
			else if(data) node.src = src;
		} else {
			var nodes = images[src] = [node];	// loading
			var img = new Image;
			img.src = src;
			img.onload = function() {
				images[src] = true;	// loaded
				nodes.forEach(function(node) {
					node.src = src;
				});
			};
			img.onerror = function() {
				images[src] = false;	// error
			};
		}
	}

	function updateNode(res) {
		var data = dict[res.id];
		if(!data) return;
		var node = data.node;
		var script = data.script;
		if(res.message)
			node.querySelector('.message').innerHTML = res.message;
		node.classList[script.enabled ? 'remove' : 'add']('disabled');
		var update = node.querySelector('.update');
		if(update) update.disabled = res.code == 3;
		var name = node.querySelector('.name');
		setTitle(name, script.custom.name || getLocaleString(script.meta, 'name'));
		var home = script.custom.homepageURL ||
			script.meta.homepageURL ||
			script.meta.homepage;
		if(home) name.href = home;
		var supportURL = script.meta.supportURL;
		if(supportURL) {
			var support = node.querySelector('.support');
			support.classList.remove('hide');
			support.href = supportURL;
			support.title = _('hintSupportPage');
		}
		setAuthor(node.querySelector('.author'), script.meta.author || '');
		setTitle(node.querySelector('.descrip'), getLocaleString(script.meta, 'description'));
		var image = node.querySelector('.icon');
		var src;
		if(script.meta.icon) {
			src = cache[script.meta.icon];
			if(!src) loadImage(image, script.meta.icon);
		}
		image.src = src || 'images/icon48.png';
		var enable = node.querySelector('.enable');
		enable.innerHTML = script.enabled ? _('buttonDisable') : _('buttonEnable');
	}

	function initNode(data, res) {
		var node = data.node;
		var script = data.script;
		node.innerHTML =
			'<img class=icon>' +
			'<div class="right version">' +
				(script.meta.version ? 'v' + script.meta.version : '') +
			'</div> ' +
			'<div class="right author"></div>' +
			'<div class=info>' +
				'<a class="name ellipsis" target=_blank></a>' +
				'<a class="support hide" target=_blank><i class="fa fa-question-circle"></i></a>' +
			'</div>' +
			'<p class="descrip ellipsis"></p>' +
			'<div class=buttons>' +
				'<button data=edit>' + _('buttonEdit') + '</button> ' +
				'<button data=enable class=enable></button> ' +
				'<button data=remove>' + _('buttonRemove') + '</button> ' +
				(allowUpdate(script) ? '<button data=update class=update>' + _('buttonUpdate') + '</button> ' : '') +
				'<span class=message></span>' +
			'</div>'
		;
		locate(list.indexOf(data));
		updateNode(res || {id: script.id});
	}

	var height = 90;
	var gap = 10;
	function getIndexByTop(top) {
		var i = Math.floor((top - gap) / (height + gap));
		var lower = (height + gap) * i + gap;
		var upper = lower + height;
		return top >= lower + 10 && top <= upper - 10 ? i : -1;
	}
	function locate(i, data) {
		data = data || list[i];
		if(!data) return;
		var node = data.node;
		var top = (height + gap) * i + gap;
		var delta = 60 * (i + 1);
		if(node.style.top == '' && top < parent.clientHeight) {
			top += delta;
			node.style.opacity = 0;
			setTimeout(function(){
				top -= delta;
				node.style.top = top + 'px';
				node.style.opacity = '';
			}, 0);
		}
		node.style.top = top + 'px';
	}

	var emptyDom = document.createElement('div');
	var dragging = {};
	function dragstart(e) {
		e.preventDefault();
		if(dragging.data) return;
		var data = dragging.data = findItem(e.target);
		dragging.index = data.index;
		var node = e.target;
		dragging.offsetX = e.offsetX;
		dragging.offsetY = e.offsetY;
		node.style.width = node.offsetWidth + 'px';
		node.style.left = e.clientX - dragging.offsetX + 'px';
		node.style.top = e.clientY - dragging.offsetY + 'px';
		// transition is reset in style so that there will not be transition on mouseup
		node.style.transition = 'none';
		node.classList.add('dragging');
		document.addEventListener('mousemove', mousemove, false);
		document.addEventListener('mouseup', mouseup, false);
	}
	function mousemove(e) {
		var node = dragging.data.data.node;
		var index = getIndexByTop(e.clientY - parent.offsetTop);
		node.style.left = e.clientX - dragging.offsetX + 'px';
		node.style.top = e.clientY - dragging.offsetY + 'px';
		if(index >= 0 && index != dragging.index) {
			var current = dragging.index;
			var step = index > current ? 1 : -1;
			while(index != current) {
				current += step;
				var i = current;
				if(step * (i - dragging.data.index) <= 0) i -= step;
				locate(current - step, list[i]);
			}
			dragging.index = index;
		}
	}
	function mouseup(e) {
		var data = dragging.data;
		var node = data.data.node;
		dragging.data = null;
		var offset = parent.getBoundingClientRect();
		node.style.left = e.clientX - dragging.offsetX - offset.left + 'px';
		node.style.top = e.clientY - dragging.offsetY - offset.top + 'px';
		node.classList.remove('dragging');
		setTimeout(function(){
			node.style.left = '';
			node.style.width = '';
			node.style.transition = '';
			locate(dragging.index, data.data);
		}, 0);
		orderScript(data.index, dragging.index);
		document.removeEventListener('mousemove', mousemove, false);
		document.removeEventListener('mouseup', mouseup, false);
	}
	function orderScript(idxFrom, idxTo) {
		if(idxFrom != idxTo) {
			chrome.runtime.sendMessage({
				cmd:'Move',
				data:{
					id: list[idxFrom].script.id,
					offset: idxTo - idxFrom,
				},
			});
			var i = Math.min(idxTo, idxFrom);
			var j = Math.max(idxTo, idxFrom);
			var seq = [
				list.slice(0, i),
				list.slice(i, j+1),
				list.slice(j+1),
			];
			if(i === idxTo)
				seq[1].unshift(seq[1].pop());
			else
				seq[1].push(seq[1].shift());
			list = [];
			seq.forEach(function(seq) {
				list = list.concat(seq);
			});
		}
	}

	function addScript(script) {
		var node = document.createElement('div');
		var data = {
			script: script,
			node: node,
		};
		dict[script.id] = data;
		list.push(data);
		node.className = 'item';
		node.draggable = true;
		node.addEventListener('dragstart', dragstart, false);
		initNode(data);
		parent.appendChild(data.node);
		hideMask();
	}

	function updateItem(res) {
		switch(res.code) {
			case 0:	// script updated
				var data = dict[res.id];
				if(data && res.script) {
					data.script = res.script;
					initNode(data, res);
				}
				break;
			case 1:	// script installed
				addScript(res.script);
				break;
			default:	// message
				updateNode(res);
		}
	}

	parent.addEventListener('click', function(e) {
		var data = e.target.getAttribute('data');
		if(data) {
			var obj = findItem(e.target);
			if(obj) {
				var func = commands[data];
				if(func) func(obj);
			}
		}
	}, false);

	return {
		forEach: function(cb) {
			list.forEach(cb);
		},
		setData: setData,
		updateItem: updateItem,
	};
}();

var Transporter = function() {
	var helper = $('#iImport');
	var cbValues = $('#cbValues');
	var btExport = $('#bExport');
	var xList = $('#xList');

	function getFiles(entries) {
		function getFile() {
			var entry = entries.shift();
			if(entry) {
				if(userjs.test(entry.filename)) entry.getData(writer, function(text) {
					var script = {code: text};
					if(vm.scripts) {
						var more = vm.scripts[entry.filename.slice(0, -8)];
						if(more) {
							delete more.id;
							script.more = more;
						}
					}
					chrome.runtime.sendMessage({cmd: 'ParseScript', data: script}, function() {
						count ++;
						getFile();
					});
				}); else getFile();
			} else {
				alert(_('msgImported', [count]));
				location.reload();
			}
		}
		function getVMConfig(text) {
			try {
				vm = JSON.parse(text);
			} catch(e) {
				console.log('Error parsing ViolentMonkey configuration.');
			}
			var i;
			if(vm.values)
				for(i in vm.values) chrome.runtime.sendMessage({
					cmd: 'SetValue',
					data: {
						uri: i,
						values: vm.values[i],
					},
				});
			if(vm.settings)
				for(i in vm.settings) setOption(i, vm.settings[i]);
			getFile();
		}
		var userjs = /\.user\.js$/i;
		var writer = new zip.TextWriter();
		var vm = {}, count = 0;
		if(!entries.some(function(entry, i) {
			if(entry.filename == 'ViolentMonkey') {
				entries.splice(i, 1)[0].getData(writer, getVMConfig);
				return true;
			}
		})) getFile();
	}

	function importData(e) {
		zip.createReader(new zip.BlobReader(e.target.files[0]), function(r){
			r.getEntries(getFiles);
		}, function(e){console.log(e);});
	}

	function exported(data) {
		function addFiles(){
			var file = files.shift();
			if(file)
				writer.add(file.name, new zip.TextReader(file.content), addFiles);
			else
				writer.close(function(blob){
					var url = URL.createObjectURL(blob);
					var helper = document.createElement('a');
					var e = document.createEvent('MouseEvent');
					e.initMouseEvent('click', true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
					helper.href = url;
					helper.download = 'scripts.zip';
					helper.dispatchEvent(e);
					writer = null;
					URL.revokeObjectURL(url);
				});
		}
		var files = [];
		var names = {};
		var writer;
		var vm = {scripts: {}, settings: getAllOptions()};
		if(cbValues.checked) vm.values={};
		data.scripts.forEach(function(script) {
			var name = script.custom.name || script.meta.name || 'Noname';
			if(names[name]) name += '_' + (++ names[name]);
			else names[name] = 1;
			files.push({name: name + '.user.js', content: script.code});
			vm.scripts[name] = {
				id: script.id,
				custom: script.custom,
				enabled: script.enabled,
				update: script.update,
			};
			if(cbValues.checked) {
				var values = data.values[script.uri];
				if(values) vm.values[script.uri] = values;
			}
		});
		files.push({name: 'ViolentMonkey', content: JSON.stringify(vm)});
		zip.createWriter(new zip.BlobWriter(), function(_writer) {
			writer = _writer;
			addFiles();
		});
	}

	function bindEvents() {
		$('#bImport').addEventListener('click', function(e) {
			var e = document.createEvent('MouseEvent');
			e.initMouseEvent('click', true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
			helper.dispatchEvent(e);
		}, false);
		helper.addEventListener('change', importData, false);
		btExport.addEventListener('click', function(e) {
			this.disabled=true;
			var ids = [];
			scriptList.forEach(function(data, i) {
				if(xList.childNodes[i].selected) ids.push(data.script.id);
			});
			chrome.runtime.sendMessage({
				cmd: 'ExportZip',
				data: {
					values: cbValues.checked,
					data: ids,
				},
			}, exported);
		}, false);
		$('#bSelect').addEventListener('click', function(e) {
			var nodes = xList.childNodes;
			var state = !Array.prototype.every.call(nodes, function(node) {
				return node.selected;
			});
			Array.prototype.forEach.call(nodes, function(node) {
				node.selected = state;
			});
		}, false);
	}

	cbValues.checked = getOption('exportValues');
	cbValues.addEventListener('change', function(e) {
		setOption('exportValues', this.checked);
	}, false);
	bindEvents();

	return {
		initList: function() {
			xList.innerHTML = '';
			scriptList.forEach(function(data) {
				var option = document.createElement('option');
				var script = data.script;
				option.className = 'ellipsis';
				option.selected = true;
				setTitle(option, script.custom.name || getLocaleString(script.meta, 'name'));
				xList.appendChild(option);
			});
			btExport.disabled = false;
		},
	};
}();

// Script Editor
var Editor = function() {
	var parent = $('#wndEditor');
	var meta = parent.querySelector('.meta');
	var btSave = parent.querySelector('.save');
	var btSaveClose = parent.querySelector('.savenclose');
	var btClose = parent.querySelector('.close');
	var cbUpdate = parent.querySelector('.update');
	var pCustom = {
		name: meta.querySelector('.name'),
		runAt: meta.querySelector('.run-at'),
		homepage: meta.querySelector('.homepage'),
		updateURL: meta.querySelector('.updateurl'),
		downloadURL: meta.querySelector('.downloadurl'),
		keepInclude: meta.querySelector('.keep-include'),
		include: meta.querySelector('.include'),
		keepMatch: meta.querySelector('.keep-match'),
		match: meta.querySelector('.match'),
		keepExclude: meta.querySelector('.keep-exclude'),
		exclude: meta.querySelector('.exclude'),
	};
	var modified = false;
	var metaModified = false;
	var script = null;
	var editor;

	function markClean() {
		modified = false;
		metaModified = false;
		btSave.disabled = btSaveClose.disabled = true;
	}

	function markDirty(includeMeta) {
		if(includeMeta) metaModified = true;
		modified = true;
		btSave.disabled = btSaveClose.disabled = false;
	}

	function bindEvents() {
		var hideMeta = function(e) {
			meta.classList.add('hide');
			document.removeEventListener('mousedown', hideMeta, false);
		};
		meta.addEventListener('mousedown', stopPropagation, false);
		parent.querySelector('.btCustom').addEventListener('click', function(e) {
			meta.classList.remove('hide');
			document.addEventListener('mousedown', hideMeta, false);
		}, false);
		btSave.addEventListener('click', save, false);
		btSaveClose.addEventListener('click', function(e) {
			save();
			close();
		}, false);
		btClose.addEventListener('click', close, false);
		cbUpdate.addEventListener('change', function(e) {
			markDirty();
		}, false);
		meta.addEventListener('change', markDirty, false);
		meta.addEventListener('dblclick', function(e) {
			var target = e.target;
			var placeholder = target.placeholder;
			if(!target.value && placeholder)
				target.value = placeholder;
		}, false);
	}

	function editScript(_script) {
		parent.classList.remove('hide');
		script = _script;
		cbUpdate.checked = script.update;
		editor.setValueAndFocus(script.code);
		editor.clearHistory();
		markClean();
		meta.classList.add('hide');
		pCustom.name.value = script.custom.name || '';
		pCustom.name.placeholder = script.meta.name || '';
		pCustom.homepage.value = script.custom.homepageURL || '';
		pCustom.homepage.placeholder = script.meta.homepageURL || '';
		pCustom.updateURL.value = script.custom.updateURL || '';
		pCustom.updateURL.placeholder = script.meta.updateURL || _('hintUseDownloadURL');
		pCustom.downloadURL.value = script.custom.downloadURL || '';
		pCustom.downloadURL.placeholder = script.meta.downloadURL || script.custom.lastInstallURL || '';
		pCustom.runAt.value = {
			'document-start': 'start',
			'document-idle': 'idle',
			'document-end': 'end',
		}[script.custom['run-at']] || 'default';
		pCustom.keepInclude.checked = script.custom._include != false;
		pCustom.keepMatch.checked = script.custom._match != false;
		pCustom.keepExclude.checked = script.custom._exclude != false;
		pCustom.include.value = (script.custom.include || []).join('\n');
		pCustom.match.value = (script.custom.match || []).join('\n');
		pCustom.exclude.value = (script.custom.exclude || []).join('\n');
	}

	function split(str) {
		var empty = /^\s*$/;
		return str.split(/\s*\n\s*/)
			.filter(function(e){return empty.test(e);});
	}

	function save() {
		if(metaModified) {
			script.custom.name = pCustom.name.value;
			script.custom.homepageURL = pCustom.homepage.value;
			script.custom.updateURL = pCustom.updateURL.value;
			script.custom.downloadURL = pCustom.downloadURL.value;
			var runAt = {
				'start': 'document-start',
				'idle': 'document-idle',
				'end': 'document-end',
			}[pCustom.runAt.value];
			if(runAt) script.custom['run-at'] = runAt;
			else delete script.custom['run-at'];
			script.custom._include = pCustom.keepInclude.checked;
			script.custom._match = pCustom.keepMatch.checked;
			script.custom._exclude = pCustom.keepExclude.checked;
			script.custom.include = split(pCustom.include.value);
			script.custom.match = split(pCustom.match.value);
			script.custom.exclude = split(pCustom.exclude.value);
		}
		chrome.runtime.sendMessage({
			cmd:'ParseScript',
			data:{
				id: script.id,
				code: editor.getValue(),
				// suppress message
				message: '',
				more: {
					custom: script.custom,
					update: script.update = cbUpdate.checked,
				},
			},
		});
		markClean();
	}

	function close() {
		if(!modified || confirm(_('confirmNotSaved'))) {
			script = null;
			parent.classList.add('hide');
		}
	}

	initEditor({
		callback: function(_editor) {
			editor = _editor;
		},
		container: parent.querySelector('.code'),
		onsave: save,
		onexit: close,
		onchange: function(e) {
			markDirty();
		},
	});
	bindEvents();

	return {
		editScript: editScript,
	};
}();

// Load at last
var switchTab = function() {
	var menus = $$('.sidemenu>a');
	var submenus = $$('.sidemenu>div');
	var tabs = $$('.content>div');
	var forEach = Array.prototype.forEach;
	return function(e) {
		var current;
		forEach.call(menus, function(menu) {
			var href = menu.getAttribute('href');
			if(href == location.hash) {
				current = href;
				menu.classList.add('selected');
			} else
				menu.classList.remove('selected');
		});
		if(!current) {
			current = menus[0].getAttribute('href');
			menus[0].classList.add('selected');
		}
		current = 'tab' + current.substr(1);
		forEach.call(tabs, function(tab) {
			if(tab.id == current)
				tab.classList.remove('hide');
			else
				tab.classList.add('hide');
		});
		if(current == 'tabSettings') Transporter.initList();
	};
}();

!function() {
	$('.sidebar').classList.remove('init');
	$('#currentLang').innerHTML = navigator.language;
	$('#cUpdate').checked = getOption('autoUpdate');
	$('#sInjectMode').value = getOption('injectMode');
	$('#cUpdate').addEventListener('change', function(e) {
		chrome.runtime.sendMessage({
			cmd: 'AutoUpdate',
			data: this.checked,
		});
	}, false);
	$('#sInjectMode').addEventListener('change', function(e) {
		setOption('injectMode', this.value);
	}, false);
	var vacuum = $('#bVacuum');
	vacuum.onclick=function(){
		var self = this;
		self.disabled = true;
		self.innerHTML = _('buttonVacuuming');
		chrome.runtime.sendMessage({cmd:'Vacuum'}, function() {
			self.innerHTML = _('buttonVacuumed');
		});
	};
	vacuum.title = _('hintVacuum');
	$('#bNew').addEventListener('click', function(e) {
		chrome.runtime.sendMessage({cmd:'NewScript'}, Editor.editScript);
	}, false);
	$('#bUpdate').addEventListener('click', function(e) {
		chrome.runtime.sendMessage({cmd:'CheckUpdateAll'});
	}, false);
	$('.sidemenu').addEventListener('click', switchTab, false);
	window.addEventListener('popstate', switchTab, false);
	chrome.runtime.sendMessage({cmd:'GetData'}, scriptList.setData);
	var port = chrome.runtime.connect({name:'Options'});
	port.onMessage.addListener(scriptList.updateItem);
	initI18n();
	switchTab();
}();
