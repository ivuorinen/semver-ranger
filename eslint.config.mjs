import ivuorinenConfig from '@ivuorinen/eslint-config'
import tseslint from 'typescript-eslint'

export default [
  ...ivuorinenConfig,
  ...tseslint.configs.recommended,

  {
    ignores: ['*.yml', 'dist/**']
  },

  {
    rules: {
      'max-len': ['warn', { code: 100 }]
    }
  },

  {
    files: ['src/cli.ts'],
    rules: {
      'no-console': 'off',
      'n/no-process-exit': 'off'
    }
  },

  {
    files: ['src/output/table.ts'],
    rules: {
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns': 'off'
    }
  }
]
