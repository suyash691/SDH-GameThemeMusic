import { vi } from 'vitest'

// Mock localforage
vi.mock('localforage', () => ({
  default: {
    config: vi.fn(),
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async (_k: string, v: unknown) => v),
    removeItem: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    iterate: vi.fn(async () => {})
  }
}))

// Mock Steam globals
;(globalThis as Record<string, unknown>).appStore = {
  GetAppOverviewByGameID: () => ({ display_name: 'Test Game', appid: '12345' })
}
;(globalThis as Record<string, unknown>).SteamClient = {
  GameSessions: {
    RegisterForAppLifetimeNotifications: () => ({ unregister: vi.fn() })
  }
}
