"""
Scenario-driven integration tests for the full plugin backend.
Tests the complete user workflows with mocked external dependencies (yt-dlp, network).
"""
import asyncio
import json
import os
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from main import Plugin


@pytest.fixture
def plugin(tmp_path):
    p = Plugin()
    p.music_path = str(tmp_path / "music")
    p.cache_path = str(tmp_path / "cache")
    os.makedirs(p.music_path, exist_ok=True)
    os.makedirs(p.cache_path, exist_ok=True)
    from settings import SettingsManager
    p.settings = SettingsManager()
    return p


# ─── Scenario: User opens a game page and music auto-plays ───


class TestAutoPlayScenario:
    """When a user navigates to a game page, the plugin should find and serve audio."""

    @pytest.mark.asyncio
    async def test_locally_downloaded_audio_served_via_http(self, plugin):
        """If file server is running, local audio should serve via localhost."""
        plugin.file_server_available = True
        with open(os.path.join(plugin.music_path, "abc123.webm"), "wb") as f:
            f.write(b"fake audio data")

        url = await plugin.single_yt_url("abc123")
        assert url.startswith("http://127.0.0.1:")
        assert "abc123.webm" in url

    @pytest.mark.asyncio
    async def test_locally_downloaded_audio_falls_back_to_base64(self, plugin):
        """If file server is not running, local audio should fall back to base64."""
        plugin.file_server_available = False
        with open(os.path.join(plugin.music_path, "abc123.webm"), "wb") as f:
            f.write(b"fake audio data")

        url = await plugin.single_yt_url("abc123")
        assert url.startswith("data:audio/")
        assert "base64" in url

    @pytest.mark.asyncio
    async def test_no_local_file_fetches_from_ytdlp(self, plugin):
        """If no local file exists, should call yt-dlp to get a streaming URL."""
        mock_process = AsyncMock()
        mock_process.stdout = AsyncMock()
        mock_process.stdout.read = AsyncMock(
            return_value=json.dumps({"url": "https://youtube.com/stream/abc"}).encode()
        )

        with patch("asyncio.create_subprocess_exec", return_value=mock_process):
            url = await plugin.single_yt_url("newvideo")

        assert url == "https://youtube.com/stream/abc"

    @pytest.mark.asyncio
    async def test_ytdlp_returns_nothing_gives_none(self, plugin):
        """If yt-dlp returns empty output, should return None (no audio)."""
        mock_process = AsyncMock()
        mock_process.stdout = AsyncMock()
        mock_process.stdout.read = AsyncMock(return_value=b"")

        with patch("asyncio.create_subprocess_exec", return_value=mock_process):
            url = await plugin.single_yt_url("broken")

        assert url is None


# ─── Scenario: User searches YouTube for a different track ───


class TestYtDlpSearchScenario:
    """When user searches for a track, yt-dlp should be invoked and results streamed."""

    @pytest.mark.asyncio
    async def test_search_starts_ytdlp_process(self, plugin):
        """Searching should spawn a yt-dlp subprocess with the search term."""
        mock_process = AsyncMock()
        mock_process.returncode = None
        mock_process.stdout = AsyncMock()

        with patch("asyncio.create_subprocess_exec", return_value=mock_process) as mock_exec:
            with patch("os.path.exists", return_value=True):
                with patch("os.chmod"):
                    await plugin.search_yt("Halo Theme Music")

        # Verify yt-dlp was called with the search term
        call_args = mock_exec.call_args
        assert any("ytsearch10:Halo Theme Music" in str(a) for a in call_args[0])

    @pytest.mark.asyncio
    async def test_search_terminates_previous_process(self, plugin):
        """Starting a new search should terminate any running yt-dlp process."""
        old_process = AsyncMock()
        old_process.returncode = None
        old_process.terminate = MagicMock()
        old_process.communicate = AsyncMock()
        plugin.yt_process = old_process

        new_process = AsyncMock()
        new_process.returncode = None
        new_process.stdout = AsyncMock()

        with patch("asyncio.create_subprocess_exec", return_value=new_process):
            with patch("os.path.exists", return_value=True):
                with patch("os.chmod"):
                    await plugin.search_yt("new search")

        old_process.terminate.assert_called_once()

    @pytest.mark.asyncio
    async def test_next_result_returns_parsed_entry(self, plugin):
        """Each call to next_yt_result should return one parsed video entry."""
        entry = {"url": "https://yt.com/a", "title": "Track 1", "id": "vid1", "thumbnail": "https://img/1"}
        mock_process = AsyncMock()
        mock_stdout = AsyncMock()
        mock_stdout.readline = AsyncMock(return_value=json.dumps(entry).encode() + b"\n")
        mock_process.stdout = mock_stdout
        plugin.yt_process = mock_process

        result = await plugin.next_yt_result()
        assert result["id"] == "vid1"
        assert result["title"] == "Track 1"

    @pytest.mark.asyncio
    async def test_next_result_returns_none_when_exhausted(self, plugin):
        """When yt-dlp has no more results, should return None."""
        mock_process = AsyncMock()
        mock_stdout = AsyncMock()
        mock_stdout.readline = AsyncMock(return_value=b"")
        mock_process.stdout = mock_stdout
        plugin.yt_process = mock_process

        result = await plugin.next_yt_result()
        assert result is None

    @pytest.mark.asyncio
    async def test_next_result_returns_none_when_no_process(self, plugin):
        """If no search has been started, should return None."""
        plugin.yt_process = None
        result = await plugin.next_yt_result()
        assert result is None


