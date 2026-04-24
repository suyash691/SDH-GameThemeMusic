/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  afterPatch,
  fakeRenderComponent,
  findInReactTree,
  MenuItem,
  Navigation,
  Patch
} from '@decky/ui'
import useTranslations from '../hooks/useTranslations'

function ChangeMusicButton({ appId }: { key?: string; appId: number }) {
  const t = useTranslations()
  return (
    <MenuItem
      key="game-theme-music-change-music"
      onSelected={() => {
        Navigation.Navigate(`/gamethememusic/${appId}`)
      }}
    >
      {t('changeThemeMusic')}...
    </MenuItem>
  )
}

// Always add before "Properties..."
const spliceChangeMusic = (children: any[], appid: number) => {
  try {
    const propertiesMenuItemIdx = children.findIndex((item) =>
      findInReactTree(
        item,
        (x) =>
          typeof x?.onSelected === 'function' &&
          x.onSelected.toString().includes('AppProperties')
      )
    )
    children.splice(
      propertiesMenuItemIdx,
      0,
      <ChangeMusicButton key="game-theme-music-change-music" appId={appid} />
    )
  } catch (e) {
    console.debug('GameThemeMusic: Failed to splice context menu item', e)
  }
}

/**
 * Patches the game context menu.
 * @param LibraryContextMenu The game context menu.
 * @returns A patch to remove when the plugin dismounts, or null if patching failed.
 */
const contextMenuPatch = (LibraryContextMenu: any) => {
  if (!LibraryContextMenu?.prototype) {
    console.debug(
      'GameThemeMusic: LibraryContextMenu not found, skipping patch'
    )
    return null
  }

  const patches: {
    outer?: Patch
    inner?: Patch
    unpatch: () => void
  } = {
    unpatch: () => {
      return null
    }
  }

  try {
    patches.outer = afterPatch(
      LibraryContextMenu.prototype,
      'render',
      (_: Record<string, unknown>[], component: any) => {
        try {
          // React 19 changed fiber structure — search broadly for appid
          let appid: number | undefined =
            component._owner?.pendingProps?.overview?.appid ??
            component._owner?.memoizedProps?.overview?.appid ??
            component.props?.overview?.appid

          // Fallback: search children for appid
          if (!appid && component.props?.children) {
            const children = Array.isArray(component.props.children)
              ? component.props.children
              : [component.props.children]
            for (const child of children) {
              const found =
                child?._owner?.pendingProps?.overview?.appid ??
                child?._owner?.memoizedProps?.overview?.appid ??
                child?.props?.overview?.appid
              if (found) {
                appid = found
                break
              }
            }
          }

          if (!appid) {
            // Last resort: extract from current URL
            const match = window.location.href.match(/\/library\/app\/(\d+)/)
            if (match) appid = parseInt(match[1])
          }

          if (!appid) return component

          if (!patches.inner) {
            patches.inner = afterPatch(
              component.type.prototype,
              'shouldComponentUpdate',
              ([nextProps]: any, shouldUpdate: any) => {
                try {
                  const gtmIdx = nextProps.children.findIndex(
                    (x: any) => x?.key === 'game-theme-music-change-music'
                  )
                  if (gtmIdx != -1) nextProps.children.splice(gtmIdx, 1)
                } catch {
                  return shouldUpdate
                }

                if (shouldUpdate === true) {
                  let updatedAppid: number = appid
                  const parentOverview = nextProps.children.find(
                    (x: any) =>
                      (x?._owner?.pendingProps?.overview?.appid ||
                        x?._owner?.memoizedProps?.overview?.appid) &&
                      (x._owner.pendingProps?.overview?.appid ??
                        x._owner.memoizedProps?.overview?.appid) !== appid
                  )
                  if (parentOverview) {
                    updatedAppid =
                      parentOverview._owner.pendingProps?.overview?.appid ??
                      parentOverview._owner.memoizedProps?.overview?.appid
                  }
                  spliceChangeMusic(nextProps.children, updatedAppid)
                }

                return shouldUpdate
              }
            )
            // Also splice into the current render (first time)
            if (component.props?.children) {
              spliceChangeMusic(component.props.children, appid)
            }
          } else {
            spliceChangeMusic(component.props.children, appid)
          }
        } catch (e) {
          console.debug('GameThemeMusic: Context menu render patch failed', e)
        }

        return component
      }
    )
  } catch (e) {
    console.debug('GameThemeMusic: Failed to patch context menu', e)
    return null
  }

  patches.unpatch = () => {
    patches.outer?.unpatch()
    patches.inner?.unpatch()
  }
  return patches
}

/**
 * Game context menu component.
 * Uses direct webpack module search to avoid Symbol crashes in findModuleChild.
 */
function findLibraryContextMenu() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let webpackRequire: any
    window.webpackChunksteamui?.push([
      [Math.random()],
      {},
      (r: unknown) => {
        webpackRequire = r
      }
    ])
    if (!webpackRequire?.m) return undefined

    const factoryIds = Object.keys(webpackRequire.m)
    for (const id of factoryIds) {
      let mod: Record<string, unknown>
      try {
        mod = webpackRequire(id)
      } catch {
        continue
      }
      if (!mod || typeof mod !== 'object') continue

      for (const prop in mod) {
        const val = mod[prop]
        if (typeof val !== 'function') continue
        try {
          if (!val.toString().includes('().LibraryContextMenu')) continue
        } catch {
          continue
        }
        // Found the module — now find the sibling component
        return Object.values(mod).find((sibling) => {
          if (typeof sibling !== 'function') return false
          try {
            const s = sibling.toString()
            return (
              s.includes('navigator:') &&
              (s.includes('createElement') || s.includes('jsx'))
            )
          } catch {
            return false
          }
        })
      }
    }
    return undefined
  } catch (e) {
    console.debug('GameThemeMusic: Failed to find LibraryContextMenu', e)
    return undefined
  }
}

const libraryContextMenuComponent = findLibraryContextMenu()
export const LibraryContextMenu = libraryContextMenuComponent
  ? fakeRenderComponent(
      libraryContextMenuComponent as Parameters<typeof fakeRenderComponent>[0]
    ).type
  : null

export default contextMenuPatch
