declare module 'cliui' {
  interface Column {
    text: string
    width?: number
    align?: 'left' | 'right' | 'center'
    padding?: number[]
  }

  interface UI {
    div(...columns: (string | Column)[]): void
    toString(): string
  }

  interface Options {
    width?: number
    wrap?: boolean
  }

  function cliui(options?: Options): UI
  export default cliui
}
