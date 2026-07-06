// React 19 types with jsx:"react" + jsxFactory mode needs explicit JSX namespace
declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: Record<string, unknown>
    }
    // @decky/ui components (e.g. Focusable) declare `children` as required, but
    // with the classic JSX runtime (jsxFactory) TS does not credit nested JSX
    // children toward a required `children` prop, producing false "children is
    // missing" errors. Relaxing `children` to optional at the JSX-attributes
    // layer fixes every component uniformly without per-interface augments
    // (which would clash on modifiers — TS2687).
    type LibraryManagedAttributes<_C, P> = P extends { children: infer CH }
      ? Omit<P, 'children'> & { children?: CH }
      : P
  }
  // eslint-disable-next-line no-var
  var webpackChunksteamui: unknown[] | undefined
}

export {}
