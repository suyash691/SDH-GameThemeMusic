// React 19 types with jsx:"react" + jsxFactory mode needs explicit JSX namespace
declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: Record<string, unknown>
    }
  }
  // eslint-disable-next-line no-var
  var webpackChunksteamui: unknown[] | undefined
}

export {}
