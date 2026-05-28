const { RuleTester } = require('eslint');
const { builtinRules } = require('eslint/use-at-your-own-risk');
const { restrictedSyntax } = require('@/../scripts/webpack-util');

const ID = 'no-restricted-syntax';
const rule = builtinRules.get(ID);
const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2021 },
});
for (const opt of restrictedSyntax) {
  let res;
  try {
    ruleTester.run(ID, rule, {
      valid: [{
        code: '123',
      }],
      invalid: [{
        code: opt.code,
        errors: [opt.message],
        options: [opt],
      }],
    });
  } catch (err) {
    res = err.message;
  }
  expect(res).toBeFalsy();
}
