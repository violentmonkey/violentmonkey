// Javascript mixed mode for CodeMirror
// Distributed under an MIT license
// Mod of the inactive https://github.com/orionlee/codemirror-js-mixed

import CodeMirror from 'codemirror';
import 'codemirror/mode/xml/xml';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/mode/css/css';
import 'codemirror/mode/htmlmixed/htmlmixed';

CodeMirror.defineMode('javascript-mixed', (config) => {
  const STYLE_PASS = 'XXX-PASS';
  const IS_END_BACKTICK_RE = /(^|[^\\])`/y;
  const NEXT_QUOTE_RE = {
    "'": /.*?'/,
    '"': /.*?"/,
    '`': /.*?`/,
  };
  // Using # to prevent inlining in Terser
  const kEnsureProperLocalModeStatePostJsExpr = '#ensureProperLocalModeStatePostJsExpr';
  const kInJsExprInStringTemplate = '#inJsExprInStringTemplate';
  const kIndexOfJsExprStart = '#indexOfJsExprStart';
  const kJsExprDepthInStringTemplate = '#jsExprDepthInStringTemplate';
  const kJsState = '#jsState';
  const kLocalHtmlPlainStringEndPos = '#localHtmlPlainStringEndPos';
  const kLocalMode = '#localMode';
  const kLocalState = '#localState';
  const kMaybeLocalContext = '#maybeLocalContext';
  const kQuoteCharSurroundJsExpr = '#quoteCharSurroundJsExpr';
  const kTokenize = 'tokenize';
  const kTokenizePostJsExpr = '#tokenizePostJsExpr';
  const { StringStream } = CodeMirror;
  const cmCopyState = CodeMirror.copyState;
  const cmStartState = CodeMirror.startState;
  const cmPass = CodeMirror.Pass;

  const jsMode = CodeMirror.getMode(config, { name: 'javascript' });
  const jsTokenQuasi = (() => {
    // create a new stream of a non-ending (1st line of a multiline)
    // string template to obtain tokenQuasi tokenizer
    const dummyStream = new StringStream('`#dummy', 2, {});
    const dummyState = jsMode.startState();
    jsMode.token(dummyStream, dummyState);
    return dummyState[kTokenize];
  })();

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
  const [forceHtmlModeToAttrContinuedState, htmlStateForAttrValue] = (() => {
    const extractInnards = string => {
      const stream = new StringStream(string, 2, {});
      const state = htmlmixedMode.startState();
      const { htmlState } = state;
      while (stream.current() !== string) {
        htmlmixedMode.token(stream, state);
      }
      return [
        htmlState.state,
        htmlState[kTokenize],
      ];
    };
    // tried to obtain the states when the tokenizer encounters an *incomplete* attr value
    // (that would end in second line)
    const attrContinuedState = {
      '"': extractInnards('<p class="someClass'),
      "'": extractInnards('<p class=\'someClass'),
    };
    // record the state when the tokenizer encounters a *complete* attr value
    // single-quote attr val has the same state
    const stateForAttrValue = extractInnards('<p class="otherClass"')[0];
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
    function _forceHtmlModeToAttrContinuedState(stream, htmlState) {
      /*
       * Detect quote type by checking current token last char (use last char instead of
       * first char, because last char also works for multi-lined char value
       * while first char only works for the first line)
       * case it's part of a multi-lined attr value, and is not the last line yet
       * (i.e., no quote at the end) nothing needs to be done as it's already in the proper state.
       * OPEN: the logic breaks down if the last character of the line happens to be a quote
       * , but not the ending quote.
       * E.g., the single quote in the following example is just part of the value
       *  <p  title="foo bar
       *  something '
       *  def">
       * To properly handle it, we need to know the quote type for the current attribute value.
       * However, the quote type is not exposed by the underlying html tokenizer.
       */
      const cont = attrContinuedState[stream.string[stream.pos - 1]];
      if (cont) {
        htmlState.state = cont[0];
        htmlState[kTokenize] = cont[1];
      }
    }
    return [
      _forceHtmlModeToAttrContinuedState,
      stateForAttrValue,
    ];
  })();

  // Holds input parameters and return values for a rule execution
  const runCtx = new class RunContext {
    /**
     * The type of the current token determined by the outer javascript mode tokenizer.
     */
    get type() {
      return this.state[kJsState].lastType;
    }

    get text() {
      const value = this.stream.current();
      Object.defineProperty(this, 'text', { value, configurable: true });
      return value;
    }
  };

  // a map of all rules, keyed by id/type for quick lookup during matching
  const rulesById = {};
  const rulesByType = {};
  const rulesByLangCmt = [];

  function tokenIsCharEscaped(stream, charPos) {
    // assume charPos is within current token,
    // i.e., stream.start <= charPos < stream.pos
    // consider cases, for the 5 below:
    //  0123\56  : escaped
    //  012\\56  : not escaped
    //  01\\\56  : escaped
    let isEscaped = false;
    for (let i = charPos - 1; i >= stream.start; i -= 1) {
      if (stream.string[i] === '\\') {
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

  /** @this {Rule} */
  function prepReparseStringTemplateInLocalMode({stream, state}) {
    // spit out beginning backtick as a token, and leave the rest of the text for local mode parsing
    stream.backUp(stream.pos - stream.start - (this.hasBeginBacktick !== false));
    // workaround needed for 1-line string template,
    // to ensure the ending backtick is parsed correctly.
    state[kJsState][kTokenize] = jsTokenQuasi;
    // switch to local mode for subsequent text
    state[kLocalMode] = this.mode;
    state[kLocalState] = cmStartState(state[kLocalMode]);
    state[kInJsExprInStringTemplate] = false;
    state[kJsExprDepthInStringTemplate] = 0;
  }

  /** @this {Rule} */
  function isEndBacktick({stream, state}) {
    // check it hits ending backtick for string template,
    // ignoring the backticks that appear inside a JS expression.
    if (!state[kInJsExprInStringTemplate]) {
      IS_END_BACKTICK_RE.lastIndex = Math.max(0, stream.pos - 1);
      return IS_END_BACKTICK_RE.test(stream.string);
    }
  }

  /** @this {Rule} */
  function exitLocalModeWithEndBacktick(ctx) {
    // parse the ending JS string template backtick in js mode
    ctx.style = jsMode.token(ctx.stream, ctx.state[kJsState]);
  }

  function curModeStateOfHtmlmixed(htmlmixedState) {
    return htmlmixedState[kLocalMode]
      ? htmlmixedState[kLocalState]
      : htmlmixedState.htmlState;
  }

  Object.assign(htmlmixedMode, {
    /**
     * @return the position of '${' relative to the
     *         current token start position, i.e., stream.start; -1 otherwise.
     */
    [kIndexOfJsExprStart](stream, state) {
      const localState = state[kLocalState];
      const modeName = localState[kLocalMode]?.name || 'html';
      switch (modeName) {
      case 'html':
        return tokenIndexOfUnescaped(stream, '${');
      case 'css':
        // css state is in the localState of htmlmixed
        return cssMode[kIndexOfJsExprStart](stream, curModeStateOfHtmlmixed(localState));
      case 'javascript':
        return -1; // let js mode handle ${ natively
      default:
        console.error('Unrecognized mode:', modeName);
      }
      return -1; // should never reach here
    },

    [kEnsureProperLocalModeStatePostJsExpr](stream, state, style) {
      const localState = state[kLocalState];
      const modeName = localState[kLocalMode]?.name || 'html';
      const modeState = curModeStateOfHtmlmixed(localState);
      switch (modeName) {
      case 'html':
        if (modeState.state === htmlStateForAttrValue) {
          // case the js expression is an attribute value
          forceHtmlModeToAttrContinuedState(stream, modeState);
        }
        break;
      case 'css':
        cssMode[kEnsureProperLocalModeStatePostJsExpr](stream, modeState, style);
        break;
      case 'javascript':
        break; // NO-OP
      default:
        console.error('Unrecognized mode:', modeName);
      }
    },
  });

  Object.assign(cssMode, {
    [kIndexOfJsExprStart](stream) {
      // In most cases, CSS tokenizer treats $ as a single token,
      // detect ${ for those cases
      const { string, start } = stream;
      if (string[start] === '$' && string[start + 1] === '{') {
        return 0;
      }
      // else look for ${ in the entire token.
      //   It only works for limited cases such as content property value,
      //   where CSS parser sees entire expression as string.
      return tokenIndexOfUnescaped(stream, '${');
    },

    [kEnsureProperLocalModeStatePostJsExpr](stream, state, style) {
      // for case quoted string, remember the quote style, to be used in tokenizePostJsExpr
      if (style === 'string') {
        state[kQuoteCharSurroundJsExpr] = stream.string[stream.start];
      }
      // Note: we want to force the text after the JS expression be tokenized as string (up till the end quote),
      // but CSS tokenizer does not expose it, not even in the indirect way,
      // (akin to what we do for HTML attributes, also quoted).
      // We compensate it by remembering the state and do our own in tokenizePostJsExpr()
    },

    [kTokenizePostJsExpr](stream, state) {
      const quoteInUse = state[kQuoteCharSurroundJsExpr];
      // first ensure, we let the css tokenizer continue the next time
      state[kTokenizePostJsExpr] = null;
      state[kQuoteCharSurroundJsExpr] = null;
      if (!quoteInUse) {
        return null;
      }
      // Now handle quoted string cases such as content: "suffix${someExpr()}prefix";
      // to return prefix" as a string token in the above case
      // regex: non-greedy match up to the immediate next quote char, to avoid over match
      // in the unexpected case (likely bugs) that we cannot find end quote, do nothing more
      // and let parent mode tokenizer to do its work
      return stream.match(NEXT_QUOTE_RE[quoteInUse], true) ? 'string' : null;
    },
  });

  function tokenJsExpressionInStringTemplate(stream, state) {
    const style = jsMode.token(stream, state[kJsState]);
    // track ${ , } to determine when the expression is complete.
    if (style === 'string-2' && tokenIndexOfUnescaped(stream, '${') >= 0) {
      // case nested ${
      state[kJsExprDepthInStringTemplate] += 1;
    } else if (style === 'string-2' && state[kJsState].lastType === '}') {
      // case expression-ending }
      // Note: must check BOTH style and lastType.
      // If there are blank spaces after },
      // when tokenizing the blank spaces, the style is null but the lastType remains to be }
      // (the one with meaningful token)
      // once it reaches back to 0, the logic would let the parent local mode handle the next token
      if ((state[kJsExprDepthInStringTemplate] -= 1) <= 0) {
        state[kInJsExprInStringTemplate] = false;
        const jsExpr = state[kLocalMode][kTokenizePostJsExpr];
        if (jsExpr) {
          // unless the mode also explicitly specify a tokenizer.
          state[kTokenizePostJsExpr] = jsExpr;
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
    stream.backUp(stream.pos - stream.start - backtickPos);
  }

  /** @this {Rule} */
  function tokenInLocalModeStringTemplate(ctx) {
    const {stream, state} = ctx;
    if (state[kInJsExprInStringTemplate]) {
      ctx.style = tokenJsExpressionInStringTemplate(stream, state);
      return;
    }
    if (state[kTokenizePostJsExpr]) {
      ctx.style = state[kTokenizePostJsExpr](stream, state);
      return;
    }
    // else normal local mode tokenization
    const style = state[kLocalMode].token(stream, state[kLocalState]);
    excludeEndBacktickFromToken(stream, style);
    const jsExprStart = state[kLocalMode][kIndexOfJsExprStart](stream, state);
    if (jsExprStart < 0) {
      ctx.style = style;
      return;
    }
    // case there is an js expression
    state[kLocalMode][kEnsureProperLocalModeStatePostJsExpr](stream, state, style);
    // backup current token to exclude js expression, so that the next token starts with ${
    // MUST happen after ensureProperLocalModeStatePostJsExpr() call, as the ensure call
    // might need to access the token before js expression exclusion
    stream.backUp(stream.pos - stream.start - jsExprStart);
    state[kInJsExprInStringTemplate] = true;
    // next time the tokenizer will see ${... , the js parser, currently in string template/quasi mode
    // would recognize it as an js expression and tokenize as such.
    // Note: cannot increment state[kJsExprDepthInStringTemplate] yet,
    // as the ${ to be handled by js tokenizer the next time
    ctx.style = style;
  }


  /** @this {Rule} */
  function prepReparsePlainStringInLocalMode({stream, state}) {
    const oldPos = stream.pos;
    // spit out beginning beginning quote as a token, and leave the rest of the text for local mode parsing
    stream.backUp(stream.pos - stream.start - 1);
    // switch to local mode for subsequent text
    // and use end quote position to detect the end of the local html mode
    (state[kLocalState] = cmStartState(state[kLocalMode] = this.mode))
      [kLocalHtmlPlainStringEndPos] = oldPos;
  }

  /** @this {Rule} */
  function exitLocalModeWithEndQuote(ctx) {
    // parse the ending JS string quote,
    // cannot use the jsMode to parse, as it will be treated as the beginning of a string.
    // so we simulate it here.
    ctx.stream.next(); // should be single or double quote;
    ctx.style = 'string'; // the expected style
  }

  /** @this {Rule} */
  function tokenInLocalModePlainString(ctx) {
    const {stream, state} = ctx;
    const style = state[kLocalMode].token(stream, state[kLocalState]);
    const pos = state[kLocalState][kLocalHtmlPlainStringEndPos];
    if (stream.pos >= pos) {
      // backUp text beyond the string, plus one to exclude end quote
      stream.backUp(stream.pos - pos + 1);
    }
    ctx.style = style;
  }

  /** @typedef {function(RunContext):(?boolean)} RuleLambda */

  /**
   * @typedef Rule
   * @property {boolean} id - current context
   * @property {?string} next - next context or null
   * @property {?string} type - token type
   * @property {?string} style - token style, only 'comment' is handled for language hints
   * @property {Object} [mode] - CodeMirror mode
   * @property {boolean} [hasBeginBacktick=true]
   * @property {RuleLambda|string|RegExp} match - matching function/text/regexp,
   * in case of text/regexp the function is auto-created by makeRules()
   * @property {RuleLambda} [onMatch] - runs if matched
   * @property {RuleLambda} [onMiss] - runs if not matched
   */

  /**
   * @param {Object<string,Rule[]>} prefixedRuleGroups
   * @return {Rule[]}
   */
  function makeRules(prefixedRuleGroups) {
    Object.entries(prefixedRuleGroups).forEach(([seqPrefix, rules]) => {
      rules.forEach((rule, i) => {
        const {match, type, style} = rule;
        if (typeof match !== 'function') {
          if (typeof match === 'string') {
            rule.match = ctx => ctx.type === type && ctx.text === match;
          } else if (match instanceof RegExp) {
            rule.match = type
              ? ctx => ctx.type === type && match.test(ctx.text)
              : ctx => match.test(ctx.text);
          } else {
            rule.match = ctx => ctx.type === type;
          }
        }
        if (rule.id === undefined) {
          rule.id = i ? `${seqPrefix}-${i}` : '';
        }
        if (rule.next === undefined) {
          rule.next = `${seqPrefix}-${i + 1}`;
        }
        if (rule.id) {
          rulesById[rule.id] = [rule];
        }
        if (style === 'comment') {
          rulesByLangCmt.push(rule);
        }
        (rulesByType[type || ''] || (rulesByType[type || ''] = [])).push(rule);
      });
    });
  }

  function matchRule(stream, state, jsTokenStyle) {
    runCtx.jsTokenStyle = jsTokenStyle;
    runCtx.state = state;
    runCtx.stream = stream;
    runCtx.style = STYLE_PASS;
    delete runCtx.text;
    const id = state[kMaybeLocalContext] || '';
    const rules = id ? rulesById[id]
      : jsTokenStyle === 'comment' && runCtx.text[1] === '*' ? rulesByLangCmt
        : rulesByType[runCtx.type];
    if (rules) {
      for (const rule of rules) {
        if (rule.id === id) {
          if (rule.match(runCtx)) {
            state[kMaybeLocalContext] = rule.next;
            if (rule.next == null) {
              // local mode done, reset
              state[kLocalMode] = null;
              state[kLocalState] = null;
            }
            rule.onMatch?.(runCtx);
            break;
          } // case rule transition criteria not matched
          if (rule.onMiss) {
            rule.onMiss(runCtx);
          } else { // default not matched logic: reset local mode matching
            state[kMaybeLocalContext] = null;
          }
        }
      }
    }
    return runCtx.style;
  }

  // define the transition rules to enter local CSS mode;
  makeRules({
    // GM_addStyle(`css-string`);
    css1: [
      { match: 'GM_addStyle', type: 'variable' },
      { match: '(', type: '(' },
      {
        type: 'quasi', // if it's a string template
        next: 'css-in',
        mode: cssMode,
        onMatch: prepReparseStringTemplateInLocalMode,
      },
      {
        match: isEndBacktick,
        id: 'css-in',
        next: null, // then exit local css mode
        onMatch: exitLocalModeWithEndBacktick,
        onMiss: tokenInLocalModeStringTemplate, // else stay in local mode
      },
    ],
    // GM.addStyle(`css-string`);
    css2: [
      { match: 'GM', type: 'variable' },
      { match: '.', type: '.' },
      { match: 'addStyle', type: 'variable' },
      { match: '(', type: '(' },
      {
        type: 'quasi', // if it's a string template
        next: 'css-in',
        mode: cssMode,
        onMatch: prepReparseStringTemplateInLocalMode,
      },
    ],
    // var someCSS = /* css */ `css-string`
    // var someCSS = /* lang=css */ `css-string`
    // var someCSS = /* language=css */ `css-string`
    css3: [
      {
        style: 'comment',
        match: /^\/\*\s*(lang(uage)?\s*=\s*)?css\s*\*\/$/i
      },
      {
        type: 'quasi',
        next: 'css-in',
        mode: cssMode,
        onMatch: prepReparseStringTemplateInLocalMode,
      },
    ],
  });

  // define the transition rules to enter local html mode;
  makeRules({
    // inside a html string template
    html1: [
      {
        match: isEndBacktick,
        id: 'html-in',
        next: null, // then exit local html mode
        onMatch: exitLocalModeWithEndBacktick,
        onMiss: tokenInLocalModeStringTemplate, // else stay in local mode
      },
    ],
    // var someHTML = /* html */ `html-string`
    // var someHTML = /* lang=html */ `html-string`
    // var someHTML = /* language=html */ `html-string`
    html2: [
      {
        style: 'comment',
        match: /^\/\*\s*(lang(uage)?\s*=\s*)?html\s*\*\/$/i,
      },
      {
        type: 'quasi',
        next: 'html-in',
        mode: htmlmixedMode,
        onMatch: prepReparseStringTemplateInLocalMode,
      },
    ],
    // for plain string (single or double quoted) that looks like html
    // e.g., '<div class="foo">hello', "</div>", '  <hr/>', etc.
    html3: [
      {
        match: /^['"]\s*<\/?[a-z\d]+(\s|\/?>)/i,
        type: 'string',
        mode: htmlNoMatchClosingMode,
        onMatch: prepReparsePlainStringInLocalMode,
      },
      // match the expected ending quote by position
      {
        match: ctx => ctx.stream.start >= ctx.state[kLocalState][kLocalHtmlPlainStringEndPos] - 1,
        next: null, // then exit local html mode
        onMatch: exitLocalModeWithEndQuote,
        onMiss: tokenInLocalModePlainString, // else stay local mode
      },
    ],
    // for HTML string template (without inline comment as a hint)
    html4: [
      {
        match: /^`\s*<\/?[a-z\d]+(\s|\/?>)/i,
        type: 'quasi',
        next: 'html-in',
        mode: htmlmixedMode,
        onMatch: prepReparseStringTemplateInLocalMode,
      },
    ],
    // for HTML string template (where first line is blank, html started in second line)
    html5: [
      // first line is blank
      {
        match: /^`(\\)?\s*$/,
        type: 'quasi',
      },
      // second line starts with a tag
      {
        match: /\s*<\/?[a-z\d]+(\s|\/?>)/i,
        type: 'quasi',
        next: 'html-in',
        mode: htmlmixedMode,
        hasBeginBacktick: false,
        onMatch: prepReparseStringTemplateInLocalMode,
      },
    ],
  });

  function jsToken(stream, state) {
    // adapt the existing jsMode tokenizer with the wrapper state
    let tokenStyle = null;
    if (!state[kLocalMode]) {
      // when in local html/css context, skip js parsing,
      // so as not to mess up js tokenizer's state.
      tokenStyle = jsMode.token(stream, state[kJsState]);
      if (tokenStyle === null) {
        // case the token is not relevant semantically, e.g., space or line break;
        // just return, skip local mode match, as such token is not reflected in stream/state
        // so the local mode matcher will end up seeing previous token.
        return state[kJsState][kTokenize] === jsTokenQuasi ? 'string-2' : null;
      }
    }
    // optimization: short-circuit to skip local mode match when the rules won't cover
    // Note: if the rules change (the <start> ones), the conditions here might need to be updated accordingly.
    if (state[kMaybeLocalContext] == null
    && tokenStyle !== 'variable'
    && tokenStyle !== 'comment'
    && tokenStyle !== 'string'
    && tokenStyle !== 'string-2') {
      return tokenStyle;
    }
    // match to see if it needs to switch to local html mode, return local mode style if applicable
    const maybeLocalStyle = matchRule(stream, state, tokenStyle);
    if (maybeLocalStyle !== STYLE_PASS) {
      return maybeLocalStyle;
    }
    // Differentiate regexps and templates, TODO: remove when implemented in CodeMirror
    if (tokenStyle === 'string-2' && state[kJsState].lastType === 'regexp') {
      return 'string-2 regexp';
    }
    return tokenStyle;
  }

  return {
    startState: () => ({
      [kInJsExprInStringTemplate]: false,
      [kJsExprDepthInStringTemplate]: 0,
      [kJsState]: cmStartState(jsMode),
      [kLocalMode]: null,
      [kLocalState]: null,
      [kMaybeLocalContext]: null,
      [kQuoteCharSurroundJsExpr]: null,
      [kTokenizePostJsExpr]: null,
    }),

    copyState: state => ({
      [kInJsExprInStringTemplate]: state[kInJsExprInStringTemplate],
      [kJsExprDepthInStringTemplate]: state[kJsExprDepthInStringTemplate],
      [kJsState]: cmCopyState(jsMode, state[kJsState]),
      [kLocalMode]: state[kLocalMode],
      [kLocalState]: state[kLocalState]
        ? cmCopyState(state[kLocalMode], state[kLocalState])
        : null,
      [kMaybeLocalContext]: state[kMaybeLocalContext],
      [kQuoteCharSurroundJsExpr]: state[kQuoteCharSurroundJsExpr],
      [kTokenizePostJsExpr]: state[kTokenizePostJsExpr],
    }),

    // token(stream, state)
    token: jsToken,

    indent(state, textAfter, line) {
      const localMode = state[kLocalMode];
      if (!localMode) {
        return jsMode.indent(state[kJsState], textAfter, line);
      }
      if (localMode.indent) {
        return localMode.indent(state[kLocalState], textAfter, line);
      }
      return cmPass;
    },

    innerMode(state) {
      return { state: state[kLocalState] || state[kJsState], mode: state[kLocalMode] || jsMode };
    },
  };
}, 'javascript', 'xml', 'css', 'htmlmixed');
