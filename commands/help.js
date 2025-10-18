const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');

const PAGE_SIZE = 10; // Adjust to 10-15 as needed; 10 fits well for readability without overwhelming the embed

const categories = {
  connection: {
    title: '🌐 Connection & Server Commands',
    commands: [
      { name: '!addserver', desc: 'Add a new server to the saved list', usage: '!addserver <name> <host> <port> [username] [password]' },
      { name: '/listservers', desc: 'List all saved servers', usage: '/listservers' },
      { name: '!connect', desc: 'Connect to a saved server', usage: '!connect <server_name>' },
      { name: '!disconnect or !dc', desc: 'Disconnect from the current server', usage: '!disconnect' },
      { name: '!offline', desc: 'Set the bot to offline mode for connections', usage: '!offline' },
      { name: '!scheduleconnect', desc: 'Schedule a connection to a server', usage: '!scheduleconnect <server_name> <minutes>' },
      { name: '!cancelschedule', desc: 'Cancel a scheduled connection', usage: '!cancelschedule <connection_id>' },
      { name: '!cancelreconnect', desc: 'Cancel automatic reconnection and clear last session', usage: '!cancelreconnect' },
      { name: '/connectioninfo', desc: 'Show current connection information', usage: '/connectioninfo' },
      { name: '/listscheduled', desc: 'List all scheduled connections', usage: '/listscheduled' },
    ]
  },
  coordinates: {
    title: '📍 Coordinate Management Commands',
    commands: [
      { name: '/coords', desc: 'Save coordinates with a name', usage: '/coords <coordinates> <name> (coordinates: x y z)' },
      { name: '/listcoords', desc: 'List all saved coordinates', usage: '/listcoords' },
      { name: '!delcoords', desc: 'Delete saved coordinates by name', usage: '!delcoords <name>' },
      { name: '!goto', desc: 'Move the bot to saved coordinates or specific position', usage: '!goto <name> or !goto <x> <y> <z>' },
    ]
  },
  movement: {
    title: '🚶 Movement & Navigation Commands',
    commands: [
      { name: '!move', desc: 'Move the bot in a direction', usage: '!move <forward/back/left/right> [distance]' },
      { name: '/jump', desc: 'Make the bot jump', usage: '/jump' },
      { name: '/stop', desc: 'Stop bot movement', usage: '/stop' },
      { name: '!afk', desc: 'Set the bot to AFK mode', usage: '!afk' },
    ]
  },
  status: {
    title: '📊 Status & Information Commands',
    commands: [
      { name: '/players', desc: 'List online players on the server', usage: '/players' },
      { name: '/health', desc: "Check bot's health and hunger status", usage: '/health' },
      { name: '/ping', desc: "Check bot's ping to the server", usage: '/ping' },
      { name: '/worldinfo', desc: 'Get current world and dimension information', usage: '/worldinfo' },
    ]
  },
  inventory: {
    title: '🎒 Inventory & Item Commands',
    commands: [
      { name: '!inventory', desc: 'Show the bot\'s inventory', usage: '!inventory' },
      { name: '!switchslot', desc: 'Switch to a specific hotbar slot', usage: '!switchslot <slot_number>' },
      { name: '!hotbar', desc: 'Show the bot\'s hotbar', usage: '!hotbar' },
      { name: '!dropitem', desc: 'Drop an item from inventory', usage: '!dropitem <item_name> [count]' },
      { name: '!equip', desc: 'Equip an item', usage: '!equip <item_name> <slot>' },
      { name: '!eat', desc: 'Make the bot eat food', usage: '!eat' },
    ]
  },
  interaction: {
    title: '💬 Interaction & Chat Commands',
    commands: [
      { name: '!interact', desc: 'Interact with a nearby entity or block', usage: '!interact' },
      { name: '!say', desc: 'Make the bot say a message in chat', usage: '!say <message>' },
      { name: '!command or !cmd', desc: 'Execute a Minecraft command as the bot', usage: '!command <mc_command>' },
      { name: '!respawn', desc: 'Respawn the bot if dead', usage: '!respawn' },
    ]
  },
  logging: {
    title: '📝 Logging Commands',
    commands: [
      { name: '!setlogchannel', desc: 'Set the Discord channel for logs', usage: '!setlogchannel' },
      { name: '!stoplog', desc: 'Stop logging to the channel', usage: '!stoplog' },
      { name: '!startlog', desc: 'Start logging to the channel', usage: '!startlog' },
      { name: '!togglelog', desc: 'Toggle Discord logging for specific types', usage: '!togglelog <type> <on/off> (types: time, damage, death, path, chat, ping, connection, resources)' },
      { name: '!toggleingamelog', desc: 'Toggle in-game logging for specific types', usage: '!toggleingamelog <type> <on/off> (types: time, damage, death, attack, sleep)' },
    ]
  },
  settings: {
    title: '⚙️ Settings Commands',
    commands: [
      { name: '/settings', desc: 'Manage bot settings', usage: '/settings' },
    ]
  },
};

