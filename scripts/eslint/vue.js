module.exports = {
  plugins: [
    'html',
  ],
  rules: {
    'import/extensions': ['error', 'always', {
      js: 'never',
      vue: 'never',
    }],
  },
};
