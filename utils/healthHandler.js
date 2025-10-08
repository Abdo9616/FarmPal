const startServer = require('../webServer'); // Import the web server

function initializeHealthServer(discordClient) {
  const PORT = process.env.PORT || 3000;
  const botStartTime = Date.now(); // Record the bot's start time
  startServer(discordClient, botStartTime, PORT); // Pass the bot's start time to the server
}

module.exports = initializeHealthServer;