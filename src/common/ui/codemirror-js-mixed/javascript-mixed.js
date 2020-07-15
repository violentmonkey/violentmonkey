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
  function dbg(...args) {
    // eslint-disable-next-line no-console
    if (process.env.DEBUG) console.debug(...args);
  }

  CodeMirror.defineMode('javascript-mixed', (config, parserConfig) => {
    const jsMode = CodeMirror.getMode(config, { name: 'javascript' });

    const STYLE_PASS = 'XXX-PASS'; // indicate the css/html matcher does not return  local mode style

    const forceJsModeToQuasi = (() => {
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
    })();


    function prepReparseStringTemplateInLocalMode(modeToUse, stream, state) {
      dbg(`Entering local ${modeToUse.name} mode...`);
      // spit out beginning backtick as a token, and leave the rest of the text for local mode parsing
      stream.backUp(stream.current().length - 1);

      // workaround needed for 1-line string template,
      // to ensure the ending backtick is parsed correctly.
      forceJsModeToQuasi(stream, state.jsState);

      // switch to local mode for subsequent text
      state.localMode = modeToUse;
      state.localState = CodeMirror.startState(state.localMode);
    }

    function exitLocalModeWithEndBacktick(stream, state) {
      dbg('Exiting local html/css mode...');
      // parse the ending JS string template backtick in js mode
      return jsMode.token(stream, state.jsState);
    }

    function tokenInLocalMode(stream, state) {
      const style = state.localMode.token(stream, state.localState);
      dbg('  local mode token - ', stream.current(), `[${style}]`);
      return style;
    }

    /* eslint max-classes-per-file: ["error", 2] */

    // Holds input parameters and return values for a rule execution
    class RunContext {
      constructor(stream, state, jsTokenStyle) {
        /**
         * @readonly
         */
        this.stream = stream;

        /**
         * @readonly
         */
        this.state = state;

        /**
         * The style of the current token determined by the outer javascript mode tokenizer.
         *
         * @readonly
         */
        this.jsTokenStyle = jsTokenStyle;

        /**
         * The output of a rule execution - the only writable property.
         * The style of the current token by the inner mode,
         * STYLE_PASS if the inner mode is not applicable.
         */
        this.style = STYLE_PASS;
      }

      /**
       * The type of the current token determined by the outer javascript mode tokenizer.
       */
      get type() { return this.state.jsState.lastType; }

      get text() {
        if (this._text == null) {
          this._text = this.stream.current();
        }
        return this._text;
      }
    }

    class Rule {
      constructor(props) {
        this.curContext = props.curContext;
        // lambda for match condition
        this.match = props.match;
        this.nextContext = props.nextContext;
        // optional, lambda for additional logic to run if matched
        this.caseMatched = props.caseMatched;
        // optional, lambda for additional logic to run if not matched
        this.caseNotMatched = props.caseNotMatched;
      }

      run(ctx) {
        const state = ctx.state;
        if (this.match(ctx)) {
          state.maybeLocalContext = this.nextContext;
          if (state.maybeLocalContext == null) {
            // local mode done, reset
            state.localMode = null;
            state.localState = null;
          }
          if (this.caseMatched) { this.caseMatched(ctx); }
          return true;
        } // case rule transition criteria not matched
        if (this.caseNotMatched) {
          this.caseNotMatched(ctx);
        } else { // default not matched logic: reset local mode matching
          state.maybeLocalContext = null;
        }
        return false;
      }
    }

    function matchRule(rules, stream, state, jsTokenStyle) {
      const ctx = new RunContext(stream, state, jsTokenStyle);
      for (const r of rules) {
        if (r.curContext === (state.maybeLocalContext || '<start>')) {
          // dbg('  rule:', r.curContext, r.match.toString());
          const matched = r.run(ctx);
          // dbg('  => rule output tokenStyle', ctx.style);
          if (matched) {
            break;
          }
        }
      }
      return ctx.style;
    }

    const cssMode = CodeMirror.getMode(config, { name: 'css' });

    // define the transition rules to enter local CSS mode;
    const cssRules = [
      // for pattern GM_addStyle(`css-string`);
      new Rule({
        curContext: '<start>',
        match: ctx => ctx.type === 'variable' && ctx.text === 'GM_addStyle',
        nextContext: 'css-1',
      }),
      new Rule({
        curContext: 'css-1',
        match: ctx => ctx.type === '(' && ctx.text === '(',
        nextContext: 'css-2',
      }),
      new Rule({
        curContext: 'css-2',
        match: ctx => ctx.type === 'quasi', // if it's a string template
        nextContext: 'css-in',
        caseMatched: ctx => prepReparseStringTemplateInLocalMode(cssMode, ctx.stream, ctx.state),
      }),
      new Rule({
        curContext: 'css-in',
        match: ctx => ctx.stream.peek() === '`', // if it hits ending backtick for string template
        nextContext: null, // then exit local css mode
        caseMatched: ctx => { ctx.style = exitLocalModeWithEndBacktick(ctx.stream, ctx.state); },
        caseNotMatched: ctx => { ctx.style = tokenInLocalMode(ctx.stream, ctx.state); }, // else stay in local mode
      }),

      // for pattern var someCSS = /* css */ `css-string`
      new Rule({
        curContext: '<start>',
        match: ctx => ctx.jsTokenStyle === 'comment' && /^\/\*\s*css\s*\*\/$/i.test(ctx.text),
        nextContext: 'css-21',
      }),
      new Rule({
        curContext: 'css-21',
        match: ctx => ctx.type === 'quasi',
        nextContext: 'css-in',
        caseMatched: ctx => prepReparseStringTemplateInLocalMode(cssMode, ctx.stream, ctx.state),
      }),
    ];

    function maybeCssToken(stream, state, jsTokenStyle) {
      return matchRule(cssRules, stream, state, jsTokenStyle);
    }


    const htmlMode = CodeMirror.getMode(config, {
      name: 'xml',
      htmlMode: true,
      multilineTagIndentFactor: parserConfig.multilineTagIndentFactor,
      multilineTagIndentPastTag: parserConfig.multilineTagIndentPastTag,
    });

    // define the transition rules to enter local html mode;
    const htmlRules = [
      // for pattern insertAdjacentHTML('beforeend', `html-string-template`);
      new Rule({
        curContext: '<start>',
        match: ctx => ctx.type === 'variable' && ctx.text === 'insertAdjacentHTML',
        nextContext: 'html-1',
      }),
      new Rule({
        curContext: 'html-1',
        match: ctx => ctx.type === '(' && ctx.text === '(',
        nextContext: 'html-2',
      }),
      new Rule({
        curContext: 'html-2',
        match: ctx => ctx.type === 'string', // e.g., 'beforeend'
        nextContext: 'html-3',
      }),
      new Rule({
        curContext: 'html-3',
        match: ctx => ctx.type === ',' && ctx.text === ',',
        nextContext: 'html-4',
      }),
      new Rule({
        curContext: 'html-4',
        match: ctx => ctx.type === 'quasi', // if it's a string template
        nextContext: 'html-in',
        caseMatched: ctx => prepReparseStringTemplateInLocalMode(htmlMode, ctx.stream, ctx.state),
      }),
      new Rule({
        curContext: 'html-in',
        match: ctx => ctx.stream.peek() === '`', // if it hits ending backtick for string template
        nextContext: null, // then exit local html mode
        caseMatched: ctx => { ctx.style = exitLocalModeWithEndBacktick(ctx.stream, ctx.state); },
        caseNotMatched: ctx => { ctx.style = tokenInLocalMode(ctx.stream, ctx.state); }, // else stay in local mode
      }),

      // for pattern elt.innerHTML = `html-string`
      // variation: outerHTML, +=
      new Rule({
        curContext: '<start>',
        match: ctx => ctx.jsTokenStyle === 'property' && ['innerHTML', 'outerHTML'].includes(ctx.text),
        nextContext: 'html-11',
      }),
      new Rule({
        curContext: 'html-11',
        match: ctx => ctx.type === 'operator' && ['=', '+='].includes(ctx.text),
        nextContext: 'html-12',
      }),
      new Rule({
        curContext: 'html-12',
        match: ctx => ctx.type === 'quasi',
        nextContext: 'html-in',
        caseMatched: ctx => prepReparseStringTemplateInLocalMode(htmlMode, ctx.stream, ctx.state),
      }),

      // for pattern var someHTML = /* html */ `html-string`
      new Rule({
        curContext: '<start>',
        match: ctx => ctx.jsTokenStyle === 'comment' && /^\/\*\s*html\s*\*\/$/i.test(ctx.text),
        nextContext: 'html-21',
      }),
      new Rule({
        curContext: 'html-21',
        match: ctx => ctx.type === 'quasi',
        nextContext: 'html-in',
        caseMatched: ctx => prepReparseStringTemplateInLocalMode(htmlMode, ctx.stream, ctx.state),
      }),
    ];

    function maybeHtmlToken(stream, state, jsTokenStyle) {
      return matchRule(htmlRules, stream, state, jsTokenStyle);
    }


    function jsToken(stream, state) {
      // dbg('jsToken -', `${stream.pos}: ${stream.string.substring(stream.pos).substring(0, 8)}`, state.lastType);

      // adapt the existing jsmode tokenizer with the wrapper state
      let tokenStyle = null;
      if (!state.localMode) {
        // when in local html/css context, skip js parsing,
        // so as not to mess up js tokenizer's state.
        tokenStyle = jsMode.token(stream, state.jsState);
        dbg('jsMode.token - ', state.maybeLocalContext, state.jsState.lastType, stream.current(), `[${tokenStyle}]`);
        if (tokenStyle === null) { // case the token is not relevant semantically, e.g., space or line break;
          // just return,  skip local mode match,
          // as such token is not reflected in stream/state so the local mode matcher
          // will end up seeing previous token.
          return null;
        }
      }

      // match to see if it needs to switch to local html mode, return local mode style if applicable
      let maybeLocalStyle = maybeHtmlToken(stream, state, tokenStyle);
      if (maybeLocalStyle === STYLE_PASS) {
        maybeLocalStyle = maybeCssToken(stream, state, tokenStyle);
      }

      if (maybeLocalStyle !== STYLE_PASS) {
        tokenStyle = maybeLocalStyle;
      }

      return tokenStyle;
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
        const tokenStyle = state.token(stream, state);

        dbg('   <--', `[${tokenStyle}]`, stream.current());
        return tokenStyle;
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
