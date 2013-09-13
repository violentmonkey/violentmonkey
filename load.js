function addScript(data,callback){
	function add(data){
		var s=document.createElement('script');
		if(data.innerHTML) s.innerHTML=data.innerHTML;
		else if(data.src) s.src=data.src;
		s.onload=finish;
		document.body.appendChild(s);
	}
	function finish(){
		if(!--count) callback();
	}
	if(!data.forEach) data=[data];
	var count=data.length;
	data.forEach(add);
}
function addCSS(data){
	function add(data){
		var s=null;
		if(data.innerHTML) {
			s=document.createElement('style');
			s.innerHTML=data.innerHTML;
		} else if(data.href) {
			s=document.createElement('link');
			s.rel='stylesheet';
			s.type='text/css';
			s.href=data.href;
		}
		if(s) document.head.appendChild(s);
	}
	if(!data.forEach) data=[data];
	data.forEach(add);
}
var loadScript=(function(){
	function getFile(filename,onerror){
		var x=new XMLHttpRequest();
		x.open('GET',filename,true);
		x.onload=function(){addScript({innerHTML:this.responseText});};
		x.onerror=onerror;
		x.send();
	}
	return function(filename,prefixes){
		function loop(){
			if(prefixes&&prefixes.length) {
				var p=prefixes.shift();
				getFile(p+filename,loop);
			}
		}
		getFile(filename,loop);
	};
})();
window.addEventListener('DOMContentLoaded',function(){
	Array.prototype.forEach.call(document.querySelectorAll('link[rel=compatible-script]'),function(i){
		loadScript(i.getAttribute('href'));
	});
},false);
