// commands/listcoords.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('listcoords')
    .setDescription('List all saved coordinates'),
  async executeSlash(interaction, savedCoords) {
    const coordList = Object.entries(savedCoords).map(([name, coord]) => 
      `${name}: (${coord.x}, ${coord.y}, ${coord.z})`
    ).join('\n') || 'None';
    await interaction.editReply(`Saved coordinates:\n${coordList}`);
  },
  async executePrefix(message, savedCoords) {
    const coordList = Object.entries(savedCoords).map(([name, coord]) => 
      `${name}: (${coord.x}, ${coord.y}, ${coord.z})`
    ).join('\n') || 'None';
    message.channel.send(`Saved coordinates:\n${coordList}`);
  }
};