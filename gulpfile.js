'use strict';

const gulp = require('gulp');
const concat = require('gulp-concat');
const merge2 = require('merge2');
const minifyCss = require('gulp-minify-css');
const gulpFilter = require('gulp-filter');
const del = require('del');
const templateCache = require('./scripts/templateCache');
const i18n = require('./scripts/i18n');

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
    '!src/_locales/**',
  ], {base:'src'})
  .pipe(cssFilter)
  .pipe(minifyCss())
  .pipe(cssFilter.restore)
  .pipe(gulp.dest('dist/'));
});

gulp.task('copy-i18n', function () {
  return gulp.src([
    'src/**/*.js',
    'src/**/*.html',
    'src/**/*.json',
  ]).pipe(i18n.extract({
    base: 'src',
    prefix: '_locales',
    touchedOnly: true,
    useDefaultLang: true,
    markUntouched: false,
  }))
  .pipe(gulp.dest('dist'));
});

gulp.task('default', ['templates', 'copy-files', 'copy-i18n']);

gulp.task('i18n', function () {
  return gulp.src([
    'src/**/*.js',
    'src/**/*.html',
    'src/**/*.json',
  ]).pipe(i18n.extract({
    base: 'src',
    prefix: '_locales',
    touchedOnly: false,
    useDefaultLang: false,
    markUntouched: true,
  }))
  .pipe(gulp.dest('src'));
});
