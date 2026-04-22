import asyncio
import base64
import datetime
import json
import os
import ssl
import aiohttp
import certifi
import logging
import platform
import shutil

import decky
from settings import SettingsManager  # type: ignore

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_ytdlp_path() -> str:
    binary = "yt-dlp.exe" if platform.system() == "Windows" else "yt-dlp"
    return os.path.join(decky.DECKY_PLUGIN_DIR, "bin", binary)


class Plugin:
    yt_process: asyncio.subprocess.Process | None = None
    yt_process_lock = asyncio.Lock()
    music_path = f"{decky.DECKY_PLUGIN_RUNTIME_DIR}/music"
    cache_path = f"{decky.DECKY_PLUGIN_RUNTIME_DIR}/cache"
    ssl_context = ssl.create_default_context(cafile=certifi.where())

    async def _main(self):
        logger.info("Initializing plugin...")
        self.settings = SettingsManager(
            name="config", settings_directory=decky.DECKY_PLUGIN_SETTINGS_DIR
        )
        logger.info("Settings loaded.")

    async def _unload(self):
        if self.yt_process is not None and self.yt_process.returncode is None:
            logger.info("Terminating yt_process...")
            self.yt_process.terminate()
            async with self.yt_process_lock:
                try:
                    await asyncio.wait_for(self.yt_process.communicate(), timeout=5)
                except TimeoutError:
                    logger.warning("yt_process timeout. Killing process.")
                    self.yt_process.kill()

    async def set_setting(self, key, value):
        logger.info(f"Setting config key: {key} = {value}")
        self.settings.setSetting(key, value)

    async def get_setting(self, key, default):
        value = self.settings.getSetting(key, default)
        logger.info(f"Retrieved config key: {key} = {value}")
        return value

    async def search_yt(self, term: str):
        logger.info(f"Searching YouTube for: {term}")
        ytdlp_path = get_ytdlp_path()
        if os.path.exists(ytdlp_path):
            os.chmod(ytdlp_path, 0o755)

        if self.yt_process is not None and self.yt_process.returncode is None:
            logger.info("Terminating previous yt_process...")
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
            env={**os.environ, 'LD_LIBRARY_PATH': '/usr/lib:/lib'},
        )
        logger.info("yt-dlp search process started.")

    async def next_yt_result(self):
        async with self.yt_process_lock:
            if (
                not self.yt_process
                or not (output := self.yt_process.stdout)
                or not (line := (await output.readline()).strip())
            ):
                logger.info("No more results from yt_process.")
                return None
            logger.debug(f"Received result line: {line[:100]}...")
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

    def local_match(self, id: str) -> str | None:
        logger.info(f"Looking for local match for ID: {id}")
        try:
            for file in os.listdir(self.music_path):
                if os.path.isfile(os.path.join(self.music_path, file)) and file.startswith(id + "."):
                    logger.info(f"Local match found: {file}")
                    return os.path.join(self.music_path, file)
        except FileNotFoundError:
            logger.warning(f"Music path not found: {self.music_path}")
        logger.info("No local match found.")
        return None

    async def single_yt_url(self, id: str):
        local_match = self.local_match(id)
        if local_match:
            extension = local_match.split(".")[-1]
            logger.info(f"Serving base64 encoded audio from local file: {local_match}")
            with open(local_match, "rb") as file:
                return f"data:audio/{extension};base64,{base64.b64encode(file.read()).decode()}"

        logger.info(f"No local file. Fetching yt-dlp info for: {id}")
        ytdlp_path = get_ytdlp_path()
        result = await asyncio.create_subprocess_exec(
            ytdlp_path,
            f"{id}",
            "-j",
            "-f", "bestaudio",
            stdout=asyncio.subprocess.PIPE,
            env={**os.environ, 'LD_LIBRARY_PATH': '/usr/lib:/lib'},
        )
        if result.stdout is None or not (output := (await result.stdout.read()).strip()):
            logger.warning("yt-dlp returned no output.")
            return None
        entry = json.loads(output)
        return entry["url"]

    async def download_yt_audio(self, id: str):
        if self.local_match(id):
            logger.info(f"Audio already downloaded for ID: {id}")
            return

        logger.info(f"Downloading audio for ID: {id}")
        ytdlp_path = get_ytdlp_path()
        process = await asyncio.create_subprocess_exec(
            ytdlp_path,
            f"{id}",
            "-f", "bestaudio",
            "-o", "%(id)s.%(ext)s",
            "-P", self.music_path,
            env={**os.environ, 'LD_LIBRARY_PATH': '/usr/lib:/lib'},
        )
        await process.communicate()

        original_path = os.path.join(self.music_path, f"{id}.m4a")
        renamed_path = os.path.join(self.music_path, f"{id}.webm")
        if os.path.exists(original_path):
            logger.info(f"Renaming {original_path} to {renamed_path}")
            os.rename(original_path, renamed_path)

    async def download_url(self, url: str, id: str):
        logger.info(f"Downloading file from URL: {url}")
        async with aiohttp.ClientSession() as session:
            res = await session.get(url, ssl=self.ssl_context)
            res.raise_for_status()
            file_path = os.path.join(self.music_path, f"{id}.webm")
            with open(file_path, "wb") as file:
                async for chunk in res.content.iter_chunked(1024):
                    file.write(chunk)
            logger.info(f"Download complete: {file_path}")

    async def clear_downloads(self):
        logger.info("Clearing all downloaded music files...")
        try:
            for file in os.listdir(self.music_path):
                full_path = os.path.join(self.music_path, file)
                if os.path.isfile(full_path):
                    logger.info(f"Removing file: {full_path}")
                    os.remove(full_path)
        except FileNotFoundError:
            logger.warning(f"Music path not found: {self.music_path}")

    async def export_cache(self, cache: dict):
        os.makedirs(self.cache_path, exist_ok=True)
        filename = f"backup-{datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}.json"
        full_path = os.path.join(self.cache_path, filename)
        with open(full_path, "w") as file:
            json.dump(cache, file)
        logger.info(f"Cache exported to {full_path}")

    async def list_cache_backups(self):
        logger.info("Listing cache backup files...")
        try:
            return [
                file.rsplit(".", 1)[0]
                for file in os.listdir(self.cache_path)
                if os.path.isfile(os.path.join(self.cache_path, file))
            ]
        except FileNotFoundError:
            logger.warning(f"Cache path not found: {self.cache_path}")
            return []

    async def import_cache(self, name: str):
        path = os.path.join(self.cache_path, f"{name}.json")
        logger.info(f"Importing cache from {path}")
        with open(path, "r") as file:
            return json.load(file)

    async def search_khinsider(self, game_name: str):
        """Search KHInsider for game soundtracks by name."""
        logger.info(f"Searching KHInsider for: {game_name}")
        search_url = "https://downloads.khinsider.com/search"
        try:
            async with aiohttp.ClientSession() as session:
                res = await session.get(
                    search_url,
                    params={"search": game_name},
                    ssl=self.ssl_context,
                )
                res.raise_for_status()
                html = await res.text()
            results = []
            # Parse search results table rows: <a href="/game-soundtracks/album/SLUG">NAME</a>
            import re
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
            logger.info(f"KHInsider found {len(results)} results")
            return results[:10]
        except Exception as e:
            logger.warning(f"KHInsider search failed: {e}")
            return []

    async def get_khinsider_track_url(self, album_url: str):
        """Get the first playable track URL from a KHInsider album page.
        Looks for 'Title', 'Main Theme', or 'Main Menu' tracks first, else first track."""
        logger.info(f"Fetching KHInsider album: {album_url}")
        try:
            import re
            async with aiohttp.ClientSession() as session:
                res = await session.get(album_url, ssl=self.ssl_context)
                res.raise_for_status()
                html = await res.text()
            # Extract track links: <a href="/game-soundtracks/album/SLUG/TRACK.mp3">
            track_links = re.findall(
                r'<a\s+href="(/game-soundtracks/album/[^"]+\.mp3)"',
                html,
            )
            if not track_links:
                logger.info("No tracks found on album page")
                return None

            # Prefer theme-like tracks
            preferred = None
            for link in track_links:
                lower = link.lower()
                if any(
                    kw in lower
                    for kw in ["title", "main-theme", "main_theme", "menu", "opening", "intro"]
                ):
                    preferred = link
                    break
            chosen = preferred or track_links[0]

            # Fetch the track page to get the actual audio URL
            track_page_url = f"https://downloads.khinsider.com{chosen}"
            res2 = await session.get(track_page_url, ssl=self.ssl_context)
            res2.raise_for_status()
            track_html = await res2.text()

            # Find the actual audio file link
            audio_match = re.search(
                r'<a\s+[^>]*href="(https://[^"]+\.mp3)"[^>]*>Click here to download',
                track_html,
            )
            if audio_match:
                audio_url = audio_match.group(1)
                logger.info(f"KHInsider audio URL: {audio_url}")
                return audio_url
            logger.info("Could not extract audio URL from track page")
            return None
        except Exception as e:
            logger.warning(f"KHInsider track fetch failed: {e}")
            return None

    async def clear_cache(self):
        logger.info("Clearing all cache files...")
        try:
            for file in os.listdir(self.cache_path):
                full_path = os.path.join(self.cache_path, file)
                if os.path.isfile(full_path):
                    logger.info(f"Removing file: {full_path}")
                    os.remove(full_path)
        except FileNotFoundError:
            logger.warning(f"Cache path not found: {self.cache_path}")