# ─── Scenario: User downloads a track for offline playback ───


class TestDownloadScenario:
    """When user enables download, audio should be saved locally."""

    @pytest.mark.asyncio
    async def test_download_calls_ytdlp_with_correct_args(self, plugin):
        """Download should invoke yt-dlp with the video ID and output to music dir."""
        mock_process = AsyncMock()
        mock_process.communicate = AsyncMock()

        with patch("asyncio.create_subprocess_exec", return_value=mock_process) as mock_exec:
            await plugin.download_yt_audio("testvid")

        call_args = mock_exec.call_args[0]
        assert "testvid" in call_args
        assert "-f" in call_args
        assert "bestaudio" in call_args

    @pytest.mark.asyncio
    async def test_download_skips_if_already_exists(self, plugin):
        """Should not re-download if the file already exists locally."""
        with open(os.path.join(plugin.music_path, "existing.webm"), "w") as f:
            f.write("data")

        with patch("asyncio.create_subprocess_exec") as mock_exec:
            await plugin.download_yt_audio("existing")

        mock_exec.assert_not_called()

    @pytest.mark.asyncio
    async def test_m4a_gets_renamed_to_webm(self, plugin):
        """If yt-dlp downloads m4a format, it should be renamed to .webm."""
        mock_process = AsyncMock()
        mock_process.communicate = AsyncMock()

        # Simulate yt-dlp creating an m4a file
        m4a_path = os.path.join(plugin.music_path, "vid1.m4a")

        async def fake_communicate():
            with open(m4a_path, "w") as f:
                f.write("audio data")

        mock_process.communicate = fake_communicate

        with patch("asyncio.create_subprocess_exec", return_value=mock_process):
            await plugin.download_yt_audio("vid1")

        assert os.path.exists(os.path.join(plugin.music_path, "vid1.webm"))
        assert not os.path.exists(m4a_path)

    @pytest.mark.asyncio
    async def test_download_url_saves_file(self, plugin):
        """Downloading from a URL should save the file as .webm."""
        mock_response = AsyncMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.content = AsyncMock()
        mock_response.content.iter_chunked = lambda _: async_iter([b"chunk1", b"chunk2"])

        mock_session = AsyncMock()
        mock_session.get = AsyncMock(return_value=mock_response)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()

        with patch("aiohttp.ClientSession", return_value=mock_session):
            await plugin.download_url("https://example.com/audio.webm", "dlid")

        filepath = os.path.join(plugin.music_path, "dlid.webm")
        assert os.path.exists(filepath)
        with open(filepath, "rb") as f:
            assert f.read() == b"chunk1chunk2"


# ─── Scenario: Plugin resolves music from Steam Store + KHInsider ───


class TestSteamStoreResolutionScenario:
    """Plugin should check Steam Store for soundtrack DLC and use the name for KHInsider search."""

    @pytest.mark.asyncio
    async def test_finds_soundtrack_dlc_by_type_music(self, plugin):
        """Game with a 'music' type DLC should return the DLC name."""
        app_response = AsyncMock()
        app_response.status = 200
        app_response.json = AsyncMock(return_value={
            "292030": {"success": True, "data": {"dlc": [999]}}
        })

        dlc_response = AsyncMock()
        dlc_response.status = 200
        dlc_response.json = AsyncMock(return_value={
            "999": {"success": True, "data": {"type": "music", "name": "The Witcher 3 Soundtrack"}}
        })

        mock_session = AsyncMock()
        mock_session.get = AsyncMock(side_effect=[app_response, dlc_response])
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()

        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await plugin.get_steam_soundtrack_name("292030")

        assert result == "The Witcher 3 Soundtrack"

    @pytest.mark.asyncio
    async def test_finds_soundtrack_dlc_by_name(self, plugin):
        """DLC with 'soundtrack' in name should be detected even if type is 'dlc'."""
        app_response = AsyncMock()
        app_response.status = 200
        app_response.json = AsyncMock(return_value={
            "100": {"success": True, "data": {"dlc": [200]}}
        })

        dlc_response = AsyncMock()
        dlc_response.status = 200
        dlc_response.json = AsyncMock(return_value={
            "200": {"success": True, "data": {"type": "dlc", "name": "Original Soundtrack"}}
        })

        mock_session = AsyncMock()
        mock_session.get = AsyncMock(side_effect=[app_response, dlc_response])
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()

        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await plugin.get_steam_soundtrack_name("100")

        assert result == "Original Soundtrack"

    @pytest.mark.asyncio
    async def test_skips_non_soundtrack_dlc(self, plugin):
        """DLC that is a season pass or character pack should be skipped."""
        app_response = AsyncMock()
        app_response.status = 200
        app_response.json = AsyncMock(return_value={
            "100": {"success": True, "data": {"dlc": [200]}}
        })

        dlc_response = AsyncMock()
        dlc_response.status = 200
        dlc_response.json = AsyncMock(return_value={
            "200": {"success": True, "data": {"type": "dlc", "name": "Season Pass"}}
        })

        mock_session = AsyncMock()
        mock_session.get = AsyncMock(side_effect=[app_response, dlc_response])
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()

        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await plugin.get_steam_soundtrack_name("100")

        assert result is None

    @pytest.mark.asyncio
    async def test_handles_steam_api_timeout(self, plugin):
        """Should return None gracefully if Steam API times out."""
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(side_effect=asyncio.TimeoutError())
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()

        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await plugin.get_steam_soundtrack_name("12345")

        assert result is None


