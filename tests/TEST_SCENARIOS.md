# Test Scenarios — SDH-GameThemeMusic

## What the plugin should do (user perspective)

### Core: Auto-play theme music on game pages
1. When I navigate to a game page, theme music should start playing automatically
2. Music should fade in smoothly (not abrupt start)
3. When I leave the game page, music should fade out smoothly
4. If I have AudioLoader installed, its music should pause while theme music plays
5. If no theme music is found, nothing should play (no errors)

### Core: Music source resolution (tiered)
6. Plugin should first check Steam Store for official soundtrack DLC name
7. If found, use that name to search KHInsider for the actual track
8. If not found via Steam, search KHInsider directly by game name
9. If KHInsider has no results, fall back to YouTube search
10. YouTube search should prefer results with "official soundtrack main theme" in query
11. KHInsider should prefer tracks named "Title", "Main Theme", "Menu", "Opening", "Intro"

### Core: Per-game overrides
12. User can manually select a different track for any game
13. User can select "No Music" to silence a specific game
14. Manual selections should persist across restarts (cached in localforage)
15. User can search YouTube or KHInsider when manually selecting

### Settings
16. Volume slider should control playback volume (0-100%)
17. "Default Muted" should prevent auto-play on games without manual overrides
18. "Use yt-dlp" toggle should switch between Invidious and yt-dlp for YouTube
19. "Download Audio" should save tracks locally for offline playback
20. Custom Invidious instance URL should be usable alongside the dropdown list
21. Per-game volume should override global volume

### Cache/Backup
22. User can export all overrides as a backup
23. User can import a backup to restore overrides
24. User can delete all overrides
25. User can delete all downloaded audio files

### Backend: File serving
26. Downloaded audio should be served via local HTTP server (not base64)
27. Local server should only bind to 127.0.0.1 (no network exposure)

### Backend: Security
28. Cache import should not allow path traversal (../../etc/passwd)

### Backend: yt-dlp
29. yt-dlp binary should be made executable before use
30. If yt-dlp downloads m4a format, it should be renamed to .webm
31. Previous yt-dlp search process should be terminated before starting new one

### Error handling
32. If KHInsider is down, plugin should gracefully fall back to YouTube
33. If all music sources fail, game page should still load normally
34. Plugin should not crash the Steam UI if it fails to load
