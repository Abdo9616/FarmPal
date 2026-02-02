# FarmPal

A Mineflayer-based Minecraft bot controllable through Discord.

> **Repo:** FarmPal — a Discord-controllable Mineflayer bot for farming and simple automation in Minecraft.

---



## About

FarmPal is a Node.js project that runs a Mineflayer Minecraft bot you can control from Discord. It is intended to automate farming/pathfinding tasks and expose basic bot control through Discord messages and (optionally) a small web server for monitoring purposes.
> [!NOTE]
> Currently the bot supports basic pathfinding, afking utilities and offline account only (no microsoft auth). More features may be added in the future.
> [!TIP]
> If you want to contribute features or fix issues, feel free to open a PR.

> [!WARNING]
> Warning: Don't use this bot on servers or hosts that disallow bots or automation, as it may lead to bans. (e.p. Aternos free hosting ) Use at your own risk.

## Features

* Connects a Mineflayer bot to a Minecraft server.
* Control the bot through a Discord bot (send commands from a channel or DM).
* Pathfinding & basic farming utilities (uses mineflayer pathfinding under the hood).
* Small web server is included (`webServer.js`) for optional status monitoring (e.g., uptime monitoring services like UptimeRobot).


---

## Requirements

* Node.js (16+ recommended)
* npm or yarn
* A Discord application with a bot token + ID.
* Access to a Minecraft server (IP/host and port). Compatible Minecraft version should match Mineflayer's supported versions used by the project (Basically check the Mineflayer documentation for supported versions and update accordingly, it should work without issues on each minecraft update).

---

## Installation

1. Clone the repo:

```bash
git clone https://github.com/Abdo9616/FarmPal.git
cd FarmPal
```

2. Install dependencies:

```bash
npm install
# or
# yarn
```

3. Configure environment variables (see next section).

---

## Configuration

Copy `.env.example` to `.env` and fill in the values. Typical variables used by Mineflayer + Discord bots in this kind of project are shown below — use the repo's `.env.example` as the authoritative list and adjust as needed:

```env
# Discord
DISCORD_TOKEN=your_discord_bot_token

APPLICATION_ID= # Your Discord application ID

DISCORD_CHANNEL_IDS= # Comma-separated list of Discord channel IDs where the bot will respond to commands

PREFIX=!            # command prefix used by the 



# Optional
WEB_PORT= # Port for the webServer ( health check to be monitored by external services like uptimerobot, Default is 3000).

bot_timezone= # The general timezone the bot will use (e.p. Console logging time). Set to 'system' to use the system's timezone, or specify a timezone like 'America/New_York'. Default is 'UTC'.

CONSOLE_LOG_DIR= # CONSOLE_LOG_DIR=./my-custom-logs  # Path to the base log directory (absolute or relative to project root). Default: ./console logs

DEFAULT_PREFIX= # Default command prefix for the bot (e.p. '!' or '?', Default is '!').

PORT= # Port for the webServer ( health check to be monitored by external services like uptimerobot, Default is 3000)
```

**Important:** Always keep tokens and passwords secret — do not commit `.env` to version control.

---

## Running

Start the bot with Node.js. Depending on the package.json scripts the project provides you can run:

```bash
# If package.json contains a start script
npm start
# or directly
node index.js
```
---

## Discord commands

Once the bot is running and connected to both Discord and the Minecraft server, you can control it through Discord messages. The bot listens for commands prefixed with the configured prefix (default `!`). Example commands include:

* `!addserver <name> <host> <port> [username]` — add a Minecraft server to the bot's known list (Username refers to the Minecraft account name the bot will use to connect).
* `!connect <name>` — tell the bot to join a specified server or area
* `!coords <coordinates> <name> (coordinates: x y z)` - Save coordinates with a name.
* `!goto <name>` — move the bot to coordinates you pre-defined by `!coords <name>`
* `!listcoords` — list saved coordinates with their names.
*For more commands, refer to `/help` command in Discord after starting the bot.*

> These are example commands. See `commands/` in the repository for the real command list and usage.


---

## Troubleshooting

* If the bot fails to login to Discord, double-check `DISCORD_TOKEN` and bot invite permissions (bot needs at least `Send Messages`, `Read Messages/View Channels`, and `Embed Links` for richer messages).
* If Mineflayer fails to connect, re-check the server info you added if its correct or not. For Microsoft-auth servers, There's no support yet. (Double check the mineflayer version support for the Minecraft version you are trying to connect to, [Mineflayer](https://github.com/PrismarineJS/mineflayer)).
* Check the console logs for error messages. Logs may be found in the directory specified by `CONSOLE_LOG_DIR` if set.
---

## Contributing

Contributions are welcome. Open an issue or PR. If you add features, please update this README and `.env.example` to keep configuration accurate.

---

## License

This project is licensed under the MIT License. See the `LICENSE` file in the repository.

---
