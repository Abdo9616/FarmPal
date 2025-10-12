// commands/connectioninfo.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('connectioninfo')
    .setDescription('Show current connection information'),
  async executeSlash(interaction, mcBot, connectionStartTime, savedServers, currentServerName, currentBotUsername) {
    if (!mcBot || !connectionStartTime) {
      await interaction.editReply('Minecraft bot is not connected.');
      return;
    }
    const serverInfo = savedServers[currentServerName];
    if (!serverInfo) {
      await interaction.editReply('Error: Could not retrieve server information.');
      return;
    }
    const now = new Date();
    const durationMs = now - connectionStartTime;
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((durationMs % (1000 * 60)) / 1000);
    const durationString = hours > 0 
      ? `${hours}h ${minutes}m ${seconds}s`
      : `${minutes}m ${seconds}s`;
    const connectionInfo = `**Connection Information:**
🌐 **Server:** ${currentServerName} (${serverInfo.host}:${serverInfo.port})
👤 **Username:** ${currentBotUsername}
⏰ **Connected Since:** ${connectionStartTime.toLocaleString()}
⏱️ **Duration:** ${durationString}`;
    await interaction.editReply(connectionInfo);
  },
  async executePrefix(message, mcBot, connectionStartTime, savedServers, currentServerName, currentBotUsername) {
    if (!mcBot || !connectionStartTime) {
      message.channel.send('Minecraft bot is not connected.');
      return;
    }
    const serverInfo = savedServers[currentServerName];
    if (!serverInfo) {
      message.channel.send('Error: Could not retrieve server information.');
      return;
    }
    const now = new Date();
    const durationMs = now - connectionStartTime;
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((durationMs % (1000 * 60)) / 1000);
    const durationString = hours > 0 
      ? `${hours}h ${minutes}m ${seconds}s`
      : `${minutes}m ${seconds}s`;
    const connectionInfo = `**Connection Information:**
🌐 **Server:** ${currentServerName} (${serverInfo.host}:${serverInfo.port})
👤 **Username:** ${currentBotUsername}
⏰ **Connected Since:** ${connectionStartTime.toLocaleString()}
⏱️ **Duration:** ${durationString}`;
    message.channel.send(connectionInfo);
  }
};