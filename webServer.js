const express = require('express');
const os = require('os');

function startServer(discordClient, botStartTime, port = 3000) {
  const app = express();

  app.get('/health', (req, res) => {
    const discordAPIStatus = discordClient.ws.status === 0; // Check if the bot is connected to Discord API
    const freeMemory = os.freemem();
    const totalMemory = os.totalmem();
    const memoryUsage = ((totalMemory - freeMemory) / totalMemory) * 100; // Memory usage percentage
    const systemUptime = os.uptime(); // System uptime in seconds
    const botUptime = Math.floor((Date.now() - botStartTime) / 1000); // Bot uptime in seconds

    const isSystemHealthy = freeMemory > 100 * 1024 * 1024 && systemUptime > 60; // Example thresholds

    const healthStatus = {
      status: 'online',
      timestamp: Math.floor(Date.now() / 1000),
      checks: {
        discordAPI: discordAPIStatus,
        systemResources: isSystemHealthy,
        memoryUsage: `${memoryUsage.toFixed(2)}%`, // Include memory usage details
        botUptime: `${Math.floor(botUptime / 60)} minutes`, // Bot uptime in minutes
        systemUptime: `${Math.floor(systemUptime / 60)} minutes` // System uptime in minutes
      }
    };

    // Set status to degraded if any check fails
    if (!discordAPIStatus || !isSystemHealthy) {
      healthStatus.status = 'degraded';
    }

    const statusCode = healthStatus.status === 'online' ? 200 : 503;
    res.status(statusCode).json(healthStatus);
  });

  app.listen(port, () => {
    console.log(`✅ Health check server running on port: \x1b[34m${port}\x1b[0m`);
  });
}

module.exports = startServer;