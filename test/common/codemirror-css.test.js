import { rxColon } from '@/common/ui/codemirror-ovr/css';

// The previous implementation, kept as the reference for the equivalence checks.
// It backtracks exponentially on an unterminated comment or a run of whitespace.
const rxColonOld = /(?:\s+|\/\*(?:[^*]+|\*(?!\/))*(?:\*\/|$))*:/y;

const run = (rx, str, lastIndex = 0) => {
  rx.lastIndex = lastIndex;
  const res = rx.test(str);
  return [res, rx.lastIndex];
};

const median = arr => arr.slice().sort((a, b) => a - b)[arr.length >> 1];

/** Median time of `reps` runs, each running the regex `inner` times to rise above timer noise. */
const timeIt = (rx, str, reps = 5, inner = 20) => median(Array.from({ length: reps }, () => {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < inner; i += 1) run(rx, str);
  return Number(process.hrtime.bigint() - t0);
}));

describe('rxColon (variable definition lookahead)', () => {
  test.each([
    ':',
    ' :',
    '\n\t :',
    '/**/:',
    '/* c */:',
    '/* c */ :',
    ' /* a */ /* b */ :',
    '/* a **/:',
    '/* a * / b */:',
    '/***/:',
    '/* unterminated',
    '/* unterminated :',
    '/* a */ x:',
    '/ * :',
    '',
    '   ',
    'x',
    'x:',
    ';',
  ])('matches the same as before: %j', (str) => {
    expect(run(rxColon, str)).toEqual(run(rxColonOld, str));
    expect(run(rxColon, `--${str}`, 2)).toEqual(run(rxColonOld, `--${str}`, 2));
  });

  test('tells a definition from a usage', () => {
    expect(run(rxColon, '  :red')[0]).toBe(true);
    expect(run(rxColon, ' /* note */ :red')[0]).toBe(true);
    expect(run(rxColon, ')')[0]).toBe(false);
    expect(run(rxColon, ' , var(--b)')[0]).toBe(false);
  });

  test('matches the same as before on every string over a small alphabet', () => {
    const alphabet = [' ', '\n', '/', '*', ':', 'a'];
    let count = 0;
    const walk = (prefix, depth) => {
      for (const ch of alphabet) {
        const str = prefix + ch;
        count += 1;
        const expected = run(rxColonOld, str);
        if (run(rxColon, str)[0] !== expected[0] || run(rxColon, str)[1] !== expected[1]) {
          throw new Error(`rxColon differs from the previous regex on ${JSON.stringify(str)}`);
        }
        if (depth > 1) walk(str, depth - 1);
      }
    };
    walk('', 6);
    expect(count).toBe(55986);
  });

  // Time grows linearly with the input, not exponentially. The ratio of the 4N run to the
  // N run is about 4 for linear work, and astronomically large for the previous regex.
  describe.each([
    ['an unterminated comment', n => `/*${'a'.repeat(n)}`],
    ['whitespace then a non-colon', n => `${' '.repeat(n)}x`],
    ['many closed comments then a non-colon', n => `${'/**/ '.repeat(n)}x`],
    ['stars inside a comment', n => `/*${'* '.repeat(n)}`],
  ])('%s', (_name, make) => {
    test('scales linearly', () => {
      const N = 25000;
      const small = timeIt(rxColon, make(N));
      const large = timeIt(rxColon, make(4 * N));
      expect(run(rxColon, make(50000))[0]).toBe(false);
      expect(large / Math.max(small, 1)).toBeLessThan(8);
    });
  });
});
