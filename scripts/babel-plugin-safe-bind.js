/*
Modified the original to use a global `safeCall`:
https://babeljs.io/docs/en/babel-plugin-proposal-function-bind

MIT License

Copyright (c) 2014-present Sebastian McKenzie and other contributors

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _helperPluginUtils = require("@babel/helper-plugin-utils");

var _pluginSyntaxFunctionBind = require("@babel/plugin-syntax-function-bind");

var _core = require("@babel/core");

var _default = (0, _helperPluginUtils.declare)(api => {
  api.assertVersion(7);

  function getTempId(scope) {
    let id = scope.path.getData("functionBind");
    if (id) return _core.types.cloneNode(id);
    id = scope.generateDeclaredUidIdentifier("context");
    return scope.path.setData("functionBind", id);
  }

  function getStaticContext(bind, scope) {
    const object = bind.object || bind.callee.object;
    return scope.isStatic(object) && (_core.types.isSuper(object) ? _core.types.thisExpression() : object);
  }

  function inferBindContext(bind, scope) {
    const staticContext = getStaticContext(bind, scope);
    if (staticContext) return _core.types.cloneNode(staticContext);
    const tempId = getTempId(scope);

    if (bind.object) {
      bind.callee = _core.types.sequenceExpression([_core.types.assignmentExpression("=", tempId, bind.object), bind.callee]);
    } else {
      bind.callee.object = _core.types.assignmentExpression("=", tempId, bind.callee.object);
    }

    return _core.types.cloneNode(tempId);
  }

  return {
    name: "safe-function-bind",
    inherits: _pluginSyntaxFunctionBind.default,
    visitor: {
      CallExpression({
        node,
        scope
      }) {
        const bind = node.callee;
        if (!_core.types.isBindExpression(bind)) return;
        // ORIGINAL:
        // const context = inferBindContext(bind, scope);
        // node.callee = _core.types.memberExpression(bind.callee, _core.types.identifier("call"));
        // node.arguments.unshift(context);
        // MODIFIED to use safeCall created in safe-globals.js:
        const object = bind.object || bind.callee.object;
        const context = scope.isStatic(object) && _core.types.isSuper(object)
          ? _core.types.thisExpression()
          : object;
        node.callee = _core.types.identifier("safeCall");
        node.arguments.unshift(bind.callee, _core.types.cloneNode(context));
      },

      BindExpression(path) {
        const {
          node,
          scope
        } = path;
        const context = inferBindContext(node, scope);
        path.replaceWith(_core.types.callExpression(_core.types.memberExpression(node.callee, _core.types.identifier("bind")), [context]));
      }

    }
  };
});

exports.default = _default;
