// Javascript moxed mode for CodeMirror
// Distributed under an MIT license

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("codemirror/lib/codemirror"), require("codemirror/mode/xml/xml"), require("codemirror/mode/javascript/javascript"), require("codemirror/mode/css/css"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["codemirror/lib/codemirror", "codemirror/mode/xml/xml", "codemirror/mode/javascript/javascript", "codemirror/mode/css/css"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
  "use strict";

  function dbg() {
    // console.debug.apply(console, arguments);
  }

  /* TODOs
  x refactor the mode switching logic to be more flexible and eaiser to read
  x support extra spaces, e.g.,  between 'beforeend' and `html string` in insertAdjacentHTML case
  x support element.innerHTML = `htm-string`;
  x correctly handle single-line string template
  x highlight arbitrary string template as html/css with inline comment hint: "html", "css"
  */

  CodeMirror.defineMode("javascript-mixed", function (config, parserConfig) {
    var jsMode = CodeMirror.getMode(config, { name: "javascript" });


    var STYLE_PASS = 'XXX-PASS'; // indicate the css/html matcher does not return  local mode style

    var forceJsModeToQuasi = (function() {
      var tokenQuasi = null;
      function getTokenQuasi(stream) {
        if (tokenQuasi != null) {
          return tokenQuasi;
        }
        // create a new stream of a non-ending (1st line of a multiline)
        // string template to obtain tokenQuasi tokenizer
        var dummyStream = new stream.constructor('`#dummy', 2, {});
        var dummyState = jsMode.startState();
        jsMode.token(dummyStream, dummyState);
        tokenQuasi = dummyState.tokenize;
        return tokenQuasi;
      }

      function forceJsModeToQuasi(stream, jsState) {
        jsState.tokenize = getTokenQuasi(stream);
      }

      return forceJsModeToQuasi;
    })();


    function prepareReparseStringTemplateInLocalMode(stream, state) {
      dbg('DBG: spit out beginning backtick as a token, and leave the rest of the text for local mode parsing');
      stream.backUp(stream.current().length - 1); // backup parsed string, except the beginning backtick

      // workaround needed for 1-line string template,
      // to ensure the ending backtick is parsed correctly.
      forceJsModeToQuasi(stream, state.jsState);
    }

    function exitLocalModeAndTokenEndingBacktick(stream, state) {
      dbg('DBG: exiting local html/css mode...');
      // parse the ending JS string template backtick in js mode
      return jsMode.token(stream, state.jsState);
    }

    function tokenInLocalMode(modeToUse, stream, state) {
      // parse the text in local mode
      state.localMode = state.localMode || modeToUse;
      state.localState = state.localState || CodeMirror.startState(state.localMode);
      var style = state.localMode.token(stream, state.localState);
      dbg(`  local ${modeToUse.name} mode token result: `, stream.current());
      return style;
    }

    function matchRule(rules, stream, state) {
      for (var r of rules) {
        if (r.curContext === (state.maybeLocalContext || '<start>')) {
          // dbg('rule:', r.curContext, r.matchFn.toString());
          var matched = r.run(stream, state);
          if (matched) { break; }
        }
      }
    }

    class Rule {
      constructor(curContext, matchFn, nextContext, caseMatchedFn, caseNotMatchedFn) {
        this.curContext = curContext;
        this.matchFn = matchFn;
        this.nextContext = nextContext;
        this.caseMatchedFn = caseMatchedFn; // optional
        this.caseNotMatchedFn = caseNotMatchedFn; // optional
      }

      run(stream, state) {
        if (this.matchFn()) {
          state.maybeLocalContext = this.nextContext;
          if (state.maybeLocalContext == null) {
            // local mode done, reset
            state.localMode = null;
            state.localState = null;
          }
          if (this.caseMatchedFn) { this.caseMatchedFn(); }
          return true;
        } else { // case rule transition criteria not matched
          if (this.caseNotMatchedFn) {
            this.caseNotMatchedFn();
          } else { // default not matched logic: reset local mode matching
            state.maybeLocalContext = null;
          }
          return false;
        }
      }
    }

    var cssMatcher = (function() {

      var cssMode = CodeMirror.getMode(config, {name: 'css'});

      function maybeToken(stream, state, jsTokStyle) {
        var tokStyle = STYLE_PASS;
        var tokTyp = state.jsState.lastType;
        var tokStr = stream.current();

        // define the transition rules to enter local CSS mode;
        var rules = [
          // <current-context>, <match-criteria>, <next-context-if-matched>,
          // <optional-side-effects-if-matched>,
          // <optional-side-effects-not-matched>
          //
          // - side-effects-not-matched: if not specified, defaulted to reset local mode matching

          // for pattern GM_addStyle(`css-string`);
          new Rule('<start>', () => tokStr === 'GM_addStyle' && tokTyp === 'variable',
           'css-1'),
          new Rule('css-1', () => tokTyp === '(' && tokStr === '(',
           'css-2'),
          new Rule('css-2', () => tokTyp === 'quasi', // if it's a string template
           'css-in',
           () => prepareReparseStringTemplateInLocalMode(stream, state)),
          new Rule('css-in', () => stream.peek() === "`", // if it hits ending backtick for string template
           null, // then exiting local css mode
           () => { tokStyle = exitLocalModeAndTokenEndingBacktick(stream, state) },
           () => { tokStyle = tokenInLocalMode(cssMode, stream, state); } // else stay in local mode
                  ),

          // for pattern var someCSS = /* css */ `css-string`
          new Rule('<start>', () => jsTokStyle === 'comment' && (/^\/\*\s*css\s*\*\/$/i).test(tokStr),
                   'css-21'),
          new Rule('css-21', () => tokTyp === 'quasi',
                   'css-in',
                   () => prepareReparseStringTemplateInLocalMode(stream, state))
        ];

        matchRule(rules, stream, state);

        return tokStyle;
      };

      return {
        maybeToken: maybeToken
      };
    })(); // cssMatcher

    var htmlMatcher = (function() {

      var htmlMode = CodeMirror.getMode(config, {name: 'xml', htmlMode: true,
                                                 multilineTagIndentFactor: parserConfig.multilineTagIndentFactor,
                                                 multilineTagIndentPastTag: parserConfig.multilineTagIndentPastTag
                                                });

      function maybeToken(stream, state, jsTokStyle) {
        var tokStyle = STYLE_PASS;
        var tokTyp = state.jsState.lastType;
        var tokStr = stream.current();

        // define the transition rules to enter local html mode;
        var rules = [
          // for pattern insertAdjacentHTML('beforeend', `html-string-template`);
          new Rule('<start>', () => tokStr === 'insertAdjacentHTML' && tokTyp === 'variable',
                  'html-1'),
          new Rule('html-1', () => tokTyp === '(' && tokStr === '(',
                  'html-2'),
          new Rule('html-2', () => tokTyp === 'string', // e.g., 'beforeend', OPEN: consider to check value
                  'html-3'),
          new Rule('html-3', () => tokTyp === ',' && tokStr === ',',
                  'html-4'),
          new Rule('html-4', () => tokTyp === 'quasi', // if it's a string template
                  'html-in',
                  () => prepareReparseStringTemplateInLocalMode(stream, state)),
          new Rule('html-in', () => stream.peek() === "`", // if it hits ending backtick for string template
                  null, // then exit local html mode
                  () => { tokStyle = exitLocalModeAndTokenEndingBacktick(stream, state) },
                  () => { tokStyle = tokenInLocalMode(htmlMode, stream, state); } // else stay in local mode
                  ),

          // for pattern elt.innerHTML = `html-string`
          // variation: outerHTML, +=
          new Rule('<start>', () => ['innerHTML', 'outerHTML'].includes(tokStr)  && jsTokStyle === 'property',
                   'html-11'),
          new Rule('html-11', () => ['=', '+='].includes(tokStr) && tokTyp === 'operator',
                   'html-12'),
          new Rule('html-12', () => tokTyp === 'quasi',
                   'html-in',
                   () => prepareReparseStringTemplateInLocalMode(stream, state)),

          // for pattern var someHTML = /* html */ `html-string`
          new Rule('<start>', () => jsTokStyle === 'comment' && (/^\/\*\s*html\s*\*\/$/i).test(tokStr),
                   'html-21'),
          new Rule('html-21', () => tokTyp === 'quasi',
                   'html-in',
                   () => prepareReparseStringTemplateInLocalMode(stream, state))
          ];

        matchRule(rules, stream, state);

        return tokStyle;
      };


      return {
        maybeToken: maybeToken
      };
    })(); // htmlMatcher


    function jsToken(stream, state) {
      // dbg('jsToken -', `${stream.pos}: ${stream.string.substring(stream.pos).substring(0, 8)}`, state.lastType);

      // adapt the existing jsmode tokenizer with the wrapper state
      var tokStyle = null;
      if (!['html-in', 'css-in'].includes(state.maybeLocalContext)) {
        // when in local html/css context, skip js parsing,
        // so as not to mess up js tokenizer's state.
        tokStyle = jsMode.token(stream, state.jsState);
        dbg(state.maybeLocalContext, state.jsState.lastType, stream.current(), `[${tokStyle}]`); window._jsState = state.jsState;
        if (tokStyle === null) { // case the token is not relevant semantically, e.g., space or line break;
          // just return,  skip local mode match,
          // as such token is not reflected in stream/state so the local mode matcher
          // will end up seeing previous token.
          return null;
        }
      }

      // match to see if it needs to switch to local html mode, return local mode style if applicable
      var maybeLocalStyle = htmlMatcher.maybeToken(stream, state, tokStyle);
      if (maybeLocalStyle === STYLE_PASS) {
        maybeLocalStyle = cssMatcher.maybeToken(stream, state, tokStyle);
      }

      if (maybeLocalStyle != STYLE_PASS) {
        tokStyle = maybeLocalStyle;
      }

      return tokStyle;
    }

    return {
      startState: function () {
        var state = CodeMirror.startState(jsMode);
        return {token: jsToken,
        localMode: null, localState: null,
        maybeLocalContext: null,
        jsState: state};
      },

      copyState: function (state) {
        var local;
        if (state.localState) {
          local = CodeMirror.copyState(state.localMode, state.localState);
        }
        return {token: state.token,
                localMode: state.localMode, localState: local,
                maybeLocalContext : state.maybeLocalContext,
                jsState: CodeMirror.copyState(jsMode, state.jsState)};
      },

      token: function (stream, state) {
        // dbg(`${stream.pos}: ${stream.string.substring(stream.pos).substring(0, 15)}`, state.lastType);
        var tokSty = state.token(stream, state);

        var tokTyp = state.jsState.lastType;
        var tokStr = stream.string.substring(stream.start, stream.pos);
        dbg(' <--', tokTyp, tokStr);
        return tokSty;
      },

      indent: function (state, textAfter, line) {
        dbg(`indent: "${textAfter}" "${line}"`);
        if (!state.localMode)
          return jsMode.indent(state.jsState, textAfter, line);
        else if (state.localMode.indent)
          return state.localMode.indent(state.localState, textAfter, line);
        else
          return CodeMirror.Pass;
      },

      innerMode: function (state) {
        return {state: state.localState || state.jsState, mode: state.localMode || jsMode};
      }
    };
  }, "javascript", "xml", "css");

});
