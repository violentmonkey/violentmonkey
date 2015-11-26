'use strict';

const gulp = require('gulp');
const gutil = require('gulp-util');
const minifyCss = require('gulp-minify-css');
const minifyHtml = require('gulp-minify-html');
const through = require('through2');
const concat = require('gulp-concat');
const merge2 = require('merge2');
const _ = require('underscore');
const del = require('del');

function templateCache() {
  const contentTpl = '_.cache.put(<%= name %>, <%= content %>);\n';
  let content = '/* Below are templates cached from `_.template` with love :) */\n\n';
  function bufferContents(file, enc, cb) {
    if (file.isNull()) return cb();
    if (file.isStream())
      return this.emit('error', new gutil.PluginError('VM-cache', 'Stream is not supported.'));
    content += gutil.template(contentTpl, {
      name: JSON.stringify(('/' + file.relative).replace(/\\/g, '/')),
      content: _.template(String(file.contents), {variable: 'it'}).source,
      file: '',
    });
    cb();
  }
  function endStream(cb) {
    this.push(new gutil.File({
      base: '',
      path: 'template.js',
      contents: new Buffer(content),
    }));
    cb();
  }
  return through.obj(bufferContents, endStream);
}

gulp.task('templates', function () {
  return merge2([
    gulp.src('src/cache.js'),
    gulp.src('src/**/templates/*.html').pipe(templateCache()),
  ]).pipe(concat('cache.js'))
  .pipe(gulp.dest('dist'));
});

gulp.task('clean', function () {
  return del(['dist']);
});

gulp.task('copy-files',function(){
  return gulp.src([
    'src/**',
    '!src/cache.js',
    '!src/**/templates/**',
    '!src/**/templates',
  ], {base:'src'})
  .pipe(gulp.dest('dist/'));
});

gulp.task('default', ['templates', 'copy-files']);