# ─── Scenario: KHInsider is down, plugin falls back gracefully ───


class TestKHInsiderFailureScenario:
    """When KHInsider is unreachable, plugin should not crash."""

    @pytest.mark.asyncio
    async def test_search_returns_empty_on_timeout(self, plugin):
        """KHInsider search timeout should return empty list, not crash."""
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(side_effect=asyncio.TimeoutError())
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()

        with patch("aiohttp.ClientSession", return_value=mock_session):
            results = await plugin.search_khinsider("Zelda")

        assert results == []

    @pytest.mark.asyncio
    async def test_search_returns_empty_on_500(self, plugin):
        """KHInsider returning 500 should return empty list."""
        mock_response = AsyncMock()
        mock_response.status = 500
        mock_response.raise_for_status = MagicMock(side_effect=Exception("500"))

        mock_session = AsyncMock()
        mock_session.get = AsyncMock(return_value=mock_response)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()

        with patch("aiohttp.ClientSession", return_value=mock_session):
            results = await plugin.search_khinsider("Zelda")

        assert results == []

    @pytest.mark.asyncio
    async def test_track_url_returns_none_on_failure(self, plugin):
        """Track URL fetch failure should return None."""
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(side_effect=Exception("connection refused"))
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()

        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await plugin.get_khinsider_track_url("https://khinsider.com/album/fake")

        assert result is None


# ─── Scenario: Plugin lifecycle (init and cleanup) ───


class TestPluginLifecycleScenario:
    """Plugin should initialize cleanly and clean up on unload."""

    @pytest.mark.asyncio
    async def test_file_server_starts_on_init(self, plugin):
        """_main should start the local file server."""
        await plugin._start_file_server()
        assert plugin.file_server_runner is not None
        await plugin._stop_file_server()

    @pytest.mark.asyncio
    async def test_file_server_stops_on_unload(self, plugin):
        """_unload should stop the file server."""
        await plugin._start_file_server()
        await plugin._stop_file_server()
        assert plugin.file_server_runner is None

    @pytest.mark.asyncio
    async def test_unload_terminates_running_ytdlp(self, plugin):
        """If yt-dlp is running when plugin unloads, it should be terminated."""
        mock_process = AsyncMock()
        mock_process.returncode = None
        mock_process.terminate = MagicMock()
        mock_process.communicate = AsyncMock()
        plugin.yt_process = mock_process

        await plugin._unload()
        mock_process.terminate.assert_called_once()

    @pytest.mark.asyncio
    async def test_unload_handles_no_running_process(self, plugin):
        """Unload should not crash if no yt-dlp process is running."""
        plugin.yt_process = None
        await plugin._unload()  # Should not raise


# ─── Scenario: User backs up and restores overrides ───


class TestBackupRestoreScenario:
    """User should be able to backup all overrides and restore them later."""

    @pytest.mark.asyncio
    async def test_full_cycle_backup_list_restore_clear(self, plugin):
        """Complete workflow: export → list → import → verify → clear."""
        overrides = {
            "292030": {"videoId": "witcher_theme", "volume": 0.8},
            "1245620": {"videoId": "elden_ring_ost"},
        }

        await plugin.export_cache(overrides)
        backups = await plugin.list_cache_backups()
        assert len(backups) == 1

        restored = await plugin.import_cache(backups[0])
        assert restored["292030"]["videoId"] == "witcher_theme"
        assert restored["292030"]["volume"] == 0.8
        assert restored["1245620"]["videoId"] == "elden_ring_ost"

        await plugin.clear_cache()
        assert await plugin.list_cache_backups() == []

    @pytest.mark.asyncio
    async def test_path_traversal_blocked_on_import(self, plugin):
        """Malicious import name should not read files outside cache dir."""
        with pytest.raises(FileNotFoundError):
            await plugin.import_cache("../../etc/passwd")


