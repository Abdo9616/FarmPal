// commands/delcoords.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('delcoords')
    .setDescription('Delete saved coordinates')
    .addStringOption(option => option.setName('name').setDescription('Name of coordinates to delete').setRequired(true)),
  async executeSlash(interaction, savedCoords, saveData, COORDS_FILE) {
    const name = interaction.options.getString('name');
    if (!savedCoords[name]) {
      await interaction.editReply(`No coordinates saved under "${name}".`);
      return;
    }
    delete savedCoords[name];
    saveData(COORDS_FILE, savedCoords);
    await interaction.editReply(`Deleted coordinates "${name}".`);
  },
  async executePrefix(message, args, savedCoords, saveData, COORDS_FILE) {
    if (args.length < 1) {
      message.channel.send('Usage: !delcoords <name>');
      return;
    }
    const name = args.join(' ');
    if (!savedCoords[name]) {
      message.channel.send(`No coordinates saved under "${name}".`);
      return;
    }
    delete savedCoords[name];
    saveData(COORDS_FILE, savedCoords);
    message.channel.send(`Deleted coordinates "${name}".`);
  }
};