'use strict';

var _ = chrome.i18n.getMessage;
var $ = document.querySelector.bind(document);
var $$ = document.querySelectorAll.bind(document);
var stopPropagation = function(e) {e.stopPropagation();};
var defaults = {
	isApplied: true,
	autoUpdate: true,
	lastUpdate: 0,
	exportValues: true,
	closeAfterInstall: false,
	trackLocalFile: false,
	injectMode: 0,
};

function getOption(key, def) {
	var value = localStorage.getItem(key), obj;
	if(value) try {
		obj = JSON.parse(value);
	} catch(e) {
		obj = def;
	} else obj = def;
	if(typeof obj === 'undefined')
		obj = defaults[key];
	return obj;
}

function setOption(key, value) {
	if(key in defaults)
		localStorage.setItem(key, JSON.stringify(value));
}

function getAllOptions() {
	var options = {};
	for(var i in defaults) options[i] = getOption(i);
	return options;
}

/*
function format() {
  var args = arguments;
  if (args[0]) return args[0].replace(/\$(?:\{(\d+)\}|(\d+))/g, function(value, group1, group2) {
		var index = typeof group1 != 'undefined' ? group1 : group2;
		return index >= args.length ? value : (args[index] || '');
  });
}
*/

function safeHTML(html) {
	return html.replace(/[&<]/g, function(m) {
		return {
			'&': '&amp;',
			'<': '&lt;',
		}[m];
	});
}

function initI18n(callback){
	window.addEventListener('DOMContentLoaded', function() {
		Array.prototype.forEach.call($$('[data-i18n]'), function(node) {
			node.innerHTML = _(node.getAttribute('data-i18n'));
		});
		if(callback) callback();
	}, false);
}

/**
 * Get locale attributes such as @name:zh-CN
 */
function getLocaleString(dict, key){
	navigator.languages.some(function(lang) {
		var keylang = key + ':' + lang;
		if(keylang in dict) {
			key = keylang;
			return true;
		}
	});
	return dict[key] || '';
}
