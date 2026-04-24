import { useParams } from '@decky/ui'
import { Component, ReactElement, ReactNode, useEffect } from 'react'

import useThemeMusic from '../../hooks/useThemeMusic'
import { useSettings } from '../../hooks/useSettings'
import { getCache } from '../../cache/musicCache'
import useAudioPlayer from '../../hooks/useAudioPlayer'

class ThemePlayerErrorBoundary extends Component<
  { children?: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.error('ThemePlayer error:', error)
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

function ThemePlayerInner(): ReactElement {
  const { settings, isLoading: settingsIsLoading } = useSettings()
  const { appid } = useParams<{ appid: string }>()
  const { audio } = useThemeMusic(parseInt(appid))
  const audioPlayer = useAudioPlayer(audio.audioUrl)

  useEffect(() => {
    async function getData() {
      const cache = await getCache(parseInt(appid))
      if (typeof cache?.volume === 'number' && isFinite(cache.volume)) {
        audioPlayer.setVolume(cache.volume)
      } else {
        audioPlayer.setVolume(settings.volume)
      }
    }
    if (!settingsIsLoading) {
      getData()
    }
  }, [settingsIsLoading])

  useEffect(() => {
    if (audio?.audioUrl?.length && audioPlayer.isReady) {
      audioPlayer.play()
    }
  }, [audio?.audioUrl, audioPlayer.isReady])

  return <></>
}

export default function ThemePlayer(): ReactElement {
  return (
    <ThemePlayerErrorBoundary>
      <ThemePlayerInner />
    </ThemePlayerErrorBoundary>
  )
}
