// commands/jump.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('jump')
    .setDescription('Make the bot jump'),
  async executeSlash(interaction, mcBot) {
    if (!mcBot) {
      await interaction.editReply('Minecraft bot is not connected.');
      return;
    }
    mcBot.setControlState('jump', true);
    setTimeout(() => mcBot.setControlState('jump', false), 300);
    await interaction.editReply('Bot jumped.');
  },
  async executePrefix(message, mcBot) {
    if (!mcBot) {
      message.channel.send('Minecraft bot is not connected.');
      return;
    }
    mcBot.setControlState('jump', true);
    setTimeout(() => mcBot.setControlState('jump', false), 300);
    message.channel.send('Bot jumped.');
  }
};