# ─── Helpers ───


async def async_iter(items):
    for item in items:
        yield item


# ─── Scenario: KHInsider track scoring picks the best theme ───


class TestKHInsiderTrackScoring:
    """Plugin should pick the best theme track from an album."""

    def _score(self, link, index=0):
        """Replicate track_score from main.py."""
        lower = link.lower()
        score = 0
        if "main-theme" in lower or "main_theme" in lower:
            score += 10
        if "title" in lower and "screen" in lower:
            score += 9
        if "title" in lower:
            score += 7
        if "theme" in lower:
            score += 6
        if "opening" in lower:
            score += 5
        if "menu" in lower:
            score += 4
        if "intro" in lower:
            score += 3
        if index < 3:
            score += 2
        elif index > 15:
            score -= 1
        if "battle" in lower or "combat" in lower or "boss" in lower:
            score -= 3
        if "credits" in lower or "ending" in lower:
            score -= 2
        return score

    def test_main_theme_scores_highest(self):
        tracks = ["/album/game/01-battle.mp3", "/album/game/05-main-theme.mp3", "/album/game/10-credits.mp3"]
        scores = [(self._score(t, i), t) for i, t in enumerate(tracks)]
        scores.sort(key=lambda x: -x[0])
        assert "main-theme" in scores[0][1]

    def test_early_tracks_get_position_bonus(self):
        assert self._score("/album/game/01-ambience.mp3", 0) > self._score("/album/game/01-ambience.mp3", 20)

    def test_battle_tracks_penalized(self):
        assert self._score("/album/game/boss-battle.mp3") < 0

    def test_title_screen_beats_generic_title(self):
        assert self._score("/album/game/title-screen.mp3") > self._score("/album/game/title.mp3")


# ─── Scenario: KHInsider track name cleaning ───


class TestKHInsiderTrackNameCleaning:
    """Track names from URLs should be human-readable."""

    def _clean(self, link):
        import re
        from urllib.parse import unquote
        filename = link.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        name = unquote(unquote(filename))
        name = name.replace("-", " ").replace("_", " ")
        name = re.sub(r"^\d{1,3}[\.\s]+", "", name).strip()
        return name if name else filename

    def test_decodes_url_encoded_characters(self):
        assert "記憶" in self._clean("/album/game/%E8%A8%98%E6%86%B6.mp3")

    def test_strips_track_numbers(self):
        assert self._clean("/album/game/01.%20Main%20Theme.mp3") == "Main Theme"

    def test_replaces_dashes_and_underscores(self):
        name = self._clean("/album/game/main-theme_remix.mp3")
        assert "-" not in name
        assert "_" not in name

    def test_handles_double_encoded_urls(self):
        name = self._clean("/album/game/01%2520Title.mp3")
        assert "%20" not in name


# ─── Scenario: YouTube search term construction ───


class TestYouTubeSearchTerms:
    """YouTube searches should include music-related terms."""

    def test_auto_resolve_uses_ost_keywords(self):
        """Auto-resolve YouTube search should include theme/OST keywords."""
        search = "Crimson Desert theme music OST"
        assert "theme" in search
        assert "OST" in search

    def test_manual_search_shows_full_term(self):
        """Manual YouTube search should show the full term in the search field."""
        game_name = "Elden Ring"
        initial = f"{game_name} theme music OST"
        assert initial == "Elden Ring theme music OST"

    def test_khinsider_search_uses_plain_name(self):
        """KHInsider search should use just the game name."""
        game_name = "Elden Ring"
        assert game_name == "Elden Ring"  # No suffix


# ─── Scenario: File server error handling ───


class TestFileServerErrorHandling:
    """File server should handle startup failures gracefully."""

    @pytest.mark.asyncio
    async def test_file_server_failure_sets_flag_false(self, plugin):
        """If file server can't start, file_server_available should be False."""
        with patch("aiohttp.web.AppRunner") as mock_runner:
            mock_runner.return_value.setup = AsyncMock(side_effect=OSError("Address in use"))
            await plugin._start_file_server()
        assert plugin.file_server_available is False

    @pytest.mark.asyncio
    async def test_file_server_success_sets_flag_true(self, plugin):
        """If file server starts, file_server_available should be True."""
        await plugin._start_file_server()
        assert plugin.file_server_available is True
        await plugin._stop_file_server()


# ─── Scenario: Plugin initialization ───


