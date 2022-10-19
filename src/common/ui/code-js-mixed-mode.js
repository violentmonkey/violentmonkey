// Javascript mixed mode for CodeMirror
// Distributed under an MIT license

/* eslint func-names: "off" */
(function (mod) {
  if (typeof exports === 'object' && typeof module === 'object') { // CommonJS
    // eslint-disable-next-line global-require
    mod(require('codemirror/lib/codemirror'), require('codemirror/mode/xml/xml'), require('codemirror/mode/javascript/javascript'), require('codemirror/mode/css/css'), require('codemirror/mode/htmlmixed/htmlmixed'));
  // eslint-disable-next-line no-undef
  } else if (typeof define === 'function' && define.amd) { // AMD
    // eslint-disable-next-line no-undef
    define(['codemirror/lib/codemirror', 'codemirror/mode/xml/xml', 'codemirror/mode/javascript/javascript', 'codemirror/mode/css/css', 'codemirror/mode/htmlmixed/htmlmixed'], mod);
  } else { // Plain browser env
    // eslint-disable-next-line no-undef
    mod(CodeMirror);
  }
}((CodeMirror) => {
  function dbg(...args) {
    // eslint-disable-next-line no-console
    if (process.env.DEBUG) console.debug(...args);
  }

  // eslint-disable-next-line no-unused-vars
  CodeMirror.defineMode('javascript-mixed', (config, parserConfig) => {
    const jsMode = CodeMirror.getMode(config, { name: 'javascript' });

    const cssMode = CodeMirror.getMode(config, { name: 'css' });

    // use htmlmixed to support highlighting css in <style> (and to a lesser extent, js in <script>)
    const htmlmixedMode = CodeMirror.getMode(config, { name: 'htmlmixed' });

    // for tokenizing plain string, where matchClosing would cause too many false errors
    // as the html often spans across multiple strings.
    // for plain string , use basic html mode so that it can support non-matching close tags
    // mixed mode is unlikely to be very helpful for plain string anyway
    const htmlNoMatchClosingMode = CodeMirror.getMode(config, {
      name: 'xml',
      htmlMode: true,
      matchClosing: false,
    });

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

    const htmlStateHelper = (() => {
      // BEGIN init

      // tried to obtain the states when the tokenizer encounters an *incomplete* attr value
      // (that would end in second line)
      const dummyStream1a = new CodeMirror.StringStream('<p class="someClass', 2, {});
      const dummyState1a = htmlmixedMode.startState();
      while (dummyStream1a.current() !== '<p class="someClass') {
        htmlmixedMode.token(dummyStream1a, dummyState1a);
      }
      const attrContinuedStateDoubleQuote = dummyState1a.htmlState.state;
      const tokenForAttrContinuedDoubleQuote = dummyState1a.htmlState.tokenize;

      const dummyStream1b = new CodeMirror.StringStream('<p class=\'someClass', 2, {});
      const dummyState1b = htmlmixedMode.startState();
      while (dummyStream1b.current() !== '<p class=\'someClass') {
        htmlmixedMode.token(dummyStream1b, dummyState1b);
      }
      const attrContinuedStateSingleQuote = dummyState1b.htmlState.state;
      const tokenForAttrContinuedSingleQuote = dummyState1b.htmlState.tokenize;

      // record the state when the tokenizer encounters a *complete* attr value
      const dummyStream2 = new CodeMirror.StringStream('<p class="otherClass"', 2, {});
      const dummyState2 = htmlmixedMode.startState();
      while (dummyStream2.current() !== '<p class="otherClass"') {
        htmlmixedMode.token(dummyStream2, dummyState2);
      }
      const stateForAttrValue = dummyState2.htmlState.state; // single-quote attr val has the same state

      // END init

      /**
       * Force html tokenizer to treat next token as attribute value.
       *
       * Use case:
       * - html tokenizer encounters an js expression inside a complete attribute value
       * e.g., the value in class="foo ${someOtherClass()} bar"
       * - the html tokenizer would next expect another attribute or >
       * - but since we locally process the js expression, and then pass the remaining text
       *   back to html tokenizer, e.g.  bar", in the above example
       * - we want html tokenizer process it as part of attribute value
       * - this function forces the tokenizer to do so.
       *
       * The use case and the solution are both analogous to forceJsModeToQuasi(),
       * which handles tokenizing a single-line string template.
       */
      function forceHtmlModeToAttrContinuedState(stream, htmlState) {
        // Detect quote type by checking current token last char
        // (use last char instead of first char, because last char also works for multi-lined char value
        //  while fist char only works for the first line)
        switch (stream.string.charAt(stream.pos - 1)) {
        case '"':
          htmlState.state = attrContinuedStateDoubleQuote;
          htmlState.tokenize = tokenForAttrContinuedDoubleQuote;
          break;
        case "'":
          htmlState.state = attrContinuedStateSingleQuote;
          htmlState.tokenize = tokenForAttrContinuedSingleQuote;
          break;
        default:
        // case it's part of a multi-lined attr value, and is not the last line yet
        // (i.e., no quote at the end)
        // nothing needs to be done as it's already in the proper state.
        }
        // OPEN: the logic breaks down if the last character of the line happens to be a quote
        // , but not the ending quote.
        // E.g., the single quote in the following example is just part of the value
        //  <p  title="foo bar
        //  something '
        //  def">
        //
        // To properly handle it, we need to know the quote type for the current attribute value.
        // However, the quote type is not exposed by the underlying html tokenizer.
      }

      return {
        forceHtmlModeToAttrContinuedState,
        stateForAttrValue,
      };
    })();

    // Helpers to access a stream's current token, without creating
    // the string with stream.current() call.

    function tokenLength(stream) {
      // usage: avoid string creation in call stream.current().length
      return stream.pos - stream.start;
    }

    function tokenLastChar(stream) {
      return stream.string.charAt(stream.pos - 1) || undefined;
    }

    function tokenIsCharEscaped(stream, charPos) {
      // assume charPos is within current token,
      // i.e., stream.start <= charPos < stream.pos

      // consider cases, for the 5 below:
      //  0123\56  : escaped
      //  012\\56  : not escaped
      //  01\\\56  : escaped
      let isEscaped = false;
      for (let i = charPos - 1; i >= stream.start; i -= 1) {
        if (stream.string.charAt(i) === '\\') {
          isEscaped = !isEscaped;
        } else {
          break;
        }
      }
      return isEscaped;
    }

    /**
     * Return the index of searchValue within the current token, i.e., stream.current(),
     * excluding those prefixed with escape. E.g., if searchValue is "${", it will ignore
     * those string with the pattern of "\${", as the dollar sign is escaped.
     *
     * The returned index is relative to the token, rather than the entire stream.
     */
    function tokenIndexOfUnescaped(stream, searchValue) {
      // comparing to the alternative of stream.current().match(searchValueRegex),
      // this implementation avoids a substring creation and regex match
      const searchEndIdxExclusive = stream.pos;
      const tokenStartIdx = stream.start;
      let searchStartIdx = stream.start;

      while (searchStartIdx < searchEndIdxExclusive) {
        const candidate = stream.string.indexOf(searchValue, searchStartIdx);
        if (candidate < 0 || candidate >= searchEndIdxExclusive) {
          return -1;
        }
        // ensure it's not an escaped one
        if (candidate === tokenStartIdx // candidate is the start of the token, it is not escaped
            || !tokenIsCharEscaped(stream, candidate)) {
          // case find a match
          return candidate - tokenStartIdx;
        }
        // else case an escaped ${, continue to search
        searchStartIdx = candidate + searchValue.length;
      }
      return -1; // reach beyond token boundary
    }


    // Helpers to token string template in local mode

    function prepReparseStringTemplateInLocalMode(modeToUse, stream, state,
      hasBeginBacktick = true) {
      dbg(`Entering local ${modeToUse.name} mode...`);
      if (hasBeginBacktick) {
        // spit out beginning backtick as a token, and leave the rest of the text for local mode parsing
        stream.backUp(tokenLength(stream) - 1);
      } else {
        stream.backUp(tokenLength(stream));
      }

      // workaround needed for 1-line string template,
      // to ensure the ending backtick is parsed correctly.
      forceJsModeToQuasi(stream, state.jsState);

      // switch to local mode for subsequent text
      state.localMode = modeToUse;
      state.localState = CodeMirror.startState(state.localMode);
      state.inJsExprInStringTemplate = false;
      state.jsExprDepthInStringTemplate = 0;
    }

    function isEndBacktick(stream, state) {
      // check it hits ending backtick for string template,
      // ignoring the backticks that appear inside a JS expression.
      return !state.inJsExprInStringTemplate && stream.peek() === '`'
        && tokenLastChar(stream) !== '\\'; // ensure it is not an escaped backtick (doesn't count)
    }

    function exitLocalModeWithEndBacktick(stream, state) {
      dbg('Exiting local html/css mode...');
      // parse the ending JS string template backtick in js mode
      return jsMode.token(stream, state.jsState);
    }

    // Local mode-specific helpers to handle js expression in string template
    function curModeNameOfHtmlmixed(htmlmixedState) {
      return (!htmlmixedState.localMode) ? 'html' : htmlmixedState.localMode.name;
    }

    function curModeStateOfHtmlmixed(htmlmixedState) {
      return (!htmlmixedState.localMode) ? htmlmixedState.htmlState : htmlmixedState.localState;
    }

    Object.assign(htmlmixedMode, {
      /**
       * @return the position of '${' relative to the
       *         current token start position, i.e., stream.start; -1 otherwise.
       */
      indexOfJsExprStart(stream, state) {
        const modeName = curModeNameOfHtmlmixed(state.localState);
        switch (modeName) {
        case 'html':
          return tokenIndexOfUnescaped(stream, '${');
        case 'css':
          // css state is in the localState of htmlmixed
          return cssMode.indexOfJsExprStart(stream, curModeStateOfHtmlmixed(state.localState));
        case 'javascript':
          return -1; // let js mode handle ${ natively
        default:
          console.error('htmlmixedMode.indexOfJsExprStart() - unrecognized mode:', modeName);
        }
        return -1; // should never reach here
      },

      ensureProperLocalModeStatePostJsExpr(stream, state, style) {
        const modeName = curModeNameOfHtmlmixed(state.localState);
        const modeState = curModeStateOfHtmlmixed(state.localState);
        switch (modeName) {
        case 'html':
          if (modeState.state === htmlStateHelper.stateForAttrValue) {
            // case the js expression is an attribute value
            htmlStateHelper.forceHtmlModeToAttrContinuedState(stream, modeState);
          }
          break;
        case 'css':
          cssMode.ensureProperLocalModeStatePostJsExpr(stream, modeState, style);
          break;
        case 'javascript':
          break; // NO-OP
        default:
          console.error('htmlmixedMode.ensureProperLocalModeStatePostJsExpr() - unrecognized mode:', modeName);
        }
      },
    });

    Object.assign(cssMode, {
      // eslint-disable-next-line no-unused-vars
      indexOfJsExprStart(stream, state) {
        // In most cases, CSS tokenizer treats $ as a single token,
        // detect ${ for those cases
        if (stream.string.charAt(stream.start) === '$'
          && stream.string.charAt(stream.start + 1) === '{') {
          return 0;
        }
        // else look for ${ in the entire token.
        //   It only works for limited cases such as content property value,
        //   where CSS parser sees entire expression as string.
        return tokenIndexOfUnescaped(stream, '${');
      },

      ensureProperLocalModeStatePostJsExpr(stream, state, style) {
        // for case quoted string, remember the quote style, to be used in tokenizePostJsExpr
        if (style === 'string') {
          state.quoteCharSurroundJsExpr = stream.string.charAt(stream.start);
        }

        // Note: we want to force the text after the JS expression be tokenized as string (up till the end quote),
        // but CSS tokenizer does not expose it, not even in the indirect way,
        // (akin to what we do for HTML attributes, also quoted).
        // We compensate it by remembering the state and do our own in tokenizePostJsExpr()
      },

      tokenizePostJsExpr(stream, state) {
        const quoteInUse = state.quoteCharSurroundJsExpr;
        // first ensure, we let the css tokenizer continue the next time
        state.tokenizePostJsExpr = null;
        state.quoteCharSurroundJsExpr = null;

        if (!quoteInUse) {
          return null;
        }

        // Now handle quoted string cases such as content: "suffix${someExpr()}prefix";
        // to return prefix" as a string token in the above case
        // regex: non-greedy match up to the immediate next quote char, to avoid over match
        const matched = stream.match(new RegExp(`.*?${quoteInUse}`), true);
        dbg('  css mode post js expr string token - ', stream.current());
        // in the unexpected case (likely bugs) that we cannot find end quote, do nothing more
        // and let parent mode tokenizer to do its work
        return matched ? 'string' : null;
      },
    });

    function tokenJsExpressionInStringTemplate(stream, state) {
      const style = jsMode.token(stream, state.jsState);
      dbg('  local mode js expr token - ', stream.current(), `[${style}]`, state.jsState.lastType);
      // track ${ , } to determine when the expression is complete.
      if (style === 'string-2' && tokenIndexOfUnescaped(stream, '${') >= 0) { // case nested ${
        state.jsExprDepthInStringTemplate += 1;
        dbg('    jsExprDepthInStringTemplate inc:', state.jsExprDepthInStringTemplate);
      } else if (style === 'string-2' && state.jsState.lastType === '}') { // case expression-ending }
        // Note: must check BOTH style and lastType.
        // If there are blank spaces after },
        // when tokenizing the blank spaces, the style is null but the lastType remains to be }
        // (the one with meaningful token)

        // once it reaches back to 0, the logic would let the parent local mode handle the next token
        state.jsExprDepthInStringTemplate -= 1;
        dbg('    jsExprDepthInStringTemplate dec:', state.jsExprDepthInStringTemplate);
        if (state.jsExprDepthInStringTemplate <= 0) {
          state.inJsExprInStringTemplate = false;
          if (state.localMode.tokenizePostJsExpr) {
            // unless the mode also explicitly specify a tokenizer.
            state.tokenizePostJsExpr = state.localMode.tokenizePostJsExpr;
          }
        }
      }
      return style;
    }

    // For use of tokenInLocalModeStringTemplate,
    // to handle cases that the token contains string template ending backtick, i.e.,
    // bleeding over the string template
    function excludeEndBacktickFromToken(stream, style) {
      if (style === 'string-2') {
        // the token is meant to be a string template, e.g., string template within <script> tag
        // so do nothing
        return;
      }
      const backtickPos = tokenIndexOfUnescaped(stream, '`');
      if (backtickPos < 0) {
        return;
      }
      dbg('  local mode token contains a backtick, exclude text starting with it:', stream.current());
      stream.backUp(tokenLength(stream) - backtickPos);
    }

    function tokenInLocalModeStringTemplate(stream, state) {
      if (state.inJsExprInStringTemplate) {
        return tokenJsExpressionInStringTemplate(stream, state);
      }
      if (state.tokenizePostJsExpr) {
        return state.tokenizePostJsExpr(stream, state);
      }
      // else normal local mode tokenization
      const style = state.localMode.token(stream, state.localState);
      dbg('  local mode token - ', stream.current(), `[${style}]`);
      excludeEndBacktickFromToken(stream, style);
      const jsExprStart = state.localMode.indexOfJsExprStart(stream, state);
      if (jsExprStart < 0) {
        return style;
      }
      // case there is an js expression
      state.localMode.ensureProperLocalModeStatePostJsExpr(stream, state, style);
      // backup current token to exclude js expression, so that the next token starts with ${
      // MUST happen after ensureProperLocalModeStatePostJsExpr() call, as the ensure call
      // might need to access the token before js expression exclusion
      stream.backUp(tokenLength(stream) - jsExprStart);
      dbg('    js expression seen. adjusted local mode token  - ', stream.current(), `[${style}]`);
      state.inJsExprInStringTemplate = true;
      // next time the tokenizer will see ${... , the js parser, currently in string template/quais mode
      // would recognize it as an js expression and tokenize as such.
      // Note: cannot increment state.jsExprDepthInStringTemplate yet,
      // as the ${ to be handled by js tokenizer the next time
      return style;
    }


    // Helpers to token plain string (single/double-quoted) in local mode

    function prepReparsePlainStringInLocalMode(modeToUse, stream, state) {
      dbg(`Entering local ${modeToUse.name} mode... (plain string)`);
      // dbg(`    ${stream.start}-${stream.pos}:\t${stream.current()}`);
      const oldPos = stream.pos;
      // spit out beginning beginning quote as a token, and leave the rest of the text for local mode parsing
      stream.backUp(tokenLength(stream) - 1);

      // switch to local mode for subsequent text
      state.localMode = modeToUse;
      state.localState = CodeMirror.startState(state.localMode);
      // use end quote position to detect the end of the local html mode
      state.localState.localHtmlPlainStringEndPos = oldPos;
    }

    function exitLocalModeWithEndQuote(stream) {
      dbg('Exiting local html/css mode... (plain string)');
      // parse the ending JS string quote,
      // cannot use the jsMode to parse, as it will be treated as the beginning of a string.
      // so we simulate it here.
      stream.next(); // should be single or double quote;
      return 'string'; // the expected style
    }

    function tokenInLocalModePlainString(stream, state) {
      const style = state.localMode.token(stream, state.localState);
      if (stream.pos >= state.localState.localHtmlPlainStringEndPos) {
        // backUp text beyond the string, plus one to exclude end quote
        stream.backUp(stream.pos - state.localState.localHtmlPlainStringEndPos + 1);
      }
      dbg('  local mode token (plain string) - ', stream.current(), `[${style}]`);
      return style;
    }

    /* eslint max-classes-per-file: ["error", 2] */

    // Holds input parameters and return values for a rule execution
    class RunContext {
      init(stream, state, jsTokenStyle) {
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

        this._text = null;
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

      /**
       * @return the singleton instance. It's used only by matchRule. Use a singleton
       * to reduce object creation overhead
       */
      static get(stream, state, jsTokenStyle) {
        if (!RunContext._singleton) {
          RunContext._singleton = new RunContext();
        }
        RunContext._singleton.init(stream, state, jsTokenStyle);
        return RunContext._singleton;
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

    function matchRule(ruleMap, stream, state, jsTokenStyle) {
      const ctx = RunContext.get(stream, state, jsTokenStyle);
      const rules = ruleMap[state.maybeLocalContext || '<start>'];
      for (const r of rules) {
        // dbg('  rule:', r.curContext, r.match.toString());
        const matched = r.run(ctx);
        // dbg('  => rule output tokenStyle', ctx.style);
        if (matched) {
          break;
        }
      }
      return ctx.style;
    }

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
        match: ctx => isEndBacktick(ctx.stream, ctx.state),
        nextContext: null, // then exit local css mode
        caseMatched: ctx => { ctx.style = exitLocalModeWithEndBacktick(ctx.stream, ctx.state); },
        caseNotMatched: ctx => { // else stay in local mode
          ctx.style = tokenInLocalModeStringTemplate(ctx.stream, ctx.state);
        },
      }),

      // for pattern GM.addStyle(`css-string`);
      //   (i.e., Greasemonkey v4 style for GM_addStyle)
      new Rule({
        curContext: '<start>',
        match: ctx => ctx.type === 'variable' && ctx.text === 'GM',
        nextContext: 'css-31',
      }),
      new Rule({
        curContext: 'css-31',
        match: ctx => ctx.type === '.' && ctx.text === '.',
        nextContext: 'css-32',
      }),
      new Rule({
        curContext: 'css-32',
        match: ctx => ctx.type === 'variable' && ctx.text === 'addStyle',
        nextContext: 'css-33',
      }),
      new Rule({
        curContext: 'css-33',
        match: ctx => ctx.type === '(' && ctx.text === '(',
        nextContext: 'css-34',
      }),
      new Rule({
        curContext: 'css-34',
        match: ctx => ctx.type === 'quasi', // if it's a string template
        nextContext: 'css-in',
        caseMatched: ctx => prepReparseStringTemplateInLocalMode(cssMode, ctx.stream, ctx.state),
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


    const [RE_HTML_BASE, RE_HTML_PLAIN_STRING, RE_HTML_STRING_TEMPLATE] = (() => {
      const reHtmlBaseStr = /\s*<\/?[a-zA-Z0-9]+(\s|\/?>)/.source;
      return [
        new RegExp(reHtmlBaseStr),
        new RegExp(`^['"]${reHtmlBaseStr}`),
        new RegExp(`^[\`]${reHtmlBaseStr}`),
      ];
    })();

    // define the transition rules to enter local html mode;
    const htmlRules = [
      // inside a html string template
      new Rule({
        curContext: 'html-in',
        match: ctx => isEndBacktick(ctx.stream, ctx.state),
        nextContext: null, // then exit local html mode
        caseMatched: ctx => { ctx.style = exitLocalModeWithEndBacktick(ctx.stream, ctx.state); },
        caseNotMatched: ctx => { // else stay in local mode
          ctx.style = tokenInLocalModeStringTemplate(ctx.stream, ctx.state);
        },
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
        caseMatched: ctx => prepReparseStringTemplateInLocalMode(htmlmixedMode,
          ctx.stream, ctx.state),
      }),

      // for plain string (single or double quoted) that looks like html
      // e.g., '<div class="foo">hello', "</div>", '  <hr/>', etc.
      new Rule({
        curContext: '<start>',
        match: ctx => ctx.type === 'string' && RE_HTML_PLAIN_STRING.test(ctx.text),
        nextContext: 'html-str-in',
        caseMatched: ctx => prepReparsePlainStringInLocalMode(htmlNoMatchClosingMode,
          ctx.stream, ctx.state),
      }),
      new Rule({
        curContext: 'html-str-in',
        match: ctx => ctx.stream.start >= ctx.state.localState.localHtmlPlainStringEndPos - 1, // match the expected ending quote by position
        nextContext: null, // then exit local html mode
        caseMatched: ctx => { ctx.style = exitLocalModeWithEndQuote(ctx.stream, ctx.state); },
        caseNotMatched: ctx => { ctx.style = tokenInLocalModePlainString(ctx.stream, ctx.state); }, // else stay local mode
      }),

      // for HTML string template (without inline comment as a hint)
      new Rule({
        curContext: '<start>',
        match: ctx => ctx.type === 'quasi' && RE_HTML_STRING_TEMPLATE.test(ctx.text),
        nextContext: 'html-in',
        caseMatched: ctx => prepReparseStringTemplateInLocalMode(htmlmixedMode,
          ctx.stream, ctx.state),
      }),

      // for HTML string template (where first line is blank, html started in second line)
      new Rule({
        curContext: '<start>',
        match: ctx => ctx.type === 'quasi' && /^[`](\\)?\s*$/.test(ctx.text), // first line is blank
        nextContext: 'html-51',
      }),
      new Rule({
        curContext: 'html-51',
        match: ctx => ctx.type === 'quasi' && RE_HTML_BASE.test(ctx.text), // second line starts with a tag
        nextContext: 'html-in',
        caseMatched: ctx => prepReparseStringTemplateInLocalMode(htmlmixedMode,
          ctx.stream, ctx.state, false),
      }),

    ];

    // a map of all rules, keyed by curContext for quick look up during matching
    const allRuleMap = (() => {
      const res = {};
      for (const rules of [htmlRules, cssRules]) {
        for (const rule of rules) {
          const key = rule.curContext;
          res[key] = res[key] || [];
          res[key].push(rule);
        }
      }
      return res;
    })();


    function jsToken(stream, state) {
      // dbg('jsToken -', `${stream.pos}: ${stream.string.substring(stream.pos).substring(0, 8)}`, state.lastType);

      // adapt the existing jsMode tokenizer with the wrapper state
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
          // dbg('   <--', `[${tokenStyle}]`, stream.current());
          return null;
        }
      }

      // optimization: short-circuit to skip local mode match when the rules won't cover
      // Note: if the rules change (the <start> ones), the conditions here might need to be updated accordingly.
      if (state.maybeLocalContext == null
          && tokenStyle !== 'variable'
          && tokenStyle !== 'comment'
          && tokenStyle !== 'string'
          && tokenStyle !== 'string-2') {
        // dbg('   <--', `[${tokenStyle}]`, stream.current());
        return tokenStyle;
      }

      // match to see if it needs to switch to local html mode, return local mode style if applicable
      const maybeLocalStyle = matchRule(allRuleMap, stream, state, tokenStyle);

      if (maybeLocalStyle !== STYLE_PASS) {
        tokenStyle = maybeLocalStyle;
      }

      // dbg('   <--', `[${tokenStyle}]`, stream.current());
      return tokenStyle;
    }

    return {
      startState() {
        const state = CodeMirror.startState(jsMode);
        return {
          localMode: null,
          localState: null,
          maybeLocalContext: null,
          jsState: state,
          jsExprDepthInStringTemplate: 0,
          inJsExprInStringTemplate: false,
          tokenizePostJsExpr: null,
          quoteCharSurroundJsExpr: null,
        };
      },

      copyState(state) {
        const local = (state.localState)
          ? CodeMirror.copyState(state.localMode, state.localState) : null;
        return {
          localMode: state.localMode,
          localState: local,
          maybeLocalContext: state.maybeLocalContext,
          jsState: CodeMirror.copyState(jsMode, state.jsState),
          jsExprDepthInStringTemplate: state.jsExprDepthInStringTemplate,
          inJsExprInStringTemplate: state.inJsExprInStringTemplate,
          tokenizePostJsExpr: state.tokenizePostJsExpr,
          quoteCharSurroundJsExpr: state.quoteCharSurroundJsExpr,
        };
      },

      // token(stream, state)
      token: jsToken,

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
  }, 'javascript', 'xml', 'css', 'htmlmixed');
}));
