// commands/players.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('players')
    .setDescription('List online players'),
  async executeSlash(interaction, mcBot) {
    if (!mcBot) {
      await interaction.editReply('Minecraft bot is not connected.');
      return;
    }
    const players = Object.keys(mcBot.players).filter(p => p !== mcBot.username);
    await interaction.editReply(`Online players (${players.length}): ${players.join(', ') || 'None'}`);
  },
  async executePrefix(message, mcBot) {
    if (!mcBot) {
      message.channel.send('Minecraft bot is not connected.');
      return;
    }
    const players = Object.keys(mcBot.players).filter(p => p !== mcBot.username);
    message.channel.send(`Online players (${players.length}): ${players.join(', ') || 'None'}`);
  }
};