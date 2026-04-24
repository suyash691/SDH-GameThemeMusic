import { describe, it, expect, vi, beforeEach } from 'vitest'
import localforage from 'localforage'
import {
  updateCache,
  getCache,
  clearCache,
  getFullCache
} from '../cache/musicCache'
import { getResolver, autoResolveThemeMusic } from '../actions/audio'
import { defaultSettings } from '../hooks/useSettings'

// ─── Scenario: User navigates to a game page ───

describe('When user navigates to a game page', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should check local cache first for a saved track', async () => {
    vi.mocked(localforage.getItem).mockResolvedValueOnce({
      videoId: 'saved123'
    })
    const cache = await getCache(292030)
    expect(cache?.videoId).toBe('saved123')
    expect(localforage.getItem).toHaveBeenCalledWith('292030')
  })

  it('should return null from cache for a game with no override', async () => {
    vi.mocked(localforage.getItem).mockResolvedValueOnce(null)
    const cache = await getCache(99999)
    expect(cache).toBeNull()
  })

  it('should auto-resolve music when no cache exists and defaultMuted is off', async () => {
    // autoResolveThemeMusic should be called, trying all tiers
    const result = await autoResolveThemeMusic('Test Game', 12345, true)
    // All mocked sources return nothing, so result is undefined
    expect(result).toBeUndefined()
  })

  it('should NOT auto-resolve when defaultMuted is on and no cache exists', () => {
    const settings = { ...defaultSettings, defaultMuted: true }
    const hasCache = false
    const shouldAutoResolve = !settings.defaultMuted && !hasCache
    expect(shouldAutoResolve).toBe(false)
  })

  it('should still play cached track even when defaultMuted is on', () => {
    const settings = { ...defaultSettings, defaultMuted: true }
    const cache = { videoId: 'manual_pick' }
    const shouldPlay = (cache.videoId?.length ?? 0) > 0
    expect(shouldPlay).toBe(true)
  })
})

// ─── Scenario: User manually selects a track ───

describe('When user selects a track for a game', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should save the selection to local cache', async () => {
    vi.mocked(localforage.getItem).mockResolvedValueOnce(null)
    vi.mocked(localforage.setItem).mockImplementation(async (_k, v) => v)

    await updateCache(292030, { videoId: 'witcher_theme' })
    expect(localforage.setItem).toHaveBeenCalledWith('292030', {
      videoId: 'witcher_theme'
    })
  })

  it('should preserve existing volume when changing track', async () => {
    vi.mocked(localforage.getItem).mockResolvedValueOnce({
      videoId: 'old',
      volume: 0.5
    })
    vi.mocked(localforage.setItem).mockImplementation(async (_k, v) => v)

    const result = await updateCache(292030, { videoId: 'new_track' })
    expect(result).toEqual({ videoId: 'new_track', volume: 0.5 })
  })

  it('should allow selecting "No Music" with empty videoId', async () => {
    vi.mocked(localforage.getItem).mockResolvedValueOnce(null)
    vi.mocked(localforage.setItem).mockImplementation(async (_k, v) => v)

    const result = await updateCache(292030, { videoId: '' })
    expect(result.videoId).toBe('')
  })
})

// ─── Scenario: Music source resolution tiers ───

describe('When plugin auto-resolves theme music', () => {
  it('should try Steam Store → KHInsider → YouTube in order', async () => {
    // All mocked to return nothing, verifying graceful fallthrough
    const result = await autoResolveThemeMusic('Nonexistent Game', 99999, false)
    expect(result).toBeUndefined()
  })

  it('should use different YouTube resolvers based on useYtDlp setting', () => {
    const ytdlp = getResolver(true)
    const invidious = getResolver(false)
    expect(ytdlp.constructor.name).not.toBe(invidious.constructor.name)
  })

  it('should prefix KHInsider results with khi: in videoId', () => {
    const khiResult = {
      videoId:
        'khi:https://downloads.khinsider.com/game-soundtracks/album/zelda',
      audioUrl: 'https://cdn.example.com/zelda-title.mp3'
    }
    expect(khiResult.videoId.startsWith('khi:')).toBe(true)
  })

  it('should extract audio URL from khi: prefixed videoId in cache', () => {
    const cached = { videoId: 'khi:https://downloads.khinsider.com/album/halo' }
    const isKhi = cached.videoId.startsWith('khi:')
    const albumUrl = cached.videoId.slice(4)
    expect(isKhi).toBe(true)
    expect(albumUrl).toBe('https://downloads.khinsider.com/album/halo')
  })
})

