import { callable } from '@decky/api'
import {
  YouTubeVideo,
  YouTubeInitialData,
  Audio,
  YouTubeVideoPreview
} from '../../types/YouTube'
import { Settings, defaultSettings } from '../hooks/useSettings'

// Backend callables
const getSetting = callable<[string, Settings], Settings>('get_setting')
const searchYt = callable<[string], void>('search_yt')
const nextYtResult = callable<[], YouTubeVideoPreview | null>('next_yt_result')
const singleYtUrl = callable<[string], string | null>('single_yt_url')
const downloadYtAudio = callable<[string], void>('download_yt_audio')
const downloadUrl = callable<[string, string], void>('download_url')
const searchKhinsider = callable<[string], KHInsiderResult[]>(
  'search_khinsider'
)
const getKhinsiderTrackUrl = callable<[string], string | null>(
  'get_khinsider_track_url'
)

export type KHInsiderResult = {
  name: string
  url: string
  trackCount: number
}

abstract class AudioResolver {
  abstract getYouTubeSearchResults(
    searchTerm: string
  ): AsyncIterable<YouTubeVideoPreview>
  abstract getAudioUrlFromVideo(
    video: YouTubeVideo
  ): Promise<string | undefined>
  abstract downloadAudio(video: YouTubeVideo): Promise<boolean>

  async getAudio(
    appName: string
  ): Promise<{ videoId: string; audioUrl: string } | undefined> {
    const videos = this.getYouTubeSearchResults(
      `"${appName}" official soundtrack main theme`
    )
    for await (const video of videos) {
      const audioUrl = await this.getAudioUrlFromVideo(video)
      if (audioUrl?.length) {
        return { audioUrl, videoId: video.id }
      }
    }
    return undefined
  }
}

class InvidiousAudioResolver extends AudioResolver {
  async getEndpoint() {
    const savedSettings = await getSetting('settings', defaultSettings)
    return savedSettings.invidiousInstance
  }

  async *getYouTubeSearchResults(
    searchTerm: string
  ): AsyncIterable<YouTubeVideoPreview> {
    try {
      const encodedSearchTerm = `${encodeURIComponent(searchTerm)}`
      const endpoint = await this.getEndpoint()
      const res = await fetch(
        `${endpoint}/api/v1/search?type=video&page=1&q=${encodedSearchTerm}`
      )
      if (res.status === 200) {
        const results: YouTubeInitialData = await res.json()
        if (results.length) {
          yield* results
            .map((res) => ({
              title: res.title,
              id: res.videoId,
              thumbnail:
                res.videoThumbnails?.[0].url || 'https://i.ytimg.com/vi/0.jpg'
            }))
            .filter((res) => res.id.length)
        }
      }
    } catch (err) {
      console.debug(err)
    }
    return
  }

  async getAudioUrlFromVideo(
    video: YouTubeVideo
  ): Promise<string | undefined> {
    try {
      const endpoint = await this.getEndpoint()
      const res = await fetch(
        `${endpoint}/api/v1/videos/${encodeURIComponent(video.id)}?fields=adaptiveFormats`
      )
      if (res.status === 200) {
        const result = await res.json()
        const audioFormats: { adaptiveFormats: Audio[] } = result

        const audios = audioFormats.adaptiveFormats.filter((aud) =>
          aud.type?.includes('audio/webm')
        )
        const audio = audios.reduce((prev, current) => {
          return prev.audioSampleRate > current.audioSampleRate ? prev : current
        }, audios[0])

        return audio?.url
      }
    } catch (err) {
      console.debug(err)
    }
    return undefined
  }

  async downloadAudio(video: YouTubeVideo): Promise<boolean> {
    if (!video.url) {
      video.url = await this.getAudioUrlFromVideo(video)
      if (!video.url) {
        return false
      }
    }
    try {
      await downloadUrl(video.url, video.id)
      return true
    } catch (e) {
      console.error(e)
      return false
    }
  }
}

class YtDlpAudioResolver extends AudioResolver {
  async *getYouTubeSearchResults(
    searchTerm: string
  ): AsyncIterable<YouTubeVideoPreview> {
    try {
      await searchYt(searchTerm)
      let result = await nextYtResult()
      while (result) {
        yield result
        result = await nextYtResult()
      }
      return
    } catch (err) {
      console.error(err)
    }
    return
  }

