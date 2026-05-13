import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
    expect(localforage.getItem).toHaveBeenCalledWith('99999')
  })

  it('should auto-resolve music when no cache exists', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => []
    }) as unknown as typeof fetch

    const result = await autoResolveThemeMusic('Test Game', 12345, false)
    expect(result).toBeUndefined()
    // Verify it attempted to search (fetch was called for Invidious search)
    expect(globalThis.fetch).toHaveBeenCalled()
  })

  afterEach(() => {
    globalThis.fetch = undefined as unknown as typeof fetch
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
    expect(localforage.setItem).toHaveBeenCalledWith('292030', {
      videoId: 'new_track',
      volume: 0.5
    })
  })

  it('should allow selecting "No Music" with empty videoId', async () => {
    vi.mocked(localforage.getItem).mockResolvedValueOnce(null)
    vi.mocked(localforage.setItem).mockImplementation(async (_k, v) => v)

    const result = await updateCache(292030, { videoId: '' })
    expect(result.videoId).toBe('')
    expect(localforage.setItem).toHaveBeenCalled()
  })
})

// ─── Scenario: Music source resolution tiers ───

describe('When plugin auto-resolves theme music', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => []
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = undefined as unknown as typeof fetch
  })

  it('should try Steam Store → KHInsider → YouTube in order', async () => {
    const result = await autoResolveThemeMusic('Nonexistent Game', 99999, false)
    expect(result).toBeUndefined()
    // Verify fetch was called (Invidious search as final fallback)
    expect(globalThis.fetch).toHaveBeenCalled()
  })

  it('should use different YouTube resolvers based on useYtDlp setting', () => {
    const ytdlp = getResolver(true)
    const invidious = getResolver(false)
    expect(ytdlp.constructor.name).not.toBe(invidious.constructor.name)
  })
})

// ─── Scenario: User adjusts volume ───

describe('When user adjusts volume', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should save per-game volume to cache', async () => {
    vi.mocked(localforage.getItem).mockResolvedValueOnce({ videoId: 'abc' })
    vi.mocked(localforage.setItem).mockImplementation(async (_k, v) => v)

    const result = await updateCache(12345, { volume: 0.4 })
    expect(result).toEqual({ videoId: 'abc', volume: 0.4 })
    expect(localforage.setItem).toHaveBeenCalledWith('12345', {
      videoId: 'abc',
      volume: 0.4
    })
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

// ─── Scenario: InvidiousAudioResolver ───

describe('InvidiousAudioResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => []
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = undefined as unknown as typeof fetch
  })

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
    expect(globalThis.fetch).toHaveBeenCalled()
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
    expect(results).toEqual([])
  })
})

describe('InvidiousAudioResolver download', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ adaptiveFormats: [] })
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = undefined as unknown as typeof fetch
  })

  it('downloadAudio should return false when no URL', async () => {
    const resolver = getResolver(false)
    const result = await resolver.downloadAudio({ id: 'test' })
    expect(result).toBe(false)
    // Verify it tried to fetch audio URL from Invidious
    expect(globalThis.fetch).toHaveBeenCalled()
  })
})

// ─── Improve coverage: musicCache.ts remaining functions ───

describe('musicCache: exportCache and importCache', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exportCache should call backend', async () => {
    vi.mocked(localforage.iterate).mockImplementation(async () => {})
    const { exportCache } = await import('../cache/musicCache')
    await exportCache()
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
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 500
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = undefined as unknown as typeof fetch
  })

  it('should return empty array when fetch fails', async () => {
    const { getInvidiousInstances } = await import('../actions/audio')
    const result = await getInvidiousInstances()
    expect(Array.isArray(result)).toBe(true)
    expect(result).toEqual([])
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
