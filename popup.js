var P=$('#popup'),C=$('#commands'),
		pT=P.querySelector('.top'),pB=P.querySelector('.bot'),
		cT=C.querySelector('.top'),cB=C.querySelector('.bot'),
		tab=null,ia=null,scripts={},hr=null;
function loadItem(d,c) {
  if(d.data=c){
    d.firstChild.innerText=d.symbol;
    d.classList.remove('disabled');
  } else {
    d.firstChild.innerText = '';
    d.classList.add('disabled');
  }
	return c;
}
function addItem(h,c,b) {
  var d=document.createElement('div');
  d.innerHTML='<span></span>'+h;
  if('title' in c) {
    d.title=typeof c.title=='string'?c.title:h;
    delete c.title;
  }
  d.className='ellipsis';
  c.holder.insertBefore(d,b);
  if('symbol' in c) d.firstChild.innerText = c.symbol;
  for(h in c) d[h]=c[h];
	return d;
}
function menuCommand(e) {
	chrome.tabs.sendMessage(tab.id,{cmd:'Command',data:e.target.cmd});
}
function menuScript(s) {
	if(s&&!scripts[s.id]) {
		scripts[s.id]=s;
		var n=s.meta.name?s.meta.name.replace(/&/g,'&amp;').replace(/</g,'&lt;'):'<em>'+_('labelNoName')+'</em>';
		loadItem(addItem(n,{
			holder: pB,
			symbol: '✓',
			title: s.meta.name,
			onclick: function(e){
				chrome.runtime.sendMessage({cmd:'UpdateMeta',data:{id:s.id,enabled:loadItem(this,!this.data)?1:0}});
			}
		}),s.enabled);
	}
}
function initMenu(){
  addItem(_('menuManageScripts'),{
    holder: pT,
    symbol: '➤',
    //title: true,
    onclick: function(){
			var u=chrome.extension.getURL('/options.html');
			chrome.tabs.query({currentWindow:true,url:u},function(t) {
				if(t[0]) chrome.tabs.update(t[0].id,{active:true});
				else chrome.tabs.create({url:u});
			});
		}
  });
  if(/^https?:\/\//i.test(tab.url)) {
		var d=addItem(_('menuFindScripts'), {
			holder: pT,
			symbol: '➤',
			//title: true,
		});
		loadItem(d,false);
		chrome.runtime.sendMessage({cmd:'GetOption',data:'search'},function(o){
			d.onclick=function(){
				var h=tab.url.match(/:\/\/(?:www\.)?([^\/]*)/);
				chrome.tabs.create({url:'https://greasyfork.org/scripts/search?q='+h[1]});
			};
			loadItem(d,true);
		});
	}
  ia=addItem(_('menuScriptEnabled'), {
    holder: pT,
		symbol: '✓',
    //title: true,
    onclick: function(e) {
      chrome.runtime.sendMessage({cmd:'SetOption',data:{key:'isApplied',value:loadItem(this,!this.data)}});
			chrome.browserAction.setIcon({path:'images/icon19'+(this.data?'':'w')+'.png'});
    }
  });
	chrome.runtime.sendMessage({cmd:'GetOption',data:'isApplied'},function(o){loadItem(ia,o);});
}
function load(data) {
  if(data&&data[0]&&data[0].length) {
    addItem(_('menuBack'), {
      holder: cT,
      symbol: '◄',
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
        symbol: '➤',
        //title: true,
        onclick: menuCommand,
        cmd: i[0]
      });
    });
    addItem(_('menuCommands'),{
      holder: pT,
      symbol: '➤',
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
