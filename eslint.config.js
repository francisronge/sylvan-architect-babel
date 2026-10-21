import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

// Lint enforces React's hook rules only, in the TypeScript sources where hooks
// live. Types are checked by `npm run typecheck`.
export default [
  {
    ignores: ['node_modules/', 'dist/', 'test/', 'bench-baseline/', '.artifacts/', '**/*.{js,cjs,mjs}']
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error'
    }
  }
];