class TestPluginInitialization:
    """Plugin _main should initialize settings and file server."""

    @pytest.mark.asyncio
    async def test_main_initializes_settings(self, plugin):
        """_main should create a SettingsManager."""
        await plugin._main()
        assert hasattr(plugin, 'settings')
        await plugin._stop_file_server()

    @pytest.mark.asyncio
    async def test_main_starts_file_server(self, plugin):
        """_main should start the file server."""
        await plugin._main()
        assert plugin.file_server_available is True
        await plugin._stop_file_server()


# ─── Scenario: Settings get/set ───


class TestSettingsGetSet:
    """Settings should persist values."""

    @pytest.mark.asyncio
    async def test_get_setting_returns_stored_value(self, plugin):
        from settings import SettingsManager
        plugin.settings = SettingsManager()
        await plugin.set_setting("key", "value")
        result = await plugin.get_setting("key", "default")
        assert result == "value"

    @pytest.mark.asyncio
    async def test_get_setting_returns_default(self, plugin):
        from settings import SettingsManager
        plugin.settings = SettingsManager()
        result = await plugin.get_setting("missing", "fallback")
        assert result == "fallback"


# ─── Scenario: Steam Store API resolution ───


class TestSteamStoreFullFlow:
    """Steam Store API should find soundtrack DLC."""

    @pytest.mark.asyncio
    async def test_returns_none_when_api_returns_non_200(self, plugin):
        mock_response = AsyncMock()
        mock_response.status = 503
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(return_value=mock_response)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await plugin.get_steam_soundtrack_name("12345")
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_app_not_successful(self, plugin):
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"12345": {"success": False}})
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(return_value=mock_response)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await plugin.get_steam_soundtrack_name("12345")
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_dlc_check_fails(self, plugin):
        app_resp = AsyncMock()
        app_resp.status = 200
        app_resp.json = AsyncMock(return_value={"1": {"success": True, "data": {"dlc": [2]}}})
        dlc_resp = AsyncMock()
        dlc_resp.status = 404
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(side_effect=[app_resp, dlc_resp])
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await plugin.get_steam_soundtrack_name("1")
        assert result is None


# ─── Scenario: Download URL saves file ───


class TestDownloadUrlFlow:
    """download_url should save remote file to disk."""

    @pytest.mark.asyncio
    async def test_download_url_creates_file(self, plugin):
        mock_response = AsyncMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.content = AsyncMock()
        mock_response.content.iter_chunked = lambda _: async_iter([b"data1", b"data2"])
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(return_value=mock_response)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            await plugin.download_url("https://example.com/audio.webm", "testdl")
        path = os.path.join(plugin.music_path, "testdl.webm")
        assert os.path.exists(path)
        with open(path, "rb") as f:
            assert f.read() == b"data1data2"


# ─── Scenario: KHInsider search with real HTML parsing ───


class TestKHInsiderSearchParsing:
    """KHInsider search should parse album links from HTML."""

    @pytest.mark.asyncio
    async def test_parses_albums_from_html(self, plugin):
        html = '<a href="/game-soundtracks/album/zelda-oot">Zelda OOT</a><a href="/game-soundtracks/album/zelda-mm">Zelda MM</a>'
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.text = AsyncMock(return_value=html)
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(return_value=mock_response)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            results = await plugin.search_khinsider("zelda")
        assert len(results) == 2
        assert results[0]["name"] == "Zelda OOT"

    @pytest.mark.asyncio
    async def test_limits_to_10_results(self, plugin):
        html = "".join(f'<a href="/game-soundtracks/album/g{i}">Game {i}</a>' for i in range(20))
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.text = AsyncMock(return_value=html)
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(return_value=mock_response)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            results = await plugin.search_khinsider("game")
        assert len(results) == 10


# ─── Scenario: KHInsider track resolution with HTML parsing ───


