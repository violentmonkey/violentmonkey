'use strict';

const gulp = require('gulp');
const concat = require('gulp-concat');
const merge2 = require('merge2');
const minifyCss = require('gulp-minify-css');
const gulpFilter = require('gulp-filter');
const del = require('del');
const templateCache = require('./scripts/templateCache');

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

gulp.task('copy-files', function () {
  const cssFilter = gulpFilter(['**/*.css'], {restore: true});
  return gulp.src([
    'src/**',
    '!src/cache.js',
    '!src/**/templates/**',
    '!src/**/templates',
  ], {base:'src'})
  .pipe(cssFilter)
  .pipe(minifyCss())
  .pipe(cssFilter.restore)
  .pipe(gulp.dest('dist/'));
});

gulp.task('default', ['templates', 'copy-files']);
