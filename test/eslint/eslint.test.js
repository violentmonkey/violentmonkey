const { ESLint } = require('eslint');
const { restrictedSyntax } = require('@/../scripts/webpack-util');

test('eslint no-restricted-syntax', async () => {
  const linter = new ESLint();
  const code = restrictedSyntax.map(r => r.code + ';').join('');
  const expected = restrictedSyntax.map(r => (delete r.code, r.message));
  for (const path of ['', '/content', '/web']) {
    const filePath = require.resolve(`../../src/injected${path}/index.js`);
    const res = await linter.lintText(code, { filePath });
    const found = res[0].messages;
    const unexpected = found.filter(m => !expected.includes(m.message));
    const missed = expected.filter(msg => !found.some(f => msg === f.message));
    expect(unexpected).toEqual([]);
    expect(missed).toEqual([]);
  }
});
