// commands/worldinfo.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('worldinfo')
    .setDescription('Get current world and dimension information'),
  async executeSlash(interaction, mcBot, currentWorldName, currentDimension) {
    if (!mcBot) {
      await interaction.editReply('Minecraft bot is not connected.');
      return;
    }
    const worldInfo = `**World Information:**
🌍 **World:** ${currentWorldName || 'Unknown'}
🧭 **Dimension:** ${currentDimension || 'Unknown'}
📍 **Position:** X: ${Math.floor(mcBot.entity.position.x)}, Y: ${Math.floor(mcBot.entity.position.y)}, Z: ${Math.floor(mcBot.entity.position.z)}
⏰ **Time:** ${mcBot.time.timeOfDay} (${mcBot.time.isDay ? 'Day' : 'Night'})`;
    await interaction.editReply(worldInfo);
  },
  async executePrefix(message, mcBot, currentWorldName, currentDimension) {
    if (!mcBot) {
      message.channel.send('Minecraft bot is not connected.');
      return;
    }
    const worldInfo = `**World Information:**
🌍 **World:** ${currentWorldName || 'Unknown'}
🧭 **Dimension:** ${currentDimension || 'Unknown'}
📍 **Position:** X: ${Math.floor(mcBot.entity.position.x)}, Y: ${Math.floor(mcBot.entity.position.y)}, Z: ${Math.floor(mcBot.entity.position.z)}
⏰ **Time:** ${mcBot.time.timeOfDay} (${mcBot.time.isDay ? 'Day' : 'Night'})`;
    message.channel.send(worldInfo);
  }
};