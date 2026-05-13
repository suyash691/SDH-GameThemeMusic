/**
 * Pure utility functions extracted from component/hook logic for testability.
 */

export function shouldAutoResolve(defaultMuted: boolean, cacheVideoId: string | undefined): boolean {
  return !defaultMuted || Boolean(cacheVideoId?.length)
}

export function getEffectiveVolume(globalVolume: number, perGameVolume: number | undefined): number {
  return typeof perGameVolume === 'number' && isFinite(perGameVolume)
    ? perGameVolume
    : globalVolume
}

export function buildSearchTerm(gameName: string, source: 'youtube' | 'khinsider'): string {
  return source === 'youtube' ? `${gameName} theme music OST` : gameName
}

export function isCustomInstance(instances: { url: string }[], loading: boolean, savedUrl: string): boolean {
  return !loading && instances.length > 0 && !instances.some(i => i.url === savedUrl)
}

export function isKhiTrack(videoId: string): boolean {
  return videoId.startsWith('khi:')
}

export function extractKhiUrl(videoId: string): string {
  return videoId.slice(4)
}
