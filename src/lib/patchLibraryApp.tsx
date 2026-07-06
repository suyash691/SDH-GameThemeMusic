import {
  afterPatch,
  findInReactTree,
  appDetailsClasses,
  createReactTreePatcher
} from '@decky/ui'
import { routerHook } from '@decky/api'
import { ReactElement } from 'react'
import ThemePlayer from '../components/themePlayer'
import {
  AudioLoaderCompatState,
  AudioLoaderCompatStateContextProvider
} from '../state/AudioLoaderCompatState'

function patchLibraryApp(AudioLoaderCompatState: AudioLoaderCompatState) {
  return routerHook.addPatch('/library/app/:appid', (tree) => {
    const routeProps = findInReactTree(tree, (x) => x?.renderFunc)
    if (routeProps) {
      const patchHandler = createReactTreePatcher(
        [
          (tree) =>
            findInReactTree(
              tree,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (x: any) => x?.props?.children?.props?.overview
            )?.props?.children
        ],
        (_: Array<Record<string, unknown>>, ret?: ReactElement) => {
          try {
            // Guard: appDetailsClasses can be undefined if findClassModule
            // fails to locate the module (e.g. Valve renames HeaderLoaded).
            const innerContainerClass = appDetailsClasses?.InnerContainer
            if (!innerContainerClass) {
              console.debug(
                'GameThemeMusic: appDetailsClasses.InnerContainer not found, skipping injection'
              )
              return ret
            }

            const container = findInReactTree(
              ret,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (x: any) =>
                Array.isArray(x?.props?.children) &&
                x?.props?.className?.includes(innerContainerClass)
            )
            if (typeof container !== 'object') {
              console.debug(
                'GameThemeMusic: InnerContainer element not found in app-details tree'
              )
              return ret
            }

            container.props.children.push(
              <AudioLoaderCompatStateContextProvider
                AudioLoaderCompatStateClass={AudioLoaderCompatState}
              >
                <ThemePlayer />
              </AudioLoaderCompatStateContextProvider>
            )

            return ret
          } catch (e) {
            console.debug('GameThemeMusic: patchLibraryApp handler failed', e)
            return ret
          }
        }
      )

      afterPatch(routeProps, 'renderFunc', patchHandler)
    }

    return tree
  })
}

export default patchLibraryApp
