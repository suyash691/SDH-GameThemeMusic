import { useEffect, useState } from 'react'

import { autoResolveThemeMusic, getResolver } from '../actions/audio'

import { getCache, updateCache } from '../cache/musicCache'
import { useSettings } from '../hooks/useSettings'

const useThemeMusic = (appId: number) => {
  const { settings, isLoading: settingsLoading } = useSettings()
  const [audio, setAudio] = useState<{ videoId: string; audioUrl: string }>({
    videoId: '',
    audioUrl: ''
  })
  const appDetails = appStore.GetAppOverviewByGameID(appId)
  const appName = appDetails?.display_name?.replace(/(™|®|©)/g, '')

  const ready = Boolean(appName?.length) && !settingsLoading

  useEffect(() => {
    if (!ready) return

    let ignore = false
    async function getData() {
      const cache = await getCache(appId)

      // User explicitly chose "No Music"
      if (cache?.videoId?.length == 0) {
        return setAudio({ videoId: '', audioUrl: '' })
      }

      // User has a cached override — try to resolve its audio URL
      if (cache?.videoId?.length) {
        // KHInsider tracks store the direct audio URL after khi: prefix
        if (cache.videoId.startsWith('khi:')) {
          const audioUrl = cache.videoId.slice(4)
          return setAudio({ videoId: cache.videoId, audioUrl })
        }
        // Try resolving the cached YouTube video ID
        try {
          const resolver = getResolver(settings.useYtDlp)
          const newAudio = await resolver.getAudioUrlFromVideo({
            id: cache.videoId
          })
          if (newAudio?.length) {
            return setAudio({ videoId: cache.videoId, audioUrl: newAudio })
          }
        } catch (e) {
          console.debug('Cached track resolution failed, will auto-resolve:', e)
        }
      }

      // Default muted — don't auto-play
      if (settings.defaultMuted && !cache?.videoId?.length) {
        return setAudio({ videoId: '', audioUrl: '' })
      }

      // Auto-resolve: Steam Store → KHInsider → YouTube
      if (ignore) return
      const newAudio = await autoResolveThemeMusic(
        appName as string,
        appId,
        settings.useYtDlp
      )
      if (ignore) return
      if (!newAudio?.audioUrl?.length) {
        return setAudio({ videoId: '', audioUrl: '' })
      }
      await updateCache(appId, newAudio)
      return setAudio(newAudio)
    }
    getData()
    return () => {
      ignore = true
    }
  }, [appId, ready])

  return {
    audio
  }
}

export default useThemeMusic
