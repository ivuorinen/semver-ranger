import config from '@ivuorinen/prettier-config'

const { overrides: baseOverrides = [], ...rest } = config

export default {
  ...rest,
  overrides: [
    ...baseOverrides,
    {
      files: '*.md',
      options: {
        proseWrap: 'always'
      }
    }
  ]
}