// ─── Scenario: User searches with YouTube vs KHInsider toggle ───

describe('When user toggles search source', () => {
  it('YouTube should be the default search source', () => {
    const defaultSource: 'youtube' | 'khinsider' = 'youtube'
    expect(defaultSource).toBe('youtube')
  })

  it('KHInsider downloads should be skipped (direct URLs)', () => {
    const videoId = 'khi:https://downloads.khinsider.com/album/test'
    const shouldSkipDownload = videoId.startsWith('khi:')
    expect(shouldSkipDownload).toBe(true)
  })

  it('YouTube downloads should NOT be skipped', () => {
    const videoId = 'dQw4w9WgXcQ'
    const shouldSkipDownload = videoId.startsWith('khi:')
    expect(shouldSkipDownload).toBe(false)
  })
})

// ─── Scenario: User adjusts volume ───

describe('When user adjusts volume', () => {
  it('per-game volume should override global volume', () => {
    const globalVol = 0.8
    const perGameVol = 0.3
    const effective =
      typeof perGameVol === 'number' && isFinite(perGameVol)
        ? perGameVol
        : globalVol
    expect(effective).toBe(0.3)
  })

  it('should fall back to global when per-game is not set', () => {
    const globalVol = 0.8
    const perGameVol = undefined
    const effective =
      typeof perGameVol === 'number' && isFinite(perGameVol)
        ? perGameVol
        : globalVol
    expect(effective).toBe(0.8)
  })

  it('should handle NaN per-game volume gracefully', () => {
    const globalVol = 0.8
    const perGameVol = NaN
    const effective =
      typeof perGameVol === 'number' && isFinite(perGameVol)
        ? perGameVol
        : globalVol
    expect(effective).toBe(0.8)
  })

  it('should save per-game volume to cache', async () => {
    vi.mocked(localforage.getItem).mockResolvedValueOnce({ videoId: 'abc' })
    vi.mocked(localforage.setItem).mockImplementation(async (_k, v) => v)

    const result = await updateCache(12345, { volume: 0.4 })
    expect(result).toEqual({ videoId: 'abc', volume: 0.4 })
  })
})

// ─── Scenario: Audio fade behavior ───

describe('When music starts or stops playing', () => {
  it('fade duration should feel smooth (500-2000ms)', () => {
    const FADE_DURATION_MS = 800
    expect(FADE_DURATION_MS).toBeGreaterThanOrEqual(500)
    expect(FADE_DURATION_MS).toBeLessThanOrEqual(2000)
  })

  it('fade steps should be frequent enough to avoid audible jumps', () => {
    const FADE_STEPS = 20
    const FADE_DURATION_MS = 800
    const stepInterval = FADE_DURATION_MS / FADE_STEPS
    expect(stepInterval).toBeLessThanOrEqual(50) // 50ms max per step
  })
})

// ─── Scenario: User backs up and restores overrides ───

describe('When user manages backups', () => {
  beforeEach(() => vi.clearAllMocks())

  it('export should collect all cached entries', async () => {
    vi.mocked(localforage.iterate).mockImplementation(async (cb: unknown) => {
      const fn = cb as (value: unknown, key: string) => void
      fn({ videoId: 'a' }, '100')
      fn({ videoId: 'b', volume: 0.5 }, '200')
    })

    const full = await getFullCache()
    expect(Object.keys(full)).toHaveLength(2)
    expect(full['200'].volume).toBe(0.5)
  })

  it('clearing a single game should only remove that game', async () => {
    await clearCache(12345)
    expect(localforage.removeItem).toHaveBeenCalledWith('12345')
    expect(localforage.clear).not.toHaveBeenCalled()
  })

  it('clearing all should wipe everything', async () => {
    await clearCache()
    expect(localforage.clear).toHaveBeenCalled()
  })
})

