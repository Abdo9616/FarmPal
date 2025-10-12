// commands/listservers.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('listservers')
    .setDescription('List all saved servers'),
  async executeSlash(interaction, savedServers) {
    const serverList = Object.entries(savedServers).map(([name, srv]) => 
      `${name}: ${srv.host}:${srv.port}${srv.username ? ` (username: ${srv.username})` : ''}`
    ).join('\n') || 'None';
    await interaction.editReply(`Saved servers:\n${serverList}`);
  },
  async executePrefix(message, savedServers) {
    const serverList = Object.entries(savedServers).map(([name, srv]) => 
      `${name}: ${srv.host}:${srv.port}${srv.username ? ` (username: ${srv.username})` : ''}`
    ).join('\n') || 'None';
    message.channel.send(`Saved servers:\n${serverList}`);
  }
};