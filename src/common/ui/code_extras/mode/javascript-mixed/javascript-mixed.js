// Javascript mixed mode for CodeMirror
// Distributed under an MIT license

/* eslint func-names: "off" */
(function (mod) {
  if (typeof exports === 'object' && typeof module === 'object') { // CommonJS
    // eslint-disable-next-line global-require
    mod(require('codemirror/lib/codemirror'), require('codemirror/mode/xml/xml'), require('codemirror/mode/javascript/javascript'), require('codemirror/mode/css/css'));
  // eslint-disable-next-line no-undef
  } else if (typeof define === 'function' && define.amd) { // AMD
    // eslint-disable-next-line no-undef
    define(['codemirror/lib/codemirror', 'codemirror/mode/xml/xml', 'codemirror/mode/javascript/javascript', 'codemirror/mode/css/css'], mod);
  } else { // Plain browser env
    // eslint-disable-next-line no-undef
    mod(CodeMirror);
  }
}((CodeMirror) => {
  function dbg() {
    // console.debug.apply(console, arguments);
  }

  CodeMirror.defineMode('javascript-mixed', (config, parserConfig) => {
    const jsMode = CodeMirror.getMode(config, { name: 'javascript' });

    const STYLE_PASS = 'XXX-PASS'; // indicate the css/html matcher does not return  local mode style

    const forceJsModeToQuasi = (function () {
      let tokenQuasi = null;
      function getTokenQuasi(stream) {
        if (tokenQuasi != null) {
          return tokenQuasi;
        }
        // create a new stream of a non-ending (1st line of a multiline)
        // string template to obtain tokenQuasi tokenizer
        const dummyStream = new stream.constructor('`#dummy', 2, {});
        const dummyState = jsMode.startState();
        jsMode.token(dummyStream, dummyState);
        tokenQuasi = dummyState.tokenize;
        return tokenQuasi;
      }

      function _forceJsModeToQuasi(stream, jsState) {
        jsState.tokenize = getTokenQuasi(stream);
      }

      return _forceJsModeToQuasi;
    }());


    function prepareReparseStringTemplateInLocalMode(modeToUse, stream, state) {
      dbg(`Entering local ${modeToUse} mode...`);
      // spit out beginning backtick as a token, and leave the rest of the text for local mode parsing
      stream.backUp(stream.current().length - 1);

      // workaround needed for 1-line string template,
      // to ensure the ending backtick is parsed correctly.
      forceJsModeToQuasi(stream, state.jsState);

      // switch to local mode for subsequent text
      state.localMode = modeToUse;
      state.localState = CodeMirror.startState(state.localMode);
    }

    function exitLocalModeAndTokenEndingBacktick(stream, state) {
      dbg('Exiting local html/css mode...');
      // parse the ending JS string template backtick in js mode
      return jsMode.token(stream, state.jsState);
    }

    function tokenInLocalMode(stream, state) {
      const style = state.localMode.token(stream, state.localState);
      dbg('  local mode token - ', stream.current());
      return style;
    }

    function matchRule(rules, stream, state) {
      for (const r of rules) {
        if (r.curContext === (state.maybeLocalContext || '<start>')) {
          // dbg('  rule:', r.curContext, r.matchFn.toString());
          const matched = r.run(stream, state);
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
        } // case rule transition criteria not matched
        if (this.caseNotMatchedFn) {
          this.caseNotMatchedFn();
        } else { // default not matched logic: reset local mode matching
          state.maybeLocalContext = null;
        }
        return false;
      }
    }

    const cssMatcher = (function () {
      const cssMode = CodeMirror.getMode(config, { name: 'css' });

      function maybeToken(stream, state, jsTokStyle) {
        let tokStyle = STYLE_PASS;
        const tokTyp = state.jsState.lastType;
        const tokStr = stream.current();

        // define the transition rules to enter local CSS mode;
        const rules = [
          // <current-context>, <match-criteria>, <next-context-if-matched>,
          // <optional-side-effects-if-matched>,
          // <optional-side-effects-not-matched>
          //
          // - side-effects-not-matched: if not specified, defaulted to reset local mode matching

          // for pattern GM_addStyle(`css-string`);
          new Rule('<start>', () => tokTyp === 'variable' && tokStr === 'GM_addStyle',
            'css-1'),
          new Rule('css-1', () => tokTyp === '(' && tokStr === '(',
            'css-2'),
          new Rule('css-2', () => tokTyp === 'quasi', // if it's a string template
            'css-in',
            () => prepareReparseStringTemplateInLocalMode(cssMode, stream, state)),
          new Rule('css-in', () => stream.peek() === '`', // if it hits ending backtick for string template
            null, // then exiting local css mode
            () => { tokStyle = exitLocalModeAndTokenEndingBacktick(stream, state); },
            () => { tokStyle = tokenInLocalMode(stream, state); }), // else stay in local mode

          // for pattern var someCSS = /* css */ `css-string`
          new Rule('<start>', () => jsTokStyle === 'comment' && (/^\/\*\s*css\s*\*\/$/i).test(tokStr),
            'css-21'),
          new Rule('css-21', () => tokTyp === 'quasi',
            'css-in',
            () => prepareReparseStringTemplateInLocalMode(cssMode, stream, state)),
        ];

        matchRule(rules, stream, state);

        return tokStyle;
      }

      return {
        maybeToken,
      };
    }()); // cssMatcher

    const htmlMatcher = (function () {
      const htmlMode = CodeMirror.getMode(config, {
        name: 'xml',
        htmlMode: true,
        multilineTagIndentFactor: parserConfig.multilineTagIndentFactor,
        multilineTagIndentPastTag: parserConfig.multilineTagIndentPastTag,
      });

      function maybeToken(stream, state, jsTokStyle) {
        let tokStyle = STYLE_PASS;
        const tokTyp = state.jsState.lastType;
        const tokStr = stream.current();

        // define the transition rules to enter local html mode;
        const rules = [
          // for pattern insertAdjacentHTML('beforeend', `html-string-template`);
          new Rule('<start>', () => tokTyp === 'variable' && tokStr === 'insertAdjacentHTML',
            'html-1'),
          new Rule('html-1', () => tokTyp === '(' && tokStr === '(',
            'html-2'),
          new Rule('html-2', () => tokTyp === 'string', // e.g., 'beforeend', OPEN: consider to check value
            'html-3'),
          new Rule('html-3', () => tokTyp === ',' && tokStr === ',',
            'html-4'),
          new Rule('html-4', () => tokTyp === 'quasi', // if it's a string template
            'html-in',
            () => prepareReparseStringTemplateInLocalMode(htmlMode, stream, state)),
          new Rule('html-in', () => stream.peek() === '`', // if it hits ending backtick for string template
            null, // then exit local html mode
            () => { tokStyle = exitLocalModeAndTokenEndingBacktick(stream, state); },
            () => { tokStyle = tokenInLocalMode(stream, state); }), // else stay in local mode

          // for pattern elt.innerHTML = `html-string`
          // variation: outerHTML, +=
          new Rule('<start>', () => jsTokStyle === 'property' && ['innerHTML', 'outerHTML'].includes(tokStr),
            'html-11'),
          new Rule('html-11', () => tokTyp === 'operator' && ['=', '+='].includes(tokStr),
            'html-12'),
          new Rule('html-12', () => tokTyp === 'quasi',
            'html-in',
            () => prepareReparseStringTemplateInLocalMode(htmlMode, stream, state)),

          // for pattern var someHTML = /* html */ `html-string`
          new Rule('<start>', () => jsTokStyle === 'comment' && (/^\/\*\s*html\s*\*\/$/i).test(tokStr),
            'html-21'),
          new Rule('html-21', () => tokTyp === 'quasi',
            'html-in',
            () => prepareReparseStringTemplateInLocalMode(htmlMode, stream, state)),
        ];

        matchRule(rules, stream, state);

        return tokStyle;
      }


      return {
        maybeToken,
      };
    }()); // htmlMatcher


    function jsToken(stream, state) {
      // dbg('jsToken -', `${stream.pos}: ${stream.string.substring(stream.pos).substring(0, 8)}`, state.lastType);

      // adapt the existing jsmode tokenizer with the wrapper state
      let tokStyle = null;
      if (!state.localMode) {
        // when in local html/css context, skip js parsing,
        // so as not to mess up js tokenizer's state.
        tokStyle = jsMode.token(stream, state.jsState);
        dbg('jsMode.token - ', state.maybeLocalContext, state.jsState.lastType, stream.current(), `[${tokStyle}]`);
        if (tokStyle === null) { // case the token is not relevant semantically, e.g., space or line break;
          // just return,  skip local mode match,
          // as such token is not reflected in stream/state so the local mode matcher
          // will end up seeing previous token.
          return null;
        }
      }

      // match to see if it needs to switch to local html mode, return local mode style if applicable
      let maybeLocalStyle = htmlMatcher.maybeToken(stream, state, tokStyle);
      if (maybeLocalStyle === STYLE_PASS) {
        maybeLocalStyle = cssMatcher.maybeToken(stream, state, tokStyle);
      }

      if (maybeLocalStyle !== STYLE_PASS) {
        tokStyle = maybeLocalStyle;
      }

      return tokStyle;
    }

    return {
      startState() {
        const state = CodeMirror.startState(jsMode);
        return {
          token: jsToken,
          localMode: null,
          localState: null,
          maybeLocalContext: null,
          jsState: state,
        };
      },

      copyState(state) {
        const local = (state.localState)
          ? CodeMirror.copyState(state.localMode, state.localState) : null;
        return {
          token: state.token,
          localMode: state.localMode,
          localState: local,
          maybeLocalContext: state.maybeLocalContext,
          jsState: CodeMirror.copyState(jsMode, state.jsState),
        };
      },

      token(stream, state) {
        // dbg(`${stream.pos}: ${stream.string.substring(stream.pos).substring(0, 15)}`, state.lastType);
        const tokSty = state.token(stream, state);

        dbg('   <--', `[${tokSty}]`, stream.current());
        return tokSty;
      },

      indent(state, textAfter, line) {
        dbg(`indent: "${textAfter}" "${line}"`);
        if (!state.localMode) {
          return jsMode.indent(state.jsState, textAfter, line);
        }
        if (state.localMode.indent) {
          return state.localMode.indent(state.localState, textAfter, line);
        }
        return CodeMirror.Pass;
      },

      innerMode(state) {
        return { state: state.localState || state.jsState, mode: state.localMode || jsMode };
      },
    };
  }, 'javascript', 'xml', 'css');
}));