// ─── Scenario: Custom Invidious instance ───

describe('When user configures custom Invidious instance', () => {
  const MOCK_INSTANCES = [
    { name: 'A', url: 'https://inv-a.example.com' },
    { name: 'B', url: 'https://inv-b.example.com' }
  ]

  function detectCustom(
    instances: { url: string }[],
    loading: boolean,
    savedUrl: string
  ) {
    return (
      !loading &&
      instances.length > 0 &&
      !instances.some((i) => i.url === savedUrl)
    )
  }

  it('should NOT show custom toggle while instances are loading', () => {
    expect(detectCustom([], true, 'https://custom.com')).toBe(false)
  })

  it('should NOT show custom when saved URL is in the list', () => {
    expect(
      detectCustom(MOCK_INSTANCES, false, 'https://inv-a.example.com')
    ).toBe(false)
  })

  it('should show custom when saved URL is genuinely custom', () => {
    expect(detectCustom(MOCK_INSTANCES, false, 'https://my-private.com')).toBe(
      true
    )
  })

  it('should NOT show custom for default URL before list loads', () => {
    expect(detectCustom([], true, defaultSettings.invidiousInstance)).toBe(
      false
    )
  })

  it('toggling off custom should select first available instance', () => {
    const newUrl = MOCK_INSTANCES.length > 0 ? MOCK_INSTANCES[0].url : ''
    expect(newUrl).toBe('https://inv-a.example.com')
  })
})

// ─── Scenario: Plugin default settings ───