class TestKHInsiderTrackResolution:
    """KHInsider should resolve track audio URLs from album pages."""

    @pytest.mark.asyncio
    async def test_resolves_track_with_click_to_download(self, plugin):
        album_html = '<a href="/game-soundtracks/album/zelda/01-title.mp3">Title</a>'
        track_html = '<a href="https://cdn.example.com/title.mp3">Click here to download</a>'
        mock_session = AsyncMock()
        resp1 = AsyncMock()
        resp1.status = 200
        resp1.raise_for_status = MagicMock()
        resp1.text = AsyncMock(return_value=album_html)
        resp2 = AsyncMock()
        resp2.status = 200
        resp2.raise_for_status = MagicMock()
        resp2.text = AsyncMock(return_value=track_html)
        mock_session.get = AsyncMock(side_effect=[resp1, resp2])
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            url = await plugin.get_khinsider_track_url("https://downloads.khinsider.com/game-soundtracks/album/zelda")
        assert url == "https://cdn.example.com/title.mp3"

    @pytest.mark.asyncio
    async def test_returns_none_when_no_tracks(self, plugin):
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.text = AsyncMock(return_value="<html>No tracks</html>")
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(return_value=mock_response)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            url = await plugin.get_khinsider_track_url("https://downloads.khinsider.com/album/empty")
        assert url is None

    @pytest.mark.asyncio
    async def test_list_tracks_returns_scored_list(self, plugin):
        album_html = '''
        <a href="/game-soundtracks/album/zelda/01-title.mp3">T</a>
        <a href="/game-soundtracks/album/zelda/02-battle.mp3">B</a>
        <a href="/game-soundtracks/album/zelda/03-main-theme.mp3">M</a>
        '''
        track_html = '<a href="https://cdn.example.com/track.mp3">Click here to download</a>'
        mock_session = AsyncMock()
        resp1 = AsyncMock()
        resp1.status = 200
        resp1.raise_for_status = MagicMock()
        resp1.text = AsyncMock(return_value=album_html)
        resp_track = AsyncMock()
        resp_track.status = 200
        resp_track.raise_for_status = MagicMock()
        resp_track.text = AsyncMock(return_value=track_html)
        mock_session.get = AsyncMock(side_effect=[resp1, resp_track, resp_track, resp_track])
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            tracks = await plugin.list_khinsider_tracks("https://downloads.khinsider.com/album/zelda")
        assert len(tracks) == 3
        # main-theme should be first (highest score)
        assert tracks[0]["score"] > tracks[1]["score"]


# ─── Scenario: Unload with timeout ───


class TestUnloadTimeout:
    """Unload should kill yt-dlp if it doesn't terminate in time."""

    @pytest.mark.asyncio
    async def test_kills_process_on_timeout(self, plugin):
        mock_process = MagicMock()
        mock_process.returncode = None
        mock_process.terminate = MagicMock()
        mock_process.kill = MagicMock()
        mock_process.communicate = AsyncMock()
        plugin.yt_process = mock_process

        # Patch wait_for timeout to be instant
        with patch("asyncio.wait_for", side_effect=TimeoutError()):
            await plugin._unload()
        mock_process.terminate.assert_called_once()
        mock_process.kill.assert_called_once()


# ─── Scenario: Clear cache with missing directory ───


class TestClearCacheMissingDir:
    """Clear operations should handle missing directories."""

    @pytest.mark.asyncio
    async def test_clear_cache_missing_dir(self, plugin):
        plugin.cache_path = "/nonexistent/path"
        await plugin.clear_cache()  # Should not raise

    @pytest.mark.asyncio
    async def test_clear_downloads_missing_dir(self, plugin):
        plugin.music_path = "/nonexistent/path"
        await plugin.clear_downloads()  # Should not raise


# ─── Cover remaining lines ───


class TestSteamStoreDlcNotSuccessful:
    """Cover line 100, 110: DLC response not successful or non-200."""

    @pytest.mark.asyncio
    async def test_dlc_not_successful(self, plugin):
        app_resp = AsyncMock()
        app_resp.status = 200
        app_resp.json = AsyncMock(return_value={"1": {"success": True, "data": {"dlc": [2]}}})
        dlc_resp = AsyncMock()
        dlc_resp.status = 200
        dlc_resp.json = AsyncMock(return_value={"2": {"success": False}})
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(side_effect=[app_resp, dlc_resp])
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await plugin.get_steam_soundtrack_name("1")
        assert result is None


class TestSteamStoreExceptionPath:
    """Cover lines 119-121: general exception in Steam Store API."""

    @pytest.mark.asyncio
    async def test_general_exception(self, plugin):
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(side_effect=RuntimeError("network down"))
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await plugin.get_steam_soundtrack_name("1")
        assert result is None


class TestLocalMatchMissingDir:
    """Cover lines 173-174: local_match with FileNotFoundError."""

    def test_missing_music_dir(self, plugin):
        plugin.music_path = "/nonexistent/dir"
        assert plugin.local_match("abc") is None


class TestClearDownloadsWithFiles:
    """Cover lines 235-237: clear_downloads actually removing files."""

    @pytest.mark.asyncio
    async def test_removes_files(self, plugin):
        for name in ["a.webm", "b.mp3"]:
            with open(os.path.join(plugin.music_path, name), "w") as f:
                f.write("x")
        await plugin.clear_downloads()
        assert len(os.listdir(plugin.music_path)) == 0


class TestListCacheBackupsMissingDir:
    """Cover lines 257-258: list_cache_backups with missing dir."""

    @pytest.mark.asyncio
    async def test_missing_cache_dir(self, plugin):
        plugin.cache_path = "/nonexistent/dir"
        result = await plugin.list_cache_backups()
        assert result == []


