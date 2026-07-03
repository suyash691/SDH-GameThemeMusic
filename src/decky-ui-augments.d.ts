// NOTE: the `export {}` below is load-bearing. It marks this file as a module so
// that `declare module '@decky/ui'` is treated as an *augmentation* of the real
// package. Without a top-level import/export the file becomes a global script and
// the declaration would *shadow* @decky/ui entirely (breaking every named import).
export {}

// @decky/ui >=4.11 declares `FocusableProps.children` (required) itself, so the
// previous `children?: ReactNode` augment now conflicts (TS2687) and is dropped.
// Only the MenuItem `key` augment is still needed.
declare module '@decky/ui' {
  interface MenuItemProps {
    key?: string | number | null
  }
}
