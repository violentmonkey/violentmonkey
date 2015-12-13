'use strict';

const minify = require('html-minifier').minify;

module.exports = function (data) {
  data = String(data);
  const fragments = [];
  const html = data.replace(/<%[\s\S]*?%>/g, function (match) {
    fragments.push(match);
    return `__frag_${fragments.length - 1}__`;
  });
  return minify(html, {
    removeComments: true,
    collapseWhitespace: true,
    conservativeCollapse: true,
  }).replace(/__frag_(\d+)__/g, function (match, id) {
    return fragments[id];
  });
};
