'use strict';

function Menu(data) {
	this.data = data;
	var node = this.node = document.createElement('div');
	if(data.ellipsis) node.classList.add('ellipsis');
	node.innerHTML = '<i></i> ' + safeHTML(data.name);
	if('title' in data)
		node.title = typeof data.title == 'string' ? data.title : data.name;
	this.bindEvents();
	this.update(data.value);
	data.parent.insertBefore(node, data.before);
}
Menu.prototype = {
	update: function(value) {
		var node = this.node;
		var data = this.data;
		if(typeof value != 'undefined') data.value = value;
		if(data.symbols) {
			node.firstChild.className = 'fa ' + data.symbols[data.value ? 1 : 0];
			if(data.symbols.length > 1) {
				if(value) node.classList.remove('disabled');
				else node.classList.add('disabled');
			}
		}
	},
	bindEvents: function() {
		var events = this.data.events;
		for(var i in events)
			this.node.addEventListener(i, events[i].bind(this), false);
	},
};

var Popup = function() {
	var main = $('#main');
	var commands = $('#commands');
	var scripts = {};
	var main_top = main.querySelector('.top');
	var main_bot = main.querySelector('.bot');
	var commands_top = commands.querySelector('.top');
	var commands_bot = commands.querySelector('.bot');
	var nodeIsApplied;
	var tab, sep;

	function initMenu(){
		new Menu({
			name: _('menuManageScripts'),
			parent: main_top,
			symbols: ['fa-hand-o-right'],
			events: {
				click: function(e){
					var url = chrome.extension.getURL('/options.html');
					chrome.tabs.query({currentWindow: true, url: url}, function(tabs) {
						if(tabs[0]) chrome.tabs.update(tabs[0].id, {active: true});
						else chrome.tabs.create({url: url});
					});
				},
			},
		});
		if(/^https?:\/\//i.test(tab.url))
			new Menu({
				name: _('menuFindScripts'),
				parent: main_top,
				symbols: ['fa-hand-o-right'],
				events: {
					click: function(){
						var matches = tab.url.match(/:\/\/(?:www\.)?([^\/]*)/);
						chrome.tabs.create({url: 'https://greasyfork.org/scripts/search?q=' + matches[1]});
					},
				},
			});
		nodeIsApplied = new Menu({
			name: _('menuScriptEnabled'),
			parent: main_top,
			symbols: ['fa-times','fa-check'],
			events: {
				click: function(e) {
					var value = !this.data.value;
					setOption('isApplied', value);
					this.update(value);
					chrome.browserAction.setIcon({
						path: 'images/icon19' + (value ? '' : 'w') + '.png',
					});
				},
			},
			value: getOption('isApplied'),
		}).node;
	}

	function menuScript(script) {
		if(script && !scripts[script.id]) {
			scripts[script.id] = script;
			var name = script.custom.name || getLocaleString(script.meta, 'name');
			name = name ? safeHTML(name) : '<em>' + _('labelNoName') + '</em>';
			new Menu({
				name: name,
				parent: main_bot,
				symbols: ['fa-times','fa-check'],
				title: script.meta.name,
				events: {
					click: function(e) {
						var value = !this.data.value;
						chrome.runtime.sendMessage({cmd: 'UpdateMeta', data: {id: script.id, enabled: value}});
						this.update(value);
					},
				},
				value: script.enabled,
			});
		}
	}

	function setData(data) {
		if(!data) return;
		if(data.menus && data.menus.length) {
			new Menu({
				name: _('menuBack'),
				parent: commands_top,
				symbols: ['fa-arrow-left'],
				events: {
					click: function(e) {
						commands.classList.add('hide');
						main.classList.remove('hide');
					},
				},
			});
			commands_top.appendChild(document.createElement('hr'));
			data.menus.forEach(function(menu) {
				new Menu({
					name: menu[0],
					parent: commands_bot,
					symbols: ['fa-hand-o-right'],
					events: {
						click: function(e) {
							chrome.tabs.sendMessage(tab.id, {cmd:'Command', data:this.data.name});
						},
					},
				});
			});
			new Menu({
				name: _('menuCommands'),
				parent: main_top,
				symbols: ['fa-arrow-right'],
				events: {
					click: function(e) {
						main.classList.add('hide');
						commands.classList.remove('hide');
					},
				},
				before: nodeIsApplied,
			});
		}
		if(data.ids && data.ids.length) {
			var ids=[];
			data.ids.forEach(function(id){
				if(!scripts[id]) ids.push(id);
			});
			if(ids.length)
				chrome.runtime.sendMessage({cmd: 'GetMetas', data: ids}, function(scripts) {
					if(!sep)
						main_top.appendChild(sep = document.createElement('hr'));
					scripts.forEach(menuScript);
				});
		}
	}

	chrome.tabs.query({currentWindow: true, active: true}, function(tabs) {
		tab=tabs[0];
		initMenu();
		chrome.tabs.sendMessage(tab.id, {cmd: 'GetPopup'});
	});

	return {
		setData: setData,
	};
}();

chrome.runtime.onMessage.addListener(function(req, src, callback) {
	var maps={
		SetPopup: Popup.setData,
	}, f=maps[req.cmd];
	if(f) f(req.data, src, callback);
});
