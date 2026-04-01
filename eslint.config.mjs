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
  }
]
