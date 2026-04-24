import { useEffect, useMemo, useRef, useState } from 'react'
import { useAudioLoaderCompatState } from '../state/AudioLoaderCompatState'

const FADE_DURATION_MS = 1000
const FADE_STEPS = 40

const useAudioPlayer = (
  audioUrl: string | undefined
): {
  play: () => void
  pause: () => void
  stop: () => void
  setVolume: (volume: number) => void
  togglePlay: () => void
  isPlaying: boolean
  isReady: boolean
} => {
  const { setOnThemePage, onAppPage } = useAudioLoaderCompatState()
  const targetVolume = useRef(1)
  const fadeTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const audioPlayer: HTMLAudioElement = useMemo(() => {
    const audio = new Audio()
    audio.preload = 'auto'
    return audio
  }, [])

  const [isPlaying, setIsPlaying] = useState(false)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    if (!onAppPage) {
      setOnThemePage(true)
    }
  }, [onAppPage])

  audioPlayer.oncanplaythrough = () => {
    setIsReady(true)
    setOnThemePage(true)
  }

  useEffect(() => {
    if (audioUrl?.length) {
      audioPlayer.src = audioUrl
      audioPlayer.loop = true
    }
  }, [audioUrl])

  useEffect(() => {
    return () => {
      unload()
    }
  }, [])

  function clearFade() {
    if (fadeTimer.current) {
      clearInterval(fadeTimer.current)
      fadeTimer.current = null
    }
  }

  function fadeIn() {
    clearFade()
    audioPlayer.volume = 0
    audioPlayer.play()
    setIsPlaying(true)
    setOnThemePage(true)
    const step = targetVolume.current / FADE_STEPS
    const interval = FADE_DURATION_MS / FADE_STEPS
    fadeTimer.current = setInterval(() => {
      const next = Math.min(audioPlayer.volume + step, targetVolume.current)
      audioPlayer.volume = next
      if (next >= targetVolume.current) {
        clearFade()
      }
    }, interval)
  }

  function fadeOut(onComplete?: () => void) {
    clearFade()
    const startVol = audioPlayer.volume
    if (startVol <= 0) {
      onComplete?.()
      return
    }
    const step = startVol / FADE_STEPS
    const interval = FADE_DURATION_MS / FADE_STEPS
    fadeTimer.current = setInterval(() => {
      const next = Math.max(audioPlayer.volume - step, 0)
      audioPlayer.volume = next
      if (next <= 0) {
        clearFade()
        onComplete?.()
      }
    }, interval)
  }

  function play() {
    if (audioPlayer.readyState === HTMLMediaElement.HAVE_ENOUGH_DATA) {
      fadeIn()
    }
  }

  function pause() {
    if (!audioPlayer.paused && !audioPlayer.ended) {
      fadeOut(() => {
        audioPlayer.pause()
        setIsPlaying(false)
      })
    }
  }

  function stop() {
    if (!audioPlayer.paused || audioPlayer.currentTime > 0) {
      fadeOut(() => {
        audioPlayer.pause()
        audioPlayer.currentTime = 0
        setIsPlaying(false)
      })
    }
  }

  function togglePlay() {
    if (isPlaying) stop()
    else play()
  }

  function setVolume(newVolume: number) {
    targetVolume.current = newVolume
    if (!fadeTimer.current) {
      audioPlayer.volume = newVolume
    }
  }

  function unload() {
    clearFade()
    audioPlayer.pause()
    audioPlayer.currentTime = 0
    audioPlayer.src = ''
    setIsPlaying(false)
    setIsReady(false)
    setOnThemePage(false)
  }

  return {
    play,
    pause,
    stop,
    setVolume,
    togglePlay,
    isPlaying,
    isReady
  }
}

export default useAudioPlayer
