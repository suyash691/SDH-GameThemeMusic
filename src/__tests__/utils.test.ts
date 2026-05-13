import { describe, it, expect } from 'vitest'
import {
  shouldAutoResolve,
  getEffectiveVolume,
  buildSearchTerm,
  isCustomInstance,
  isKhiTrack,
  extractKhiUrl
} from '../utils'

describe('shouldAutoResolve', () => {
  it('returns true when not muted and no cache', () => {
    expect(shouldAutoResolve(false, undefined)).toBe(true)
  })

  it('returns true when not muted and cache has videoId', () => {
    expect(shouldAutoResolve(false, 'abc123')).toBe(true)
  })

  it('returns false when muted and no cache', () => {
    expect(shouldAutoResolve(true, undefined)).toBe(false)
  })

  it('returns false when muted and cache is empty string', () => {
    expect(shouldAutoResolve(true, '')).toBe(false)
  })

  it('returns true when muted but cache has videoId', () => {
    expect(shouldAutoResolve(true, 'saved_track')).toBe(true)
  })
})

describe('getEffectiveVolume', () => {
  it('returns per-game volume when set', () => {
    expect(getEffectiveVolume(0.8, 0.3)).toBe(0.3)
  })

  it('returns global volume when per-game is undefined', () => {
    expect(getEffectiveVolume(0.8, undefined)).toBe(0.8)
  })

  it('returns global volume when per-game is NaN', () => {
    expect(getEffectiveVolume(0.8, NaN)).toBe(0.8)
  })

  it('returns global volume when per-game is Infinity', () => {
    expect(getEffectiveVolume(0.8, Infinity)).toBe(0.8)
  })

  it('returns 0 per-game volume (valid mute)', () => {
    expect(getEffectiveVolume(0.8, 0)).toBe(0)
  })
})

describe('buildSearchTerm', () => {
  it('appends theme music OST for youtube source', () => {
    expect(buildSearchTerm('Elden Ring', 'youtube')).toBe('Elden Ring theme music OST')
  })

  it('returns just game name for khinsider source', () => {
    expect(buildSearchTerm('Elden Ring', 'khinsider')).toBe('Elden Ring')
  })

  it('handles empty game name', () => {
    expect(buildSearchTerm('', 'youtube')).toBe(' theme music OST')
    expect(buildSearchTerm('', 'khinsider')).toBe('')
  })
})

describe('isCustomInstance', () => {
  const instances = [
    { url: 'https://inv-a.example.com' },
    { url: 'https://inv-b.example.com' }
  ]

  it('returns false while loading', () => {
    expect(isCustomInstance(instances, true, 'https://custom.com')).toBe(false)
  })

  it('returns false when instances list is empty', () => {
    expect(isCustomInstance([], false, 'https://custom.com')).toBe(false)
  })

  it('returns false when saved URL is in the list', () => {
    expect(isCustomInstance(instances, false, 'https://inv-a.example.com')).toBe(false)
  })

  it('returns true when saved URL is not in the list', () => {
    expect(isCustomInstance(instances, false, 'https://custom.com')).toBe(true)
  })
})

describe('isKhiTrack', () => {
  it('returns true for khi: prefixed videoId', () => {
    expect(isKhiTrack('khi:https://downloads.khinsider.com/album/zelda')).toBe(true)
  })

  it('returns false for regular YouTube videoId', () => {
    expect(isKhiTrack('dQw4w9WgXcQ')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isKhiTrack('')).toBe(false)
  })
})

describe('extractKhiUrl', () => {
  it('extracts URL after khi: prefix', () => {
    expect(extractKhiUrl('khi:https://cdn.example.com/track.mp3')).toBe('https://cdn.example.com/track.mp3')
  })

  it('returns empty string when only prefix', () => {
    expect(extractKhiUrl('khi:')).toBe('')
  })
})
