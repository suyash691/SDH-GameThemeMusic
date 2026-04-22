import { callable } from '@decky/api'
import localforage from 'localforage'

const STORAGE_KEY = 'game-theme-music-cache'

localforage.config({
  name: STORAGE_KEY
})

type GameThemeMusicCache = {
  videoId?: string | undefined
  volume?: number
}

type GameThemeMusicCacheMapping = { [key: string]: GameThemeMusicCache }

const backendExportCache =
  callable<[GameThemeMusicCacheMapping], void>('export_cache')
const backendImportCache =
  callable<[string], GameThemeMusicCacheMapping>('import_cache')
const backendListCacheBackups = callable<[], string[]>('list_cache_backups')
const backendClearCache = callable<[], void>('clear_cache')
const backendClearDownloads = callable<[], void>('clear_downloads')

export async function updateCache(appId: number, newData: GameThemeMusicCache) {
  const oldCache = (await localforage.getItem(
    appId.toString()
  )) as GameThemeMusicCache | null
  const newCache = await localforage.setItem(appId.toString(), {
    ...(oldCache || {}),
    ...newData
  })
  return newCache
}

export async function getFullCache(): Promise<GameThemeMusicCacheMapping> {
  const fullCache: GameThemeMusicCacheMapping = {}
  await localforage.iterate((value: GameThemeMusicCache, key) => {
    fullCache[key] = value
  })
  return fullCache
}

export async function exportCache() {
  await backendExportCache(await getFullCache())
}

export async function importCache(name: string) {
  const newCache = await backendImportCache(name)
  localforage.clear()
  for (const [key, value] of Object.entries(newCache)) {
    await localforage.setItem(key, value)
  }
}

export async function listCacheBackups(): Promise<string[]> {
  return await backendListCacheBackups()
}

export async function clearCache(appId?: number) {
  if (appId?.toString().length) {
    localforage.removeItem(appId.toString())
  } else {
    localforage.clear()
    await backendClearCache()
  }
}

export async function getCache(
  appId: number
): Promise<GameThemeMusicCache | null> {
  const cache = await localforage.getItem<GameThemeMusicCache>(appId.toString())
  return cache
}

export async function clearDownloads() {
  await backendClearDownloads()
}