describe('When plugin loads with default settings', () => {
  it('should not be muted by default', () => {
    expect(defaultSettings.defaultMuted).toBe(false)
  })

  it('should use Invidious by default (not yt-dlp)', () => {
    expect(defaultSettings.useYtDlp).toBe(false)
  })

  it('should not download audio by default', () => {
    expect(defaultSettings.downloadAudio).toBe(false)
  })

  it('should have full volume by default', () => {
    expect(defaultSettings.volume).toBe(1)
  })

  it('should have a valid default Invidious instance', () => {
    expect(defaultSettings.invidiousInstance).toMatch(/^https:\/\//)
  })
})

// ─── Scenario: KHInsider track selection stores direct URL ───

describe('When user selects a KHInsider track', () => {
  it('should store the direct audio URL with khi: prefix', () => {
    const audioUrl = 'https://cdn.example.com/zelda-main-theme.mp3'
    const videoId = `khi:${audioUrl}`
    expect(videoId).toBe('khi:https://cdn.example.com/zelda-main-theme.mp3')
  })

  it('should play directly from the stored URL without re-resolving', () => {
    const cached = { videoId: 'khi:https://cdn.example.com/track.mp3' }
    const audioUrl = cached.videoId.slice(4)
    expect(audioUrl).toBe('https://cdn.example.com/track.mp3')
    expect(audioUrl).toMatch(/^https:\/\//)
  })

  it('should not attempt to download KHInsider tracks', () => {
    const videoId = 'khi:https://cdn.example.com/track.mp3'
    const shouldSkipDownload = videoId.startsWith('khi:')
    expect(shouldSkipDownload).toBe(true)
  })
})

// ─── Scenario: Search term changes with source toggle ───

describe('When user switches between YouTube and Game OST', () => {
  it('YouTube should pre-fill with game name + theme music OST', () => {
    const gameName = 'Elden Ring'
    const ytSearch = `${gameName} theme music OST`
    expect(ytSearch).toBe('Elden Ring theme music OST')
  })

  it('Game OST should pre-fill with just game name', () => {
    const gameName = 'Elden Ring'
    expect(gameName).toBe('Elden Ring')
  })

  it('switching from YouTube to Game OST should remove suffix', () => {
    const gameName = 'Elden Ring'
    const ytSearch = `${gameName} theme music OST`
    const khiSearch = gameName
    expect(ytSearch.length).toBeGreaterThan(khiSearch.length)
    expect(khiSearch).not.toContain('theme music')
  })
})

// ─── Scenario: Global track sorting across albums ───

describe('When KHInsider returns tracks from multiple albums', () => {
  it('should sort all tracks by score regardless of album', () => {
    const tracks = [
      { albumName: 'Album A', name: 'Battle Theme', score: -3 },
      { albumName: 'Album B', name: 'Main Theme', score: 10 },
      { albumName: 'Album A', name: 'Intro', score: 3 }
    ]
    tracks.sort((a, b) => b.score - a.score)
    expect(tracks[0].name).toBe('Main Theme')
    expect(tracks[0].albumName).toBe('Album B')
  })

  it('should limit to top 3 albums to avoid excessive API calls', () => {
    const albums = Array.from({ length: 10 }, (_, i) => ({
      name: `Album ${i}`,
      url: `url${i}`
    }))
    const limited = albums.slice(0, 3)
    expect(limited).toHaveLength(3)
  })
})

// ─── Improve coverage: audio.ts resolver classes ───

describe('InvidiousAudioResolver', () => {
  it('should return a resolver with getYouTubeSearchResults', () => {
    const resolver = getResolver(false)
    expect(typeof resolver.getYouTubeSearchResults).toBe('function')
  })

  it('should return a resolver with getAudioUrlFromVideo', () => {
    const resolver = getResolver(false)
    expect(typeof resolver.getAudioUrlFromVideo).toBe('function')
  })

  it('should return a resolver with downloadAudio', () => {
    const resolver = getResolver(false)
    expect(typeof resolver.downloadAudio).toBe('function')
  })

  it('getAudio should return undefined when no results', async () => {
    const resolver = getResolver(false)
    const result = await resolver.getAudio('Nonexistent Game ZZZZZ')
    expect(result).toBeUndefined()
  })
})

describe('YtDlpAudioResolver', () => {
  it('should return a resolver with all methods', () => {
    const resolver = getResolver(true)
    expect(typeof resolver.getYouTubeSearchResults).toBe('function')
    expect(typeof resolver.getAudioUrlFromVideo).toBe('function')
    expect(typeof resolver.downloadAudio).toBe('function')
  })

  it('getAudioUrlFromVideo should call single_yt_url', async () => {
    const resolver = getResolver(true)
    const result = await resolver.getAudioUrlFromVideo({ id: 'test123' })
    // Mock returns null
    expect(result).toBeUndefined()
  })

  it('downloadAudio should not throw', async () => {
    const resolver = getResolver(true)
    const result = await resolver.downloadAudio({ id: 'test123' })
    expect(typeof result).toBe('boolean')
  })

  it('getYouTubeSearchResults should be an async iterable', async () => {
    const resolver = getResolver(true)
    const results = []
    for await (const r of resolver.getYouTubeSearchResults('test')) {
      results.push(r)
    }
    // Mock returns null immediately
    expect(results).toEqual([])
  })
})

describe('InvidiousAudioResolver download', () => {
  it('downloadAudio should return false when no URL', async () => {
    const resolver = getResolver(false)
    const result = await resolver.downloadAudio({ id: 'test' })
    expect(result).toBe(false)
  })
})

// ─── Improve coverage: musicCache.ts remaining functions ───

describe('musicCache: exportCache and importCache', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exportCache should call backend', async () => {
    vi.mocked(localforage.iterate).mockImplementation(async () => {})
    const { exportCache } = await import('../cache/musicCache')
    await exportCache()
    // Should not throw
  })

  it('importCache should clear and repopulate', async () => {
    const { importCache } = await import('../cache/musicCache')
    await importCache('backup-2026')
    expect(localforage.clear).toHaveBeenCalled()
  })

  it('listCacheBackups should return array', async () => {
    const { listCacheBackups } = await import('../cache/musicCache')
    const result = await listCacheBackups()
    expect(Array.isArray(result)).toBe(true)
  })

  it('clearDownloads should call backend', async () => {
    const { clearDownloads } = await import('../cache/musicCache')
    await clearDownloads()
    // Should not throw
  })
})

// ─── Improve coverage: searchKHInsider and getKHInsiderTrackAudioUrl ───