module.exports = {
  builder: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Display help information for all commands'),
  async executeSlash(interaction) {

    const initialEmbed = new EmbedBuilder()
      .setTitle('Help Menu')
      .setDescription('Select a category from the menu below to view commands.')
      .setColor(0x0099FF);

    const select = new StringSelectMenuBuilder()
      .setCustomId('help_category')
      .setPlaceholder('Select a category')
      .addOptions(
        Object.entries(categories).map(([key, value]) => 
          new StringSelectMenuOptionBuilder()
            .setLabel(value.title)
            .setValue(key)
        )
      );

    const menuRow = new ActionRowBuilder().addComponents(select);

    const reply = await interaction.editReply({ embeds: [initialEmbed], components: [menuRow], fetchReply: true });

    const filter = i => i.user.id === interaction.user.id;
    const collector = reply.createMessageComponentCollector({ filter, time: 300000 }); // 5 minutes

    let currentCategory = null;
    let currentPage = 0;

    collector.on('collect', async i => {
      try {
        await i.deferUpdate();
      } catch (error) {
        if (error.code === 'InteractionAlreadyReplied') {
          console.log('Component interaction already deferred; proceeding.');
        } else {
          throw error;
        }
      }

      if (i.customId === 'help_category') {
        currentCategory = i.values[0];
        currentPage = 0;
        await updatePage(i, currentCategory, currentPage);
      } else if (i.customId === 'help_prev' && currentCategory) {
        currentPage = Math.max(0, currentPage - 1);
        await updatePage(i, currentCategory, currentPage);
      } else if (i.customId === 'help_next' && currentCategory) {
        currentPage += 1;
        await updatePage(i, currentCategory, currentPage);
      } else if (i.customId === 'help_back') {
        currentCategory = null;
        await i.editReply({ embeds: [initialEmbed], components: [menuRow] });
      }
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
  async executePrefix(message) {
    message.channel.send('The help command is only available as a slash command (/help).');
  }
};

async function updatePage(i, categoryKey, page) {
  const category = categories[categoryKey];
  const commands = category.commands;
  const totalPages = Math.ceil(commands.length / PAGE_SIZE);
  page = Math.min(Math.max(page, 0), totalPages - 1);

  const start = page * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageCommands = commands.slice(start, end);

  const embed = new EmbedBuilder()
    .setTitle(`${category.title} - Page ${page + 1} of ${totalPages}`)
    .setDescription('Commands in this category:')
    .setColor(0x00FF00);

  pageCommands.forEach(cmd => {
    embed.addFields({
      name: cmd.name,
      value: `**Description:** ${cmd.desc}\n**Usage:** ${cmd.usage}`,
      inline: false
    });
  });

  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('help_prev')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('help_next')
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === totalPages - 1 || commands.length <= PAGE_SIZE),
      new ButtonBuilder()
        .setCustomId('help_back')
        .setLabel('Back to Categories')
        .setStyle(ButtonStyle.Primary)
    );

  await i.editReply({ embeds: [embed], components: [buttonRow] });
}