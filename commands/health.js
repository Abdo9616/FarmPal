// commands/health.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('health')
    .setDescription('Check bot\'s health and hunger status'),
  async executeSlash(interaction, mcBot) {
    if (!mcBot) {
      await interaction.editReply('Minecraft bot is not connected.');
      return;
    }
    const healthStatus = `**Health Status:**
❤️ Health: ${mcBot.health}/20
🍖 Food: ${mcBot.food}/20
⚡ Saturation: ${mcBot.foodSaturation.toFixed(1)}`;
    await interaction.editReply(healthStatus);
  },
  async executePrefix(message, mcBot) {
    if (!mcBot) {
      message.channel.send('Minecraft bot is not connected.');
      return;
    }
    const healthStatus = `**Health Status:**
❤️ Health: ${mcBot.health}/20
🍖 Food: ${mcBot.food}/20
⚡ Saturation: ${mcBot.foodSaturation.toFixed(1)}`;
    message.channel.send(healthStatus);
  }
};