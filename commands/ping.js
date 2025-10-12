// commands/ping.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot\'s current ping to the server'),
  async executeSlash(interaction, mcBot) {
    if (!mcBot) {
      await interaction.editReply('Minecraft bot is not connected.');
      return;
    }
    const ping = mcBot.player ? mcBot.player.ping : 'Unknown';
    await interaction.editReply(`📶 Bot's current ping: ${ping}ms`);
  },
  async executePrefix(message, mcBot) {
    if (!mcBot) {
      message.channel.send('Minecraft bot is not connected.');
      return;
    }
    const ping = mcBot.player ? mcBot.player.ping : 'Unknown';
    message.channel.send(`📶 Bot's current ping: ${ping}ms`);
  }
};