// cmdLogger.js
const colors = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

function logCommand(interaction) {
    const commandName = interaction.commandName;
    const user = interaction.user;
    const username = user.username;
    const userId = user.id;

    if (interaction.inGuild()) {
        const guild = interaction.guild;
        const channel = interaction.channel;
        const guildName = guild ? guild.name : 'Unknown Guild';
        const guildId = guild ? guild.id : 'Unknown ID';
        const channelName = channel ? channel.name : 'Unknown Channel';
        const channelId = channel ? channel.id : 'Unknown ID';

        console.log(`${colors.cyan}[COMMAND] /${commandName} used by ${username} (${userId}) in ${guildName} (${guildId}) channel: ${channelName} (${channelId})${colors.reset}`);
    } else {
        // DM command
        console.log(`${colors.magenta}[DM COMMAND] /${commandName} used by ${username} (${userId})${colors.reset}`);
    }
}

module.exports = { logCommand };