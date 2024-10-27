import ivuorinenConfig from '@ivuorinen/eslint-config'

export default [
  ...ivuorinenConfig,

  // your modifications
  {
    rules: {
      // "no-unused-vars": "warn"
      'max-len': ['error', { code: 100 }]
    }
  }
]
