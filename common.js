function format() {
  var a = arguments;
  if (a[0]) return a[0].replace(/\$(?:\{(\d+)\}|(\d+))/g, function(v, g1, g2) {
    g1 = a[g1 || g2];
    if (g1 == undefined) g1 = v;
    return g1;
  });
}
function initCSS(){
	var s=document.createElement('style');
	s.innerHTML=_('css');
	document.head.appendChild(s);
}
function _(){
	var t=chrome.i18n.getMessage.apply(this,arguments);
	if(!t) t=arguments[0];
	return t;
}
function initI18n(){
	window.addEventListener('DOMContentLoaded',function(){
		var nodes=document.querySelectorAll('.i18n'),i,t;
		for(i=0;i<nodes.length;i++) nodes[i].innerHTML=_(nodes[i].innerHTML);
	},true);
}
