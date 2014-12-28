#!node
var fs=require('fs'),path=require('path'),
		uglifyjs=require('uglify-js'),less=require('less');
function parseRule(s){
	if(s.substr(0,2)=='R:')
		return new RegExp('^'+s.substr(2)+'$');
	return s;
}
function getRules(p){
	var d=fs.readFileSync(p),
			jrules=JSON.parse(d),rules={},i,k,v;
	for(i in jrules) {
		k=parseRule(i);
		v=jrules[i];
		if(typeof v=='string') d=[parseRule(v)];
		else {
			d=[];v.forEach(function(i){d.push(parseRule(i));});
		}
		rules[i]=d;
	}
	return rules;
}
function getFileList(dir) {
	function walk(root) {
		var arr=fs.readdirSync(path.join(dir,root));
		arr.forEach(function(i){
			var p=path.join(root,i).replace(/\\/g,'/'),
					s=fs.statSync(path.join(dir,p));
			if(s.isDirectory()) walk(p);
			else files.push(p);
		});
	}
	var files=[];walk('');
	return files;
}
function Distributor(uncompressed,source){
	if(uncompressed.substr(-1)!='/') uncompressed+='/';
	this.uncompressed=uncompressed;
	this.source=source;
	this.mkdirs(uncompressed);
	this.streams={};
	this.processing=0;
}
Distributor.prototype={
	distribute:function(dest,src,srcdir){
		var t=this,i=-1;
		if(!src) src=dest;
		dest=t.uncompressed+dest;
		if(!srcdir) srcdir=t.source;
		t.mkdirs(path.dirname(dest));
		if(typeof src=='string') src=[src];
		src.forEach(function(i){
			i=path.join(srcdir,i);
			if(t.isTextFile(i)) t.packTextFile(i,dest);
			else t.copyFile(i,dest);
		});
	},
	isTextFile:function(p){
		return ['.html','.js','.css','.json'].indexOf(path.extname(p))>=0;
	},
	processStart:function(){
		this.processing++;
	},
	processFinish:function(){
		this.processing--;
		if(!this.processing) {
			if(this.onFinish) this.onFinish();
		}
	},
	getStream:function(p,callback){
		var s=this.streams[p];
		if(!s) s=this.streams[p]={
			stream:fs.createWriteStream(p,{encoding:'utf-8'}),
			using:false,
			callbacks:[],
		};
		if(s.using) s.callbacks.push(callback);
		else {
			this.processStart();
			s.using=true;callback.call(this,s.stream);
		}
	},
	finishStream:function(p){
		var s=this.streams[p],c;
		if(s.callbacks.length) {
			c=s.callbacks.splice(0,1)[0];
			c.call(this,s.stream);
		} else {
			s.using=false;this.processFinish();
		}
	},
	compressText:function(src){
		var r=fs.readFileSync(src,{encoding:'utf8'}),e=path.extname(src);
		if(e=='.html') [
			[/<!--.*?-->/g,''],
			[/<\s+/g,'<'],
			[/\s+>/g,'>'],
		].forEach(function(i){r=r.replace(i[0],i[1]);});
		return r;
	},
	packTextFile:function(src,dest){
		var r,t=this;
		function finish(){t.finishStream(dest);}
		t.getStream(dest,function(f){
			if(/\.js$/.test(src)) {
				r=uglifyjs.minify(src,{mangle:false});
				f.write(r.code,'utf-8',finish);
			} else if(/\.css$/.test(src)) {
				less.render(fs.readFileSync(src,{encoding:'utf8'}),{
					compress:true,
				},function(e,r){
					f.write(r.css,'utf-8',finish);
				});
			} else {
				f.write(t.compressText(src),'utf-8',finish);
			}
		});
	},
	copyFile:function(src,dest){
		var t=this;
		t.processStart();
		var r=fs.createReadStream(src),
				w=fs.createWriteStream(dest);
		r.pipe(w);
		w.on('close',function(){t.processFinish();});
	},
	mkdirs:function(dir){
		if(!dir) return;
		if(dir.substr(-1)=='/') dir=dir.substr(0,dir.length-1);
		var p=dir.split(/[\\/]/),i,s='';
		for(i=0;i<p.length;i++) {
			s=path.join(s,p[i]);
			if(!fs.existsSync(s)) fs.mkdirSync(s);
		}
	},
	finish:function(callback){
		function finish(){
			if(!--count) callback();
		}
		function closeStreams(){
			for(var i in t.streams) {
				count++;
				t.streams[i].stream.end('',null,finish);
			}
		}
		var t=this,count=0;
		if(!t.processing) closeStreams();
		else t.onFinish=closeStreams;
	},
};
function main(){
	var src='src',rules=getRules('pack/mappings.json'),
			filelist=getFileList(src),i,d,dis;
	console.log('Distibutor for Opera NEX addons - written in NodeJS by Gerald')
	d=JSON.parse(fs.readFileSync(path.join(src,'manifest.json'),{encoding:'utf8'}));
	console.log('Package loaded: '+d.name+' version '+d.version);
	dis=new Distributor(path.join('dist',d.name),src);
	for(i in rules) {
		d=[];
		rules[i].forEach(function(r){
			var i;
			if(typeof r=='string') {
				i=filelist.indexOf(r);
				if(i>=0) {
					d.push(r);
					filelist.splice(i,1);
				}
			} else for(i=0;i<filelist.length;i++)
				if(filelist[i].match(r)) {
					d.push(filelist[i]);
					filelist.splice(i,1);
					i--;
				}
		});
		if(d.length) {
			if(i=='P:') d.forEach(function(i){
				dis.distribute(i,null,'pack');
			}); else if(i!='D:')
				dis.distribute(i,d);
		}
	}
	filelist.forEach(function(i){
		dis.distribute(i);
	});
	dis.finish(function(){console.log('Finished.');});
}
main();
