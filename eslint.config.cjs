'use strict';

module.exports = [
  { ignores: ['media/monitor.bundle.js', 'dist/**', 'protocol/**'] },
  {
    files: ['{src,media,test,scripts}/**/*.{js,cjs}'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs' },
    rules: {
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-self-assign': 'error',
      'no-unexpected-multiline': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
    },
  },
];