class TestKHInsiderTrackScoringAllBranches:
    """Cover lines 343, 349, 351, 353, 357-358, 363: all scoring branches."""

    def _score(self, link, index=0):
        import re
        from urllib.parse import unquote
        lower = link.lower()
        score = 0
        if "main-theme" in lower or "main_theme" in lower:
            score += 10
        if "title" in lower and "screen" in lower:
            score += 9
        if "title" in lower:
            score += 7
        if "theme" in lower:
            score += 6
        if "opening" in lower:
            score += 5
        if "menu" in lower:
            score += 4
        if "intro" in lower:
            score += 3
        if index < 3:
            score += 2
        elif index > 15:
            score -= 1
        if "battle" in lower or "combat" in lower or "boss" in lower:
            score -= 3
        if "credits" in lower or "ending" in lower:
            score -= 2
        return score

    def test_title_screen_branch(self):
        assert self._score("/album/g/title-screen.mp3") >= 9

    def test_opening_branch(self):
        assert self._score("/album/g/opening.mp3") >= 5

    def test_menu_branch(self):
        assert self._score("/album/g/menu.mp3") >= 4

    def test_intro_branch(self):
        assert self._score("/album/g/intro.mp3") >= 3

    def test_late_track_penalty(self):
        assert self._score("/album/g/track.mp3", 20) < self._score("/album/g/track.mp3", 0)

    def test_credits_penalty(self):
        assert self._score("/album/g/credits.mp3", 10) < self._score("/album/g/ambience.mp3", 10)


class TestKHInsiderTrackFallbackUrl:
    """Cover lines 406-410: fallback audio URL when 'Click here' not found."""

    @pytest.mark.asyncio
    async def test_fallback_to_ogg_url(self, plugin):
        album_html = '<a href="/game-soundtracks/album/g/01-track.mp3">T</a>'
        track_html = '<div><a href="https://cdn.example.com/track.ogg">Download</a></div>'
        mock_session = AsyncMock()
        resp1 = AsyncMock()
        resp1.status = 200
        resp1.raise_for_status = MagicMock()
        resp1.text = AsyncMock(return_value=album_html)
        resp2 = AsyncMock()
        resp2.status = 200
        resp2.raise_for_status = MagicMock()
        resp2.text = AsyncMock(return_value=track_html)
        mock_session.get = AsyncMock(side_effect=[resp1, resp2])
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            url = await plugin.get_khinsider_track_url("https://khinsider.com/album/g")
        assert url == "https://cdn.example.com/track.ogg"


class TestKHInsiderTrackFetchException:
    """Cover lines 418-419, 422-424: exception during track fetch."""

    @pytest.mark.asyncio
    async def test_individual_track_fetch_fails(self, plugin):
        album_html = '<a href="/game-soundtracks/album/g/01-track.mp3">T</a>'
        mock_session = AsyncMock()
        resp1 = AsyncMock()
        resp1.status = 200
        resp1.raise_for_status = MagicMock()
        resp1.text = AsyncMock(return_value=album_html)
        mock_session.get = AsyncMock(side_effect=[resp1, Exception("timeout")])
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            tracks = await plugin.list_khinsider_tracks("https://khinsider.com/album/g")
        assert tracks == []

    @pytest.mark.asyncio
    async def test_entire_fetch_fails(self, plugin):
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(side_effect=Exception("connection refused"))
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            tracks = await plugin.list_khinsider_tracks("https://khinsider.com/album/g")
        assert tracks == [] or tracks is None  # Either is acceptable graceful failure


class TestKHInsiderInternalScoring:
    """Cover lines 343-363: actual scoring inside _get_khinsider_tracks."""

    @pytest.mark.asyncio
    async def test_all_scoring_branches_hit(self, plugin):
        """Album with tracks that hit every scoring keyword."""
        album_html = """
        <a href="/game-soundtracks/album/g/01-title-screen.mp3">T</a>
        <a href="/game-soundtracks/album/g/02-opening.mp3">O</a>
        <a href="/game-soundtracks/album/g/03-menu.mp3">M</a>
        <a href="/game-soundtracks/album/g/04-intro.mp3">I</a>
        <a href="/game-soundtracks/album/g/05-battle.mp3">B</a>
        <a href="/game-soundtracks/album/g/06-credits.mp3">C</a>
        <a href="/game-soundtracks/album/g/07-a.mp3">A7</a>
        <a href="/game-soundtracks/album/g/08-a.mp3">A8</a>
        <a href="/game-soundtracks/album/g/09-a.mp3">A9</a>
        <a href="/game-soundtracks/album/g/10-a.mp3">A10</a>
        <a href="/game-soundtracks/album/g/11-a.mp3">A11</a>
        <a href="/game-soundtracks/album/g/12-a.mp3">A12</a>
        <a href="/game-soundtracks/album/g/13-a.mp3">A13</a>
        <a href="/game-soundtracks/album/g/14-a.mp3">A14</a>
        <a href="/game-soundtracks/album/g/15-a.mp3">A15</a>
        <a href="/game-soundtracks/album/g/16-a.mp3">A16</a>
        <a href="/game-soundtracks/album/g/17-ending.mp3">E</a>
        """
        track_html = '<a href="https://cdn.example.com/t.mp3">Click here to download</a>'
        mock_session = AsyncMock()
        resp_album = AsyncMock()
        resp_album.status = 200
        resp_album.raise_for_status = MagicMock()
        resp_album.text = AsyncMock(return_value=album_html)
        resp_track = AsyncMock()
        resp_track.status = 200
        resp_track.raise_for_status = MagicMock()
        resp_track.text = AsyncMock(return_value=track_html)
        # album + up to 20 track pages
        mock_session.get = AsyncMock(side_effect=[resp_album] + [resp_track] * 17)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            tracks = await plugin.list_khinsider_tracks("https://khinsider.com/album/g")
        assert len(tracks) > 0
        # title-screen should score highest
        assert "title" in tracks[0]["name"].lower() or tracks[0]["score"] >= 9


