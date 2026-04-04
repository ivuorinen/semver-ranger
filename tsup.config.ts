import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  dts: false,
  noExternal: [/.*/u],
  banner: {
    js: [
      "import { createRequire as __bundleRequire } from 'node:module';",
      'const require = __bundleRequire(import.meta.url);'
    ].join(' ')
  }
})
