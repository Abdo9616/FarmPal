// src/modules/presenceManager.js
const { ActivityType } = require("discord.js");

/**
 * Presence Manager
 * @param {import('discord.js').Client} client - Your Discord client
 * @param {Function} getStatus - Callback function that returns the current bot status
 */
function setupPresence(client, getStatus) {
  if (!client) throw new Error("Client is required for setupPresence.");
  if (!getStatus) throw new Error("getStatus callback is required for setupPresence.");

  let currentIndex = 0;

  const updatePresence = () => {
    const status = getStatus();
    let statuses = [];

    if (status.connected) {
      statuses = [
        { name: `Minecraft: Java Edition`, type: ActivityType.Playing },
        { name: `in ${status.serverName}`, type: ActivityType.Playing },
        { name: `with ${status.playerCount} players`, type: ActivityType.Playing },
        { name: `my ping is ${status.ping}ms`, type: ActivityType.Watching },
        { name: `v${process.env.VERSION || "1.0"}`, type: ActivityType.Playing }
      ];
    } else {
      statuses = [
        { name: `v${process.env.VERSION || "1.0"}`, type: ActivityType.Playing }
      ];
    }

    const current = statuses[currentIndex % statuses.length];
    client.user.setPresence({
      activities: [{ name: current.name, type: current.type }],
      status: "idle",
    });

    currentIndex = (currentIndex + 1) % statuses.length;
  };

  // Immediately set one, then rotate every 15 seconds
  updatePresence();
  setInterval(updatePresence, 15000);
}

module.exports = { setupPresence };