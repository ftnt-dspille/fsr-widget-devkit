const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '**/*.d.ts',
      'widgets-src/**',
      'examples/**',
      'dist/**',
      '**/*.js', // Ignore all JS files; only lint TS
    ],
  },
  {
    // TypeScript files in the harness core
    files: [
      'server.ts',
      'harness.module.ts',
      'packager.ts',
      'lib/**/*.ts',
      'scripts/**/*.ts',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        project: 'tsconfig.json',
      },
      globals: {
        // Node.js globals
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
