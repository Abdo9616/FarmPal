// commands/listscheduled.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('listscheduled')
    .setDescription('List all scheduled connections'),
  async executeSlash(interaction, scheduledConnections) {
    if (Object.keys(scheduledConnections).length === 0) {
      await interaction.editReply("No scheduled connections.");
      return;
    }
    let result = "**Scheduled Connections:**\n";
    Object.values(scheduledConnections).forEach(conn => {
      const scheduledTime = new Date(conn.scheduledFor);
      const timeUntil = Math.max(0, scheduledTime - Date.now());
      const minutesLeft = Math.ceil(timeUntil / (60 * 1000));
      result += `• **${conn.serverName}** in ${minutesLeft} minutes (ID: ${conn.id})\n`;
    });
    await interaction.editReply(result);
  },
  async executePrefix(message, scheduledConnections) {
    if (Object.keys(scheduledConnections).length === 0) {
      message.channel.send("No scheduled connections.");
      return;
    }
    let result = "**Scheduled Connections:**\n";
    Object.values(scheduledConnections).forEach(conn => {
      const scheduledTime = new Date(conn.scheduledFor);
      const timeUntil = Math.max(0, scheduledTime - Date.now());
      const minutesLeft = Math.ceil(timeUntil / (60 * 1000));
      result += `• **${conn.serverName}** in ${minutesLeft} minutes (ID: ${conn.id})\n`;
    });
    message.channel.send(result);
  }
};