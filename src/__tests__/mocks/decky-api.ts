const mockFns: Record<string, (...args: unknown[]) => unknown> = {
  get_setting: async (_key: unknown, defaults: unknown) => defaults,
  set_setting: async () => {},
  search_yt: async () => {},
  next_yt_result: async () => null,
  single_yt_url: async () => null,
  download_yt_audio: async () => {},
  download_url: async () => {},
  search_khinsider: async () => [],
  get_khinsider_track_url: async () => null,
  list_khinsider_tracks: async () => [],
  get_steam_soundtrack_name: async () => null,
  export_cache: async () => {},
  import_cache: async () => ({}),
  list_cache_backups: async () => [],
  clear_cache: async () => {},
  clear_downloads: async () => {}
}

export function callable(name: string) {
  return mockFns[name] || (async () => null)
}

export const routerHook = {
  addRoute: () => {},
  removeRoute: () => {},
  addPatch: () => ({ unpatch: () => {} }),
  removePatch: () => {}
}

export const toaster = { toast: () => {} }
