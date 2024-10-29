import ivuorinenConfig from '@ivuorinen/eslint-config'

export default [
  ...ivuorinenConfig,

  {
    ignores: [
      'dist/*'
    ],
    rules: {
      // "no-unused-vars": "warn"
      'max-len': ['warn', { code: 100 }]
    }
  }
]
