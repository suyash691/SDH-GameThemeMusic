import type { ReactNode } from 'react'

declare module '@decky/ui' {
  interface FocusableProps {
    children?: ReactNode
  }
  interface MenuItemProps {
    key?: string | number | null
  }
}
