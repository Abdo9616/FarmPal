// commands/stop.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop bot movement'),
  async executeSlash(interaction, mcBot) {
    if (!mcBot) {
      await interaction.editReply('Minecraft bot is not connected.');
      return;
    }
    mcBot.clearControlStates();
    await interaction.editReply('Stopped movement.');
  },
  async executePrefix(message, mcBot) {
    if (!mcBot) {
      message.channel.send('Minecraft bot is not connected.');
      return;
    }
    mcBot.clearControlStates();
    message.channel.send('Stopped movement.');
  }
};