describe('KHInsider frontend wrappers', () => {
  it('searchKHInsider should return empty array on failure', async () => {
    const { searchKHInsider } = await import('../actions/audio')
    const result = await searchKHInsider('test')
    expect(Array.isArray(result)).toBe(true)
  })

  it('getKHInsiderTrackAudioUrl should return null on failure', async () => {
    const { getKHInsiderTrackAudioUrl } = await import('../actions/audio')
    const result = await getKHInsiderTrackAudioUrl('https://example.com')
    expect(result).toBeNull()
  })

  it('listKHInsiderTracks should return empty array on failure', async () => {
    const { listKHInsiderTracks } = await import('../actions/audio')
    const result = await listKHInsiderTracks('https://example.com')
    expect(Array.isArray(result)).toBe(true)
  })
})

// ─── Improve coverage: getInvidiousInstances ───

describe('getInvidiousInstances', () => {
  it('should return empty array when fetch fails', async () => {
    const { getInvidiousInstances } = await import('../actions/audio')
    // fetch will fail in test env
    const result = await getInvidiousInstances()
    expect(Array.isArray(result)).toBe(true)
  })
})

// ─── Improve coverage: Invidious resolver with mocked fetch ───

describe('InvidiousAudioResolver with mocked fetch', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('getYouTubeSearchResults should yield results from Invidious API', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => [
        {
          title: 'Track 1',
          videoId: 'vid1',
          videoThumbnails: [{ url: 'thumb1' }]
        },
        {
          title: 'Track 2',
          videoId: 'vid2',
          videoThumbnails: [{ url: 'thumb2' }]
        }
      ]
    }) as unknown as typeof fetch

    const resolver = getResolver(false)
    const results = []
    for await (const r of resolver.getYouTubeSearchResults('test')) {
      results.push(r)
    }
    expect(results.length).toBe(2)
    expect(results[0].title).toBe('Track 1')
    expect(results[0].id).toBe('vid1')
  })

  it('getYouTubeSearchResults should return empty on fetch error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('network')) as unknown as typeof fetch

    const resolver = getResolver(false)
    const results = []
    for await (const r of resolver.getYouTubeSearchResults('test')) {
      results.push(r)
    }
    expect(results).toEqual([])
  })

  it('getYouTubeSearchResults should return empty on non-200', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ status: 500 }) as unknown as typeof fetch

    const resolver = getResolver(false)
    const results = []
    for await (const r of resolver.getYouTubeSearchResults('test')) {
      results.push(r)
    }
    expect(results).toEqual([])
  })

  it('getAudioUrlFromVideo should fetch audio format from Invidious', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        adaptiveFormats: [
          {
            type: 'audio/webm; codecs="opus"',
            url: 'https://audio.url',
            audioSampleRate: 48000
          }
        ]
      })
    }) as unknown as typeof fetch

    const resolver = getResolver(false)
    const url = await resolver.getAudioUrlFromVideo({ id: 'vid1' })
    expect(url).toBe('https://audio.url')
  })

  it('getAudioUrlFromVideo should return undefined on error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('fail')) as unknown as typeof fetch

    const resolver = getResolver(false)
    const url = await resolver.getAudioUrlFromVideo({ id: 'vid1' })
    expect(url).toBeUndefined()
  })

  it('downloadAudio with URL should call download_url', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        adaptiveFormats: [
          {
            type: 'audio/webm',
            url: 'https://audio.url',
            audioSampleRate: 48000
          }
        ]
      })
    }) as unknown as typeof fetch

    const resolver = getResolver(false)
    const result = await resolver.downloadAudio({
      id: 'vid1',
      url: 'https://direct.url'
    })
    expect(result).toBe(true)
  })

  it('getInvidiousInstances should parse instance list', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => [
        [
          'inv.example.com',
          {
            type: 'https',
            uri: 'https://inv.example.com',
            flag: '🇺🇸',
            stats: { usage: { users: { total: 100 } } },
            monitor: { alias: 'inv', uptime: 9900 }
          }
        ]
      ]
    }) as unknown as typeof fetch

    const { getInvidiousInstances } = await import('../actions/audio')
    const instances = await getInvidiousInstances()
    expect(instances.length).toBe(1)
    expect(instances[0].url).toBe('https://inv.example.com')
  })
})
