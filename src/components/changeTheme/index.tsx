import { Tabs, useParams } from '@decky/ui'
import { useEffect, useState } from 'react'

import useTranslations from '../../hooks/useTranslations'
import ChangePage from './changePage'
import AboutPage from './aboutPage'
import {
  getResolver,
  searchKHInsider,
  listKHInsiderTracks
} from '../../actions/audio'
import { YouTubeVideoPreview } from '../../../types/YouTube'
import GameSettings from './gameSettings'
import { useSettings } from '../../hooks/useSettings'

type SearchSource = 'youtube' | 'khinsider'

export default function ChangeTheme() {
  const [currentTab, setCurrentTab] = useState<string>('change-music-tab')
  const t = useTranslations()
  const { settings, isLoading: settingsLoading } = useSettings()
  const { appid } = useParams<{ appid: string }>()
  const appDetails = appStore.GetAppOverviewByGameID(parseInt(appid))
  const appName = appDetails?.display_name?.replace(/(™|®|©)/g, '')

  const [videos, setVideos] = useState<
    (YouTubeVideoPreview & { isPlaying: boolean })[]
  >([])
  const [loadingNum, setLoadingNum] = useState(0)
  const initialSearch = appName ?? ''
  const [searchTerm, setSearchTerm] = useState(
    initialSearch + ' theme music OST'
  )
  const [searchSource, setSearchSource] = useState<SearchSource>('youtube')

  useEffect(() => {
    let ignore = false
    async function getData() {
      setLoadingNum((x) => x + 1)
      setVideos([])

      if (searchSource === 'khinsider') {
        const albums = await searchKHInsider(searchTerm)
        // Collect tracks from top 3 albums, then sort globally by score
        const allTracks: {
          albumName: string
          name: string
          audioUrl: string
          score: number
        }[] = []
        for (const album of albums.slice(0, 3)) {
          if (ignore) break
          const tracks = await listKHInsiderTracks(album.url)
          for (const track of tracks) {
            allTracks.push({ albumName: album.name, ...track })
          }
        }
        // Sort by score descending — best tracks from any album first
        allTracks.sort((a, b) => b.score - a.score)
        for (const track of allTracks) {
          if (ignore) break
          setVideos((old) => [
            ...old,
            {
              isPlaying: false,
              id: `khi:${track.audioUrl}`,
              title: `${track.albumName} — ${track.name}`,
              thumbnail: '',
              url: track.audioUrl
            }
          ])
        }
      } else {
        const resolver = getResolver(settings.useYtDlp)
        const res = resolver.getYouTubeSearchResults(searchTerm)
        for await (const video of res) {
          if (ignore) break
          setVideos((old) => [...old, { isPlaying: false, ...video }])
        }
      }

      setLoadingNum((x) => x - 1)
    }
    if (searchTerm.length > 0 && !settingsLoading) {
      getData()
    }
    return () => {
      ignore = true
    }
  }, [searchTerm, settingsLoading, searchSource])

  function handlePlay(index: number, startPlay: boolean) {
    setVideos((oldVideos) =>
      oldVideos.map((v, i) => ({
        ...v,
        isPlaying: i === index ? startPlay : false
      }))
    )
  }

  function setInitialSearch() {
    const term =
      searchSource === 'youtube'
        ? `${initialSearch} theme music OST`
        : initialSearch
    setSearchTerm(term)
    return term
  }

  function handleSourceChange(source: SearchSource) {
    setSearchSource(source)
    const term =
      source === 'youtube' ? `${initialSearch} theme music OST` : initialSearch
    setSearchTerm(term)
  }

  return (
    <div
      style={{
        marginTop: '40px',
        height: 'calc(100% - 40px)'
      }}
    >
      <Tabs
        autoFocusContents
        activeTab={currentTab}
        onShowTab={setCurrentTab}
        tabs={[
          {
            title: t('changeThemeMusic'),
            content: (
              <ChangePage
                videos={videos}
                loading={loadingNum > 0}
                handlePlay={handlePlay}
                customSearch={setSearchTerm}
                currentSearch={searchTerm}
                setInitialSearch={setInitialSearch}
                searchSource={searchSource}
                setSearchSource={handleSourceChange}
              />
            ),
            id: 'change-music-tab'
          },
          {
            title: t('gameSettings'),
            content: <GameSettings />,
            id: 'game-settings-tab'
          },
          { title: t('about'), content: <AboutPage />, id: 'about-tab' }
        ]}
      />
    </div>
  )
}
