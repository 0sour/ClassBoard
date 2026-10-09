// ============================================================
// ClassBoard · ESLint 扁平配置（服务端，Node ESM）
// ============================================================
import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['node_modules/**', 'lib/data/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
]