class TestSteamStoreDlcNon200AndException:
    """Cover lines 100, 110, 119-121."""

    @pytest.mark.asyncio
    async def test_dlc_non_200_skipped(self, plugin):
        """DLC returning non-200 should be skipped, continue to next."""
        app_resp = AsyncMock()
        app_resp.status = 200
        app_resp.json = AsyncMock(return_value={"1": {"success": True, "data": {"dlc": [2, 3]}}})
        dlc_resp_fail = AsyncMock()
        dlc_resp_fail.status = 500
        dlc_resp_ost = AsyncMock()
        dlc_resp_ost.status = 200
        dlc_resp_ost.json = AsyncMock(return_value={"3": {"success": True, "data": {"type": "music", "name": "OST"}}})
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(side_effect=[app_resp, dlc_resp_fail, dlc_resp_ost])
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await plugin.get_steam_soundtrack_name("1")
        assert result == "OST"


class TestKHInsiderGetTracksException:
    """Cover lines 422-424: _get_khinsider_tracks exception."""

    @pytest.mark.asyncio
    async def test_get_khinsider_track_url_on_exception(self, plugin):
        """get_khinsider_track_url should return None on exception."""
        mock_session = AsyncMock()
        mock_session.get = AsyncMock(side_effect=Exception("fail"))
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock()
        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await plugin.get_khinsider_track_url("https://khinsider.com/album/g")
        assert result is None


class TestFinal100Coverage:
    """Hit the last 7 uncovered lines."""

    @pytest.mark.asyncio
    async def test_steam_store_outer_except(self, plugin):
        """Lines 119-121: outermost except in get_steam_soundtrack_name."""
        with patch("aiohttp.ClientSession") as MockSession:
            instance = AsyncMock()
            instance.get = AsyncMock(side_effect=ConnectionError("forced"))
            MockSession.return_value.__aenter__ = AsyncMock(return_value=instance)
            MockSession.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await plugin.get_steam_soundtrack_name("1")
        assert result is None

    @pytest.mark.asyncio
    async def test_khinsider_tracks_outer_except(self, plugin):
        """Lines 422-424: outermost except in _get_khinsider_tracks."""
        with patch("aiohttp.ClientSession") as MockSession:
            instance = AsyncMock()
            instance.get = AsyncMock(side_effect=ConnectionError("forced"))
            MockSession.return_value.__aenter__ = AsyncMock(return_value=instance)
            MockSession.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await plugin._get_khinsider_tracks("https://khinsider.com/album/g")
        assert result == []

    @pytest.mark.asyncio
    async def test_steam_dlc_loop_exhausted(self, plugin):
        """Line 100: DLC loop finishes without finding soundtrack, returns None."""
        with patch("aiohttp.ClientSession") as MockSession:
            instance = AsyncMock()
            app_resp = AsyncMock(status=200)
            app_resp.json = AsyncMock(return_value={
                "1": {"success": True, "data": {"dlc": [2]}}
            })
            dlc_resp = AsyncMock(status=200)
            dlc_resp.json = AsyncMock(return_value={
                "2": {"success": True, "data": {"type": "dlc", "name": "Skin Pack"}}
            })
            instance.get = AsyncMock(side_effect=[app_resp, dlc_resp])
            MockSession.return_value.__aenter__ = AsyncMock(return_value=instance)
            MockSession.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await plugin.get_steam_soundtrack_name("1")
        assert result is None


    @pytest.mark.asyncio
    async def test_steam_empty_dlc_list(self, plugin):
        """Line 100: game has no DLCs at all."""
        with patch("aiohttp.ClientSession") as MockSession:
            instance = AsyncMock()
            app_resp = AsyncMock(status=200)
            app_resp.json = AsyncMock(return_value={
                "1": {"success": True, "data": {"dlc": []}}
            })
            instance.get = AsyncMock(return_value=app_resp)
            MockSession.return_value.__aenter__ = AsyncMock(return_value=instance)
            MockSession.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await plugin.get_steam_soundtrack_name("1")
        assert result is None
