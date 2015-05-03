'use strict';
!function() {
	var delay = 2000;
	var data = {};
	var lbUrl = $('#url');
	var lbMsg = $('#msg');
	var cbClose = $('#cbClose');
	var cbTrack = $('#cbTrack');
	var btInstall = $('#bInstall');
	var options = $('.options');
	var timer, editor;

	function showMessage(message, title) {
		lbMsg.innerHTML = message;
		lbMsg.setAttribute('title', title || message);
	}

	function zfill(num, length) {
		num = num.toString();
		while(num.length < length) num = '0' + num;
		return num;
	}

	function getTimeString() {
		var now = new Date();
		return zfill(now.getHours(), 2) + ':' +
			zfill(now.getMinutes(), 2) + ':' +
			zfill(now.getSeconds(), 2);
	}

	function getScriptFile(cb) {
		var x = new XMLHttpRequest();
		x.open('GET', data.url, true);
		x.onloadend = function() {
			var x = this;
			if(!x.status) data.local = true;
			if(x.status && x.status != 200 || !x.responseText)
				showMessage(_('msgErrorLoadingData'));
			else
				cb(x.responseText);
		};
		x.send();
	}

	function loadDependency(dict, urls, isBlob, cb) {
		urls.forEach(function(url){
			if(dict[url]) return cb();
			var x = new XMLHttpRequest();
			x.open('GET', url, true);
			if(isBlob) x.responseType = 'blob';
			x.onloadend = function(){
				var x = this;
				if(!x.status || x.status == 200) {
					if(isBlob) {
						var r = new FileReader();
						r.onload = function(e) {
							dict[url] = window.btoa(x.result);
							cb();
						};
						r.readAsBinaryString(x.response);
					} else {
						dict[url] = x.responseText;
						cb();
					}
				} else cb(url);
			};
			x.send();
		});
	}

	function parseMeta(body, cb) {
		function finish(){
			showMessage(_('msgLoadedData'));
			btInstall.disabled = false;
			data.depStatus = 1;
			if(cb) cb();
		}
		function finishOne(errUrl) {
			if(errUrl) err.push(errUrl);
			i ++;
			if(i >= length) {
				if(err.length) {
					showMessage(_('msgErrorLoadingDependency'), err.join('\n'));
				} else finish();
			} else showMessage(_('msgLoadingDependency', [i, length]));
		}
		var urls = [];
		var err = [];
		var i;
		var length;
		data.depStatus=0;
		chrome.runtime.sendMessage({cmd: 'ParseMeta', data: body}, function(script) {
			for(i in script.resources) urls.push(script.resources[i]);
			length = script.require.length + urls.length;
			if(length) {
				showMessage(_('msgLoadingDependency', [i = 0, length]));
				loadDependency(data.require = {}, script.require, false, finishOne);
				loadDependency(data.resources = {}, urls, true, finishOne);
			} else finish();
		});
	}

	function updateClose(){
		if(cbTrack.disabled = cbClose.checked) {
			cbTrack.checked = false;
			updateLocal();
		}
		setOption('closeAfterInstall', cbClose.checked);
	}

	function updateLocal(){
		setOption('trackLocalFile', cbTrack.checked);
		if(cbTrack.checked && data.depStatus && data.local)
			btInstall.disabled=false;
	}

	function trackLocalFile(){
		function check(){
			timer=null;
			getScriptFile(function(body) {
				var oldbody = editor.getValue();
				editor.setValue(body);
				body = editor.getValue();
				if(oldbody != body)
					parseMeta(body, function(){
						if(cbTrack.checked) install();
					});
				else if(cbTrack.checked)
					timer = setTimeout(check, delay);
			});
		}
		if(!timer) timer = setTimeout(check, delay);
	}

	function install(){
		btInstall.disabled=true;
		chrome.runtime.sendMessage({
			cmd:'ParseScript',
			data:{
				url: data.url,
				from: data.from,
				code: editor.getValue(),
				require: data.require,
				resources: data.resources,
			},
		}, function(res){
			showMessage(res.message + '[' + getTimeString() + ']');
			if(res.code >= 0) {
				if(cbClose.checked) close();
				else if(data.local && cbTrack.checked) trackLocalFile();
			}
		});
	}

	function close() {
		window.close();
	}

	function bindEvents() {
		cbClose.checked = getOption('closeAfterInstall');
		updateClose();
		cbClose.addEventListener('change', updateClose, false);
		cbTrack.checked = getOption('trackLocalFile');
		cbTrack.addEventListener('change', updateLocal, false);
		$('#bClose').addEventListener('click', close, false);
		btInstall.addEventListener('click', install, false);
		var hideOptions = function(){
			options.style.display = '';
			document.removeEventListener('mousedown', hideOptions, false);
		};
		$('#bOptions').addEventListener('click', function(e){
			options.style.right = this.parentNode.offsetWidth - this.offsetWidth - this.offsetLeft + 'px';
			options.style.display = 'block';
			document.addEventListener('mousedown', hideOptions, false);
		}, false);
		options.addEventListener('mousedown', stopPropagation, false);
	}

	initEditor({
		container: $('.code'),
		callback: function(_editor) {
			editor = _editor;
			location.search.slice(1).split('&').forEach(function(part) {
				part.replace(/^([^=]*)=(.*)$/, function(value, group1, group2) {
					data[group1] = decodeURIComponent(group2);
				});
			});
			lbUrl.innerHTML = _('msgScriptURL', [data.url || '-']);
			if(data.url) {
				lbUrl.setAttribute('title', data.url);
				showMessage(_('msgLoadingData'));
				getScriptFile(function(body) {
					editor.setValueAndFocus(body);
					parseMeta(body);
				});
			}
		},
		onexit: close,
		readonly: true,
	});
	bindEvents();
	initI18n();
}();
