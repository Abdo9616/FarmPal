const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Manage bot settings'),
  async executeSlash(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Bot Settings')
      .setDescription('Select the type of settings to manage.')
      .setColor(0x0099FF);

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('user_settings')
          .setLabel('User Settings')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('general_settings')
          .setLabel('General (Server) Settings')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.editReply({ embeds: [embed], components: [row], flags: 64 });
  },
  async executePrefix(message) {
    const embed = new EmbedBuilder()
      .setTitle('Bot Settings')
      .setDescription('Select the type of settings to manage.')
      .setColor(0x0099FF);

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('user_settings')
          .setLabel('User Settings')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('general_settings')
          .setLabel('General (Server) Settings')
          .setStyle(ButtonStyle.Secondary)
      );

    await message.reply({ embeds: [embed], components: [row] });
  }
};