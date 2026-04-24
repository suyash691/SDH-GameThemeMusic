from __future__ import annotations

import asyncio
import base64
import datetime
import json
import logging
import os
import platform
import re
import ssl

import aiohttp
import aiohttp.web
import certifi

import decky
from settings import SettingsManager  # type: ignore

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FILE_SERVER_PORT = 40510


def get_ytdlp_path() -> str:
    binary = "yt-dlp.exe" if platform.system() == "Windows" else "yt-dlp"
    return os.path.join(decky.DECKY_PLUGIN_DIR, "bin", binary)


class Plugin:
    yt_process: asyncio.subprocess.Process | None = None
    yt_process_lock = asyncio.Lock()
    music_path = f"{decky.DECKY_PLUGIN_RUNTIME_DIR}/music"
    cache_path = f"{decky.DECKY_PLUGIN_RUNTIME_DIR}/cache"
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    file_server_runner: aiohttp.web.AppRunner | None = None
    file_server_available: bool = False

    async def _start_file_server(self):
        os.makedirs(self.music_path, exist_ok=True)
        try:
            app = aiohttp.web.Application()
            app.router.add_static("/music", self.music_path)
            self.file_server_runner = aiohttp.web.AppRunner(app)
            await self.file_server_runner.setup()
            site = aiohttp.web.TCPSite(self.file_server_runner, "127.0.0.1", FILE_SERVER_PORT)
            await site.start()
            self.file_server_available = True
            logger.info(f"File server started on http://127.0.0.1:{FILE_SERVER_PORT}")
        except Exception as e:
            logger.warning(f"File server failed to start, falling back to base64: {e}")
            self.file_server_available = False

    async def _stop_file_server(self):
        if self.file_server_runner:
            await self.file_server_runner.cleanup()
            self.file_server_runner = None

    async def _main(self):
        logger.info("Initializing plugin...")
        self.settings = SettingsManager(
            name="config", settings_directory=decky.DECKY_PLUGIN_SETTINGS_DIR
        )
        await self._start_file_server()
        logger.info("Plugin initialized.")

    async def _unload(self):
        await self._stop_file_server()
        if self.yt_process is not None and self.yt_process.returncode is None:
            self.yt_process.terminate()
            async with self.yt_process_lock:
                try:
                    await asyncio.wait_for(self.yt_process.communicate(), timeout=5)
                except TimeoutError:
                    self.yt_process.kill()

    async def set_setting(self, key, value):
        self.settings.setSetting(key, value)

    async def get_setting(self, key, default):
        return self.settings.getSetting(key, default)

    # --- Steam Store API ---

    async def get_steam_soundtrack_name(self, app_id: str):
        """Query Steam Store API for official soundtrack DLC name."""
        try:
            url = f"https://store.steampowered.com/api/appdetails?appids={app_id}"
            async with aiohttp.ClientSession() as session:
                res = await session.get(url, ssl=self.ssl_context, timeout=aiohttp.ClientTimeout(total=10))
                if res.status != 200:
                    return None
                data = await res.json(content_type=None)
                app_data = data.get(str(app_id), {})
                if not app_data.get("success"):
                    return None
                dlcs = app_data.get("data", {}).get("dlc", [])
                if not dlcs:
                    return None
                # Check each DLC to find one that's a soundtrack
                for dlc_id in dlcs[:10]:
                    dlc_url = f"https://store.steampowered.com/api/appdetails?appids={dlc_id}"
                    dlc_res = await session.get(dlc_url, ssl=self.ssl_context, timeout=aiohttp.ClientTimeout(total=5))
                    if dlc_res.status != 200:
                        continue
                    dlc_data = await dlc_res.json(content_type=None)
                    dlc_info = dlc_data.get(str(dlc_id), {})
                    if not dlc_info.get("success"):
                        continue
                    dlc_detail = dlc_info.get("data", {})
                    dlc_type = dlc_detail.get("type", "")
                    dlc_name = dlc_detail.get("name", "")
                    # Steam marks soundtracks as type "music" or has "soundtrack" in name
                    if dlc_type == "music" or "soundtrack" in dlc_name.lower():
                        logger.info(f"Found Steam soundtrack DLC: {dlc_name}")
                        return dlc_name
                return None
        except Exception as e:
            logger.warning(f"Steam Store API lookup failed: {e}")
            return None

    # --- YouTube (yt-dlp) ---

    async def search_yt(self, term: str):
        ytdlp_path = get_ytdlp_path()
        if os.path.exists(ytdlp_path):
            os.chmod(ytdlp_path, 0o755)

        if self.yt_process is not None and self.yt_process.returncode is None:
            self.yt_process.terminate()
            async with self.yt_process_lock:
                await self.yt_process.communicate()

        self.yt_process = await asyncio.create_subprocess_exec(
            ytdlp_path,
            f"ytsearch10:{term}",
            "-j",
            "-f", "bestaudio",
            "--match-filters", f"duration<?{20*60}",
            stdout=asyncio.subprocess.PIPE,
            limit=10 * 1024**2,
            env={**os.environ, 'LD_LIBRARY_PATH': '/usr/lib:/usr/lib64:/lib:/lib64'},
        )

    async def next_yt_result(self):
        async with self.yt_process_lock:
            if (
                not self.yt_process
                or not (output := self.yt_process.stdout)
                or not (line := (await output.readline()).strip())
            ):
                return None
            entry = json.loads(line)
            return self.entry_to_info(entry)

    @staticmethod
    def entry_to_info(entry):
        return {
            "url": entry["url"],
            "title": entry["title"],
            "id": entry["id"],
            "thumbnail": entry["thumbnail"],
        }

    # --- Local file management ---

    def local_match(self, id: str) -> str | None:
        try:
            for file in os.listdir(self.music_path):
                if os.path.isfile(os.path.join(self.music_path, file)) and file.startswith(id + "."):
                    return os.path.join(self.music_path, file)
        except FileNotFoundError:
            pass
        return None

    def _local_url(self, filepath: str) -> str:
        filename = os.path.basename(filepath)
        return f"http://127.0.0.1:{FILE_SERVER_PORT}/music/{filename}"

    async def single_yt_url(self, id: str):
        local_match = self.local_match(id)
        if local_match:
            if self.file_server_available:
                return self._local_url(local_match)
            # Fallback: base64 data URL
            extension = local_match.split(".")[-1]
            with open(local_match, "rb") as file:
                return f"data:audio/{extension};base64,{base64.b64encode(file.read()).decode()}"

        ytdlp_path = get_ytdlp_path()
        result = await asyncio.create_subprocess_exec(
            ytdlp_path,
            f"{id}",
            "-j",
            "-f", "bestaudio",
            stdout=asyncio.subprocess.PIPE,
            env={**os.environ, 'LD_LIBRARY_PATH': '/usr/lib:/usr/lib64:/lib:/lib64'},
        )
        if result.stdout is None or not (output := (await result.stdout.read()).strip()):
            return None
        entry = json.loads(output)
        return entry["url"]

    async def download_yt_audio(self, id: str):
        if self.local_match(id):
            return
        ytdlp_path = get_ytdlp_path()
        process = await asyncio.create_subprocess_exec(
            ytdlp_path,
            f"{id}",
            "-f", "bestaudio",
            "-o", "%(id)s.%(ext)s",
            "-P", self.music_path,
            env={**os.environ, 'LD_LIBRARY_PATH': '/usr/lib:/usr/lib64:/lib:/lib64'},
        )
        await process.communicate()
        original_path = os.path.join(self.music_path, f"{id}.m4a")
        renamed_path = os.path.join(self.music_path, f"{id}.webm")
        if os.path.exists(original_path):
            os.rename(original_path, renamed_path)

    async def download_url(self, url: str, id: str):
        async with aiohttp.ClientSession() as session:
            res = await session.get(url, ssl=self.ssl_context)
            res.raise_for_status()
            file_path = os.path.join(self.music_path, f"{id}.webm")
            with open(file_path, "wb") as file:
                async for chunk in res.content.iter_chunked(1024):
                    file.write(chunk)

    async def clear_downloads(self):
        try:
            for file in os.listdir(self.music_path):
                full_path = os.path.join(self.music_path, file)
                if os.path.isfile(full_path):
                    os.remove(full_path)
        except FileNotFoundError:
            pass

    # --- Cache management ---

    async def export_cache(self, cache: dict):
        os.makedirs(self.cache_path, exist_ok=True)
        filename = f"backup-{datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}.json"
        full_path = os.path.join(self.cache_path, filename)
        with open(full_path, "w") as file:
            json.dump(cache, file)

    async def list_cache_backups(self):
        try:
            return [
                file.rsplit(".", 1)[0]
                for file in os.listdir(self.cache_path)
                if os.path.isfile(os.path.join(self.cache_path, file))
            ]
        except FileNotFoundError:
            return []

    async def import_cache(self, name: str):
        safe_name = os.path.basename(name)
        path = os.path.join(self.cache_path, f"{safe_name}.json")
        with open(path, "r") as file:
            return json.load(file)

    # --- KHInsider ---

    async def search_khinsider(self, game_name: str):
        """Search KHInsider for game soundtracks by name."""
        search_url = "https://downloads.khinsider.com/search"
        try:
            async with aiohttp.ClientSession() as session:
                res = await session.get(
                    search_url,
                    params={"search": game_name},
                    ssl=self.ssl_context,
                    timeout=aiohttp.ClientTimeout(total=10),
                )
                res.raise_for_status()
                html = await res.text()
            results = []
            for match in re.finditer(
                r'<a\s+href="(/game-soundtracks/album/[^"]+)"[^>]*>([^<]+)</a>',
                html,
            ):
                album_path, album_name = match.group(1), match.group(2).strip()
                if album_name:
                    results.append({
                        "name": album_name,
                        "url": f"https://downloads.khinsider.com{album_path}",
                        "trackCount": 0,
                    })
            return results[:10]
        except Exception as e:
            logger.warning(f"KHInsider search failed: {e}")
            return []

    async def get_khinsider_track_url(self, album_url: str):
        """Get the best playable track URL from a KHInsider album page."""
        tracks = await self._get_khinsider_tracks(album_url)
        if not tracks:
            return None
        # Return the highest scored track
        return tracks[0].get("audioUrl")

    async def list_khinsider_tracks(self, album_url: str):
        """List all tracks from a KHInsider album with resolved audio URLs."""
        return await self._get_khinsider_tracks(album_url)

    async def _get_khinsider_tracks(self, album_url: str):
        """Internal: fetch and score all tracks from a KHInsider album."""
        try:
            async with aiohttp.ClientSession() as session:
                res = await session.get(
                    album_url,
                    ssl=self.ssl_context,
                    timeout=aiohttp.ClientTimeout(total=10),
                )
                res.raise_for_status()
                html = await res.text()

                track_links = re.findall(
                    r'<a\s+href="(/game-soundtracks/album/[^"]+\.mp3)"',
                    html,
                )
                if not track_links:
                    return []

                # Deduplicate (KHInsider lists each track link twice)
                seen = set()
                unique_links = []
                for link in track_links:
                    if link not in seen:
                        seen.add(link)
                        unique_links.append(link)

                def track_score(link: str, index: int) -> int:
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
                    # Track position bonus (early tracks are more likely themes)
                    if index < 3:
                        score += 2
                    elif index > 15:
                        score -= 1
                    # Penalize non-theme tracks
                    if "battle" in lower or "combat" in lower or "boss" in lower:
                        score -= 3
                    if "credits" in lower or "ending" in lower:
                        score -= 2
                    return score

                def track_name(link: str) -> str:
                    """Extract a readable name from the track URL."""
                    from urllib.parse import unquote
                    filename = link.rsplit("/", 1)[-1].rsplit(".", 1)[0]
                    name = unquote(unquote(filename))  # Double decode for double-encoded URLs
                    name = name.replace("-", " ").replace("_", " ")
                    # Strip leading track numbers like "01 " or "01. "
                    name = re.sub(r"^\d{1,3}[\.\s]+", "", name).strip()
                    return name if name else filename

                tracks = []
                for i, link in enumerate(unique_links):
                    score = track_score(link, i)
                    tracks.append({
                        "name": track_name(link),
                        "path": link,
                        "score": score,
                        "trackPageUrl": f"https://downloads.khinsider.com{link}",
                    })

                tracks.sort(key=lambda t: -t["score"])

                # Resolve audio URL for top tracks (limit to avoid too many requests)
                result = []
                for track in tracks[:20]:
                    try:
                        res2 = await session.get(
                            track["trackPageUrl"],
                            ssl=self.ssl_context,
                            timeout=aiohttp.ClientTimeout(total=10),
                        )
                        res2.raise_for_status()
                        track_html = await res2.text()

                        audio_match = re.search(
                            r'<a\s+[^>]*href="(https://[^"]+\.mp3)"[^>]*>Click here to download',
                            track_html,
                        )
                        audio_url = audio_match.group(1) if audio_match else None
                        if not audio_url:
                            fallback = re.search(
                                r'href="(https://[^"]+\.(?:mp3|ogg|flac))"',
                                track_html,
                            )
                            audio_url = fallback.group(1) if fallback else None

                        if audio_url:
                            result.append({
                                "name": track["name"],
                                "audioUrl": audio_url,
                                "score": track["score"],
                            })
                    except Exception:
                        continue

                return result
        except Exception as e:
            logger.warning(f"KHInsider track fetch failed: {e}")
            return []

    async def clear_cache(self):
        try:
            for file in os.listdir(self.cache_path):
                full_path = os.path.join(self.cache_path, file)
                if os.path.isfile(full_path):
                    os.remove(full_path)
        except FileNotFoundError:
            pass
