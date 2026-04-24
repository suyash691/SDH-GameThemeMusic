# Game Theme Music

[![Build](https://github.com/suyash691/SDH-GameThemeMusic/actions/workflows/build.yml/badge.svg)](https://github.com/suyash691/SDH-GameThemeMusic/actions/workflows/build.yml)
[![codecov](https://codecov.io/gh/suyash691/SDH-GameThemeMusic/graph/badge.svg)](https://codecov.io/gh/suyash691/SDH-GameThemeMusic)

Play theme songs on your game pages. Compatible with the [AudioLoader](https://github.com/EMERALD0874/SDH-AudioLoader) plugin (AudioLoader version >= 1.5.0).

## How it works

This plugin will find a game's theme music based on the game's name and play it in the background. It searches multiple sources in order:

1. **Steam Store** — checks if the game has an official soundtrack DLC
2. **KHInsider** — searches the game soundtrack database (100K+ soundtracks)
3. **YouTube** — falls back to YouTube via yt-dlp

An internet connection is required. It also supports non-Steam games.

The song that plays can be customised via the game's context menu.

![The song that plays can be customised via the games context menu.](./assets/screenshot2.jpg)

## Installation

This plugin requires [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader).

Install from the Decky plugin store, or download the latest release zip and install via Decky settings.