  async getAudioUrlFromVideo(
    video: YouTubeVideo
  ): Promise<string | undefined> {
    if (video.url) {
      return video.url
    } else {
      const result = await singleYtUrl(video.id)
      return result || undefined
    }
  }

  async downloadAudio(video: YouTubeVideo): Promise<boolean> {
    try {
      await downloadYtAudio(video.id)
      return true
    } catch (e) {
      console.error(e)
      return false
    }
  }
}

// KHInsider resolver — searches the game soundtrack database for direct audio
export async function searchKHInsider(
  gameName: string
): Promise<KHInsiderResult[]> {
  try {
    return await searchKhinsider(gameName)
  } catch (e) {
    console.debug('KHInsider search failed:', e)
    return []
  }
}

export async function getKHInsiderTrackAudioUrl(
  albumUrl: string
): Promise<string | null> {
  try {
    return await getKhinsiderTrackUrl(albumUrl)
  } catch (e) {
    console.debug('KHInsider track fetch failed:', e)
    return null
  }
}

// Tiered auto-resolve: KHInsider first, then YouTube fallback
export async function autoResolveThemeMusic(
  appName: string,
  useYtDlp: boolean
): Promise<{ videoId: string; audioUrl: string } | undefined> {
  // Tier 1: Try KHInsider for a direct soundtrack match
  try {
    const results = await searchKHInsider(appName)
    if (results.length > 0) {
      const trackUrl = await getKHInsiderTrackAudioUrl(results[0].url)
      if (trackUrl) {
        return { videoId: `khi:${results[0].url}`, audioUrl: trackUrl }
      }
    }
  } catch (e) {
    console.debug('KHInsider auto-resolve failed, falling back to YouTube:', e)
  }

  // Tier 2: YouTube fallback
  const resolver = getResolver(useYtDlp)
  return resolver.getAudio(appName)
}

export function getResolver(useYtDlp: boolean): AudioResolver {
  if (useYtDlp) {
    return new YtDlpAudioResolver()
  } else {
    return new InvidiousAudioResolver()
  }
}

type InvidiousInstance = {
  flag: string
  region: string
  stats: {
    version: string
    software: {
      name: string
      version: string
      branch: string
    }
    openRegistrations: boolean
    usage: {
      users: {
        total: number
        activeHalfyear: number
        activeMonth: number
      }
    }
    metadata: {
      updatedAt: number
      lastChannelRefreshedAt: number
    }
    playback?: {
      totalRequests?: number
      successfulRequests?: number
      ratio?: number
    }
  } | null
  cors: boolean | null
  api: boolean | null
  type: string
  uri: string
  monitor: {
    token: string
    url: string
    alias: string
    last_status: number
    uptime: number
    down: boolean
    down_since: string | null
    up_since: string | null
    error: string | null
    period: number
    apdex_t: number
    string_match: string
    enabled: boolean
    published: boolean
    disabled_locations: string[]
    recipients: string[]
    last_check_at: string
    next_check_at: string
    created_at: string
    mute_until: string | null
    favicon_url: string
    custom_headers: Record<string, string>
    http_verb: string
    http_body: string
    ssl: {
      tested_at: string
      expires_at: string
      valid: boolean
      error: string | null
    }
  }
}

type InvidiousInstances = InvidiousInstance[]

export async function getInvidiousInstances(): Promise<
  { name: string; url: string }[]
> {
  try {
    const res = await fetch(
      'https://api.invidious.io/instances.json?&sort_by=users,health'
    )
    if (res.status === 200) {
      const instances: InvidiousInstances = (await res.json()).map(
        ([, instance]: [string, InvidiousInstance]) => instance
      )
      if (instances?.length) {
        return instances
          .filter((ins) => ins.type === 'https')
          .map((ins) => ({
            name: `${ins.flag} ${ins.monitor?.alias ?? ins.uri} | ${ins.stats?.usage.users.total} Users${
              ins.monitor?.uptime
                ? ` | Uptime: ${(ins.monitor.uptime / 100).toLocaleString(
                    'en',
                    {
                      style: 'percent'
                    }
                  )}`
                : ''
            }`,
            url: ins.uri
          }))
      }
    }
  } catch (err) {
    console.debug(err)
  }
  return []
}
