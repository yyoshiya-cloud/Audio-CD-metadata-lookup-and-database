// ESLint（flat config）。既存コードには違反が多いため、段階的に直せるよう、
// 多くのルールは warn にしている（CI では error のみで失敗する）。新規コードは warn も出さない方針。
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'dist-server', 'node_modules', 'public', 'bun.lock'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['server/**/*.ts', 'server.ts', 'scripts/**/*.ts', 'vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    rules: {
      // 共通ロガー（src/lib/logger.ts）を使う
      'no-console': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-function': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    // ロガー自身と検証スクリプトは console を使ってよい
    files: ['src/lib/logger.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  }
);
