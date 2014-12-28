var P=$('#main'),C=$('#commands'),
		pT=P.querySelector('.top'),pB=P.querySelector('.bot'),
		cT=C.querySelector('.top'),cB=C.querySelector('.bot'),
		tab=null,ia=null,scripts={},hr=null;
function loadItem(d,c) {
	d.data=c;
	if(d.symbols) {
		d.firstChild.className='fa '+d.symbols[c?1:0];
		if(d.symbols.length>1) {
			if(c) d.classList.remove('disabled');
			else d.classList.add('disabled');
		}
	}
}
function addItem(h,c,b) {
  var d=document.createElement('div');
  d.innerHTML='<i></i> '+h;
  if('title' in c) {
    d.title=typeof c.title=='string'?c.title:h;
    delete c.title;
  }
  c.holder.insertBefore(d,b);
  for(h in c) d[h]=c[h];
	if(d.symbols) loadItem(d,d.data);
	return d;
}
function menuCommand(e) {
	chrome.tabs.sendMessage(tab.id,{cmd:'Command',data:e.target.cmd});
}
function menuScript(s) {
	if(s&&!scripts[s.id]) {
		scripts[s.id]=s;
		var n=s.custom.name||getLocaleString(s.meta,'name');
		n=n?n.replace(/&/g,'&amp;').replace(/</g,'&lt;'):'<em>'+_('labelNoName')+'</em>';
		addItem(n,{
			holder: pB,
			symbols: ['fa-times','fa-check'],
			className: 'ellipsis',
			title: s.meta.name,
			onclick: function(e){
				var d=!this.data;
				chrome.runtime.sendMessage({cmd:'UpdateMeta',data:{id:s.id,enabled:d}});
				loadItem(this,d);
			},
			data:s.enabled,
		});
	}
}
function initMenu(){
  addItem(_('menuManageScripts'),{
    holder: pT,
    symbols: ['fa-hand-o-right'],
    //title: true,
    onclick: function(){
			var u=chrome.extension.getURL('/options.html');
			chrome.tabs.query({currentWindow:true,url:u},function(t) {
				if(t[0]) chrome.tabs.update(t[0].id,{active:true});
				else chrome.tabs.create({url:u});
			});
		}
  });
  if(/^https?:\/\//i.test(tab.url))
		addItem(_('menuFindScripts'), {
			holder: pT,
			symbols: ['fa-hand-o-right'],
			//title: true,
			onclick: function(){
				var h=tab.url.match(/:\/\/(?:www\.)?([^\/]*)/);
				chrome.tabs.create({url:'https://greasyfork.org/scripts/search?q='+h[1]});
			},
		});
  ia=addItem(_('menuScriptEnabled'), {
    holder: pT,
		symbols: ['fa-times','fa-check'],
    //title: true,
    onclick: function(e) {
			var d=!this.data;
      chrome.runtime.sendMessage({
				cmd:'SetOption',
				data:{key:'isApplied',value:d},
			});
			loadItem(this,d);
			chrome.browserAction.setIcon({
				path:'images/icon19'+(this.data?'':'w')+'.png',
			});
    }
  });
	chrome.runtime.sendMessage({
		cmd:'GetOption',data:'isApplied',
	},function(o){loadItem(ia,o);});
}
function load(data) {
  if(data&&data[0]&&data[0].length) {
    addItem(_('menuBack'), {
      holder: cT,
      symbols: ['fa-arrow-left'],
      //title: true,
      onclick: function() {
        C.classList.add('hide');
        P.classList.remove('hide');
      }
    });
    cT.appendChild(document.createElement('hr'));
    data[0].forEach(function(i) {
      addItem(i[0], {
        holder: cB,
				className: 'ellipsis',
        symbols: ['fa-hand-o-right'],
        //title: true,
        onclick: menuCommand,
        cmd: i[0]
      });
    });
    addItem(_('menuCommands'),{
      holder: pT,
      symbols: ['fa-arrow-right'],
      //title: true,
      onclick: function() {
        P.classList.add('hide');
        C.classList.remove('hide');
      }
    },ia);
  }
  if(data&&data[1]&&data[1].length) {
		var ids=[];
		data[1].forEach(function(i){
			if(!scripts[i]) ids.push(i);
		});
		if(ids.length) chrome.runtime.sendMessage({cmd:'GetMetas',data:ids},function(o){
			if(!hr) pT.appendChild(hr=document.createElement('hr'));
			o.forEach(menuScript);
		});
	}
}
chrome.runtime.onMessage.addListener(function(req,src,callback) {
	var maps={
		SetPopup: load,
	},f=maps[req.cmd];
	if(f) f(req.data,src,callback);
	return true;
});
chrome.tabs.query({currentWindow:true,active:true},function(t) {
	tab=t[0];initMenu();chrome.tabs.sendMessage(tab.id,{cmd:'GetPopup'});
});
