// commands/coords.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('coords')
    .setDescription('Save coordinates with a name')
    .addStringOption(option => option.setName('coordinates').setDescription('Coordinates in format: x y z').setRequired(true))
    .addStringOption(option => option.setName('name').setDescription('Name for coordinates').setRequired(true)),
  async executeSlash(interaction, savedCoords, saveData, COORDS_FILE) {
    const coordStr = interaction.options.getString('coordinates');
    const name = interaction.options.getString('name');
    const coords = coordStr.trim().split(/\s+/);
    if (coords.length !== 3) {
      await interaction.editReply('Invalid coordinates format. Use: x y z');
      return;
    }
    const x = parseFloat(coords[0]);
    const y = parseFloat(coords[1]);
    const z = parseFloat(coords[2]);
    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      await interaction.editReply('Invalid coordinates. Must be numbers.');
      return;
    }
    savedCoords[name] = { x, y, z };
    saveData(COORDS_FILE, savedCoords);
    await interaction.editReply(`Saved coordinates "${name}" at (${x}, ${y}, ${z}).`);
  },
  async executePrefix(message, args, savedCoords, saveData, COORDS_FILE) {
    if (args.length < 4) {
      message.channel.send('Usage: !coords <x> <y> <z> <name>');
      return;
    }
    const x = parseFloat(args[0]);
    const y = parseFloat(args[1]);
    const z = parseFloat(args[2]);
    const name = args.slice(3).join(' ');
    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      message.channel.send('Invalid coordinates.');
      return;
    }
    savedCoords[name] = { x, y, z };
    saveData(COORDS_FILE, savedCoords);
    message.channel.send(`Saved coordinates "${name}" at (${x}, ${y}, ${z}).`);
  }
};