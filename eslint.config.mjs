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

  // .claude/rules/analyzer-pure.md had no mechanism: file or network I/O in the
  // analyzer passed lint, typecheck and tests alike.
  {
    files: ['src/analyzer/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'fs/*', 'http', 'https', 'net', 'child_process'],
              message: 'src/analyzer/ is pure: no file system or network I/O.'
            }
          ]
        }
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'src/analyzer/ is pure: no network I/O.' },
        { name: 'process', message: 'src/analyzer/ is pure: take inputs as arguments.' }
      ]
    }
  }
]
