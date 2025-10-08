require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const fs = require('fs');

const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

let mcBot = null;
let logChannel = null;
const COMMAND_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
let disconnectTimer = null;
let currentTarget = null; // Track current combat target
let lastTimeState = null; // Track last time state to prevent spam

// File paths for persistent data
const SERVERS_FILE = 'servers.json';
const COORDS_FILE = 'coords.json';
const SETTINGS_FILE = 'settings.json';

// Load persistent data
function loadData(file) {
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      console.log(`Loaded data from ${file}`);
      return data;
    }
  } catch (error) {
    console.error(`Error loading data from ${file}:`, error);
  }
  return {};
}

function saveData(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`Successfully saved data to ${file}`);
  } catch (error) {
    console.error(`Error saving data to ${file}:`, error);
  }
}

let savedServers = loadData(SERVERS_FILE);
let savedCoords = loadData(COORDS_FILE);
let settings = loadData(SETTINGS_FILE);

// Initialize settings with proper defaults
if (!settings.logChannelId) {
  settings.logChannelId = null;
  settings.loggingEnabled = false;
  saveData(SETTINGS_FILE, settings);
}

// Initialize log channel from settings
if (settings.logChannelId && settings.loggingEnabled) {
  discordClient.channels.fetch(settings.logChannelId)
    .then(channel => {
      logChannel = channel;
      console.log(`Log channel set to: ${channel.name}`);
    })
    .catch(error => {
      console.error('Failed to fetch log channel:', error);
      logChannel = null;
    });
}

let antiAfkIntervals = [];
let pingIntervals = [];

function startAntiAfk() {
  antiAfkIntervals.push(setInterval(() => {
    if (mcBot) {
      const yaw = mcBot.entity.yaw + Math.PI / 2;
      mcBot.entity.yaw = yaw;
      mcBot.entity.pitch = Math.random() * 0.2 - 0.1;
    }
  }, 5000));
  antiAfkIntervals.push(setInterval(() => {
    if (mcBot) {
      mcBot.setControlState('jump', true);
      setTimeout(() => mcBot.setControlState('jump', false), 300);
    }
  }, 10000));
  antiAfkIntervals.push(setInterval(() => {
    if (mcBot) {
      mcBot.setControlState('sneak', true);
      setTimeout(() => mcBot.setControlState('sneak', false), 1000);
    }
  }, 15000));
  antiAfkIntervals.push(setInterval(() => {
    if (mcBot) mcBot.swingArm();
  }, 2000));
}

function stopAntiAfk() {
  antiAfkIntervals.forEach(interval => clearInterval(interval));
  antiAfkIntervals = [];
}

// Ping monitoring function
function startPingMonitoring() {
  // Clear any existing intervals
  stopPingMonitoring();
  
  // Check ping every 30 seconds
  const pingInterval = setInterval(() => {
    if (mcBot && mcBot.player) {
      const ping = mcBot.player.ping;
      
      // Log high ping (over 500ms)
      if (ping > 500 && logChannel) {
        logChannel.send(`⚠️ High ping alert: ${ping}ms`).catch(console.error);
      }
      
      // Random chance to log normal ping (about 20% chance)
      if (Math.random() < 0.2 && logChannel) {
        logChannel.send(`📊 Current ping: ${ping}ms`).catch(console.error);
      }
    }
  }, 30000);
  
  pingIntervals.push(pingInterval);
}

function stopPingMonitoring() {
  pingIntervals.forEach(interval => clearInterval(interval));
  pingIntervals = [];
}

async function connectToServer(serverName, username, connectTime, replyCallback) {
  if (mcBot) {
    replyCallback('Minecraft bot is already connected.');
    return;
  }
  const server = savedServers[serverName];
  if (!server) {
    replyCallback(`No server saved under "${serverName}". Use !addserver or /addserver first.`);
    return;
  }
  
  // Use the provided username or the saved username
  const botUsername = username || server.username || 'AFKBot';
  
  try {
    mcBot = mineflayer.createBot({
      host: server.host,
      port: server.port,
      username: botUsername,
      auth: 'offline',
      version: false
    });

    // Load plugin but don't set up movements until spawn
    mcBot.loadPlugin(pathfinder);

    mcBot.once('spawn', () => {
      // Set up movements after spawn
      const defaultMovements = new Movements(mcBot);
      mcBot.pathfinder.setMovements(defaultMovements);
      
      if (logChannel) {
        logChannel.send(`Minecraft bot connected to ${server.host}:${server.port} as ${mcBot.username}.`).catch(console.error);
      }
      
      // Start ping monitoring
      startPingMonitoring();
      
      if (connectTime) {
        const ms = connectTime * 60 * 1000;
        disconnectTimer = setTimeout(() => {
          if (mcBot) mcBot.quit();
          mcBot = null;
          stopPingMonitoring();
          if (logChannel) logChannel.send(`Auto-disconnected after ${connectTime} minutes.`).catch(console.error);
        }, ms);
        if (logChannel) logChannel.send(`Set to auto-disconnect in ${connectTime} minutes.`).catch(console.error);
      }
    });

    // Add this error handler for log channel messages
    const safeLogSend = (message) => {
      if (logChannel) {
        logChannel.send(message).catch(error => {
          console.error('Failed to send message to log channel:', error);
        });
      }
    };

    // Update all logChannel.send calls to use safeLogSend
    mcBot.on('chat', (username, msg) => {
      if (username !== mcBot.username) {
        safeLogSend(`[MC Chat] ${username}: ${msg}`);
      }
    });

    mcBot.on('kicked', (reason) => {
      // Fix for [object Object] issue - convert to string
      const reasonString = typeof reason === 'object' ? JSON.stringify(reason) : reason;
      safeLogSend(`Kicked from server: ${reasonString}`);
      stopAntiAfk();
      stopPingMonitoring();
      mcBot = null;
    });

    mcBot.on('error', (err) => {
      safeLogSend(`Error: ${err.message}`);
      stopAntiAfk();
      stopPingMonitoring();
      mcBot = null;
    });

    mcBot.on('path_update', (results) => {
      if (results.status === 'noPath') {
        safeLogSend('Cannot reach the target coordinates.');
      }
    });

    mcBot.on('goal_reached', () => {
      safeLogSend('Reached the target coordinates.');
    });

    mcBot.on('health', () => {
      if (mcBot.health < 10) safeLogSend(`Alert: Bot health low (${mcBot.health}/20)!`);
      if (mcBot.food < 10) safeLogSend(`Alert: Bot hunger low (${mcBot.food}/20)!`);
    });

    mcBot.on('entityHurt', (entity) => {
      if (entity === mcBot.entity) {
        safeLogSend('Alert: Bot is taking damage!');
        // Find who attacked us
        const attacker = Object.values(mcBot.entities).find(e => 
          e !== mcBot.entity && 
          e.position && 
          mcBot.entity.position.distanceTo(e.position) < 5
        );
        if (attacker) {
          mcBot.chat(`I'm being attacked by ${attacker.displayName || attacker.name}!`);
        }
      } else if (currentTarget && entity === currentTarget) {
        // We're attacking our target
        mcBot.chat(`Attacking ${entity.displayName || entity.name}!`);
      }
    });

    mcBot.on('death', () => {
      safeLogSend('Alert: Bot has died! Use !respawn or /respawn to respawn.');
      stopAntiAfk();
      stopPingMonitoring();
      mcBot.chat('I died!');
    });

    mcBot.on('respawn', () => {
      safeLogSend('Bot has respawned.');
      // Restart ping monitoring after respawn
      startPingMonitoring();
      mcBot.chat('I respawned!');
    });

    // Fix time spam - only log when time actually changes
    mcBot.on('time', () => {
      const isDay = mcBot.time.isDay;
      if (lastTimeState !== isDay) {
        lastTimeState = isDay;
        if (isDay) {
          safeLogSend('Time update: Daytime has begun.');
          mcBot.chat('Daytime has begun!');
        } else {
          safeLogSend('Time update: Nighttime has begun.');
          mcBot.chat('Nighttime has begun!');
        }
      }
    });

    replyCallback(`Connecting to ${server.host}:${server.port} as ${botUsername}...`);
  } catch (err) {
    replyCallback(`Connection failed: ${err.message}`);
  }
}

// Add the eatFood function
async function eatFood() {
  if (!mcBot) return false;
  
  // Don't eat if already full
  if (mcBot.food >= 20) return false;
  
  // Find food in inventory
  const foodItems = mcBot.inventory.items().filter(item => 
    item.name.includes('apple') ||
    item.name.includes('bread') ||
    item.name.includes('carrot') ||
    item.name.includes('potato') ||
    item.name.includes('beef') ||
    item.name.includes('chicken') ||
    item.name.includes('pork') ||
    item.name.includes('fish') ||
    item.name.includes('berry') ||
    item.name.includes('melon') ||
    item.name.includes('cookie') ||
    item.name.includes('cake') ||
    item.name === 'mushroom_stew' ||
    item.name === 'rabbit_stew' ||
    item.name === 'beetroot_soup' ||
    item.name === 'pumpkin_pie'
  );
  
  if (foodItems.length === 0) return false;
  
  // Sort by food value (simplified - just use the first available food)
  const food = foodItems[0];
  
  try {
    // Equip the food
    await mcBot.equip(food, 'hand');
    
    // Eat until full
    while (mcBot.food < 20) {
      await mcBot.consume();
      // Wait a bit between eating actions
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return true;
  } catch (error) {
    console.error('Error eating food:', error);
    return false;
  }
}

const commands = [
  new SlashCommandBuilder()
  .setName('addserver')
  .setDescription('Add a server to the saved list')
  .addStringOption(option => option.setName('name').setDescription('Server name').setRequired(true))
  .addStringOption(option => option.setName('host').setDescription('Server host').setRequired(true))
  .addIntegerOption(option => option.setName('port').setDescription('Server port').setRequired(true))
  .addStringOption(option => option.setName('username').setDescription('Bot username for this server').setRequired(false)),
  new SlashCommandBuilder()
    .setName('listservers')
    .setDescription('List all saved servers'),
  new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Connect to a saved server')
    .addStringOption(option => option.setName('server_name').setDescription('Saved server name').setRequired(true))
    .addStringOption(option => option.setName('username').setDescription('Custom username').setRequired(false))
    .addIntegerOption(option => option.setName('minutes').setDescription('Auto-disconnect after minutes').setRequired(false)),
  new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Disconnect the Minecraft bot'),
  new SlashCommandBuilder()
    .setName('offline')
    .setDescription('Set a timer to disconnect the bot')
    .addIntegerOption(option => option.setName('minutes').setDescription('Minutes until disconnect').setRequired(true)),
  new SlashCommandBuilder()
    .setName('setlogchannel')
    .setDescription('Set the channel for game logs and alerts')
    .addStringOption(option => option.setName('channel_id').setDescription('Channel ID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('stoplog')
    .setDescription('Stop sending game logs and alerts'),
  new SlashCommandBuilder()
    .setName('startlog')
    .setDescription('Resume sending game logs to the command channel')
    .addStringOption(option => option.setName('channel_id').setDescription('Channel ID (optional if already set)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('respawn')
    .setDescription('Respawn the bot after death'),
  new SlashCommandBuilder()
    .setName('interact')
    .setDescription('Interact with entities or items')
    .addStringOption(option => option.setName('type').setDescription('Interaction type').setRequired(true)
      .addChoices(
        { name: 'mount', value: 'mount' },
        { name: 'dismount', value: 'dismount' },
        { name: 'use', value: 'use' },
        { name: 'attack', value: 'attack' },
        { name: 'sleep', value: 'sleep' },
        { name: 'wake', value: 'wake' }
      )),
  new SlashCommandBuilder()
    .setName('players')
    .setDescription('List online players'),
  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Send a chat message in Minecraft')
    .addStringOption(option => option.setName('message').setDescription('Message to send').setRequired(true)),
  new SlashCommandBuilder()
    .setName('command')
    .setDescription('Execute a server command')
    .addStringOption(option => option.setName('cmd').setDescription('Command to execute').setRequired(true)),
  new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move the bot')
    .addStringOption(option => option.setName('direction').setDescription('Direction to move').setRequired(true)
      .addChoices(
        { name: 'forward', value: 'forward' },
        { name: 'back', value: 'back' },
        { name: 'left', value: 'left' },
        { name: 'right', value: 'right' }
      )),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop bot movement'),
  new SlashCommandBuilder()
    .setName('jump')
    .setDescription('Make the bot jump'),
  new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Toggle AFK mode')
    .addStringOption(option => option.setName('mode').setDescription('Enable or disable AFK').setRequired(true)
      .addChoices(
        { name: 'on', value: 'on' },
        { name: 'off', value: 'off' }
      )),
  new SlashCommandBuilder()
    .setName('coords')
    .setDescription('Save coordinates with a name')
    .addNumberOption(option => option.setName('x').setDescription('X coordinate').setRequired(true))
    .addNumberOption(option => option.setName('y').setDescription('Y coordinate').setRequired(true))
    .addNumberOption(option => option.setName('z').setDescription('Z coordinate').setRequired(true))
    .addStringOption(option => option.setName('name').setDescription('Name for coordinates').setRequired(true)),
  new SlashCommandBuilder()
    .setName('goto')
    .setDescription('Go to saved coordinates')
    .addStringOption(option => option.setName('name').setDescription('Name of saved coordinates').setRequired(true)),
  new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('View the bot\'s entire inventory'),
  new SlashCommandBuilder()
    .setName('switchslot')
    .setDescription('Switch items between inventory slots')
    .addIntegerOption(option => option.setName('from_slot').setDescription('Source slot (0-35)').setRequired(true))
    .addIntegerOption(option => option.setName('to_slot').setDescription('Destination slot (0-35)').setRequired(true)),
  new SlashCommandBuilder()
    .setName('hotbar')
    .setDescription('Switch to a specific hotbar slot (0-8)')
    .addIntegerOption(option => option.setName('slot').setDescription('Hotbar slot (0-8)').setRequired(true)),
  new SlashCommandBuilder()
    .setName('dropitem')
    .setDescription('Drop items from inventory')
    .addIntegerOption(option => option.setName('slot').setDescription('Slot number (0-35)').setRequired(true))
    .addIntegerOption(option => option.setName('count').setDescription('Number of items to drop').setRequired(false)),
  new SlashCommandBuilder()
    .setName('equip')
    .setDescription('Equip an item from inventory')
    .addIntegerOption(option => option.setName('slot').setDescription('Slot number (0-35)').setRequired(true)),
  new SlashCommandBuilder()
    .setName('health')
    .setDescription('Check bot\'s health and hunger status'),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot\'s current ping to the server'),
  // Add the eat command
  new SlashCommandBuilder()
    .setName('eat')
    .setDescription('Find and eat food to restore hunger'),
];

async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.APPLICATION_ID), {
      body: commands
    });
    console.log('Successfully registered slash commands.');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
}

discordClient.on('ready', () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}`);
  // Initialize log channel from saved settings
  if (settings.logChannelId && settings.loggingEnabled) {
    discordClient.channels.fetch(settings.logChannelId)
      .then(channel => {
        logChannel = channel;
        console.log(`Log channel set to: ${channel.name}`);
      })
      .catch(error => {
        console.error('Failed to fetch log channel:', error);
        logChannel = null;
      });
  }
  registerSlashCommands();
});

discordClient.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand() || interaction.channel.id !== COMMAND_CHANNEL_ID) return;
  await interaction.deferReply();

  const { commandName, options } = interaction;

  switch (commandName) {
    case 'addserver':
      const serverName = options.getString('name');
      const host = options.getString('host');
      const port = options.getInteger('port');
      const username = options.getString('username'); // Get username if provided
      savedServers[serverName] = { host, port, username };
      saveData(SERVERS_FILE, savedServers);
      await interaction.editReply(`Saved server "${serverName}" as ${host}:${port}${username ? ` with username ${username}` : ''}.`);
      break;

      case 'listservers':
        const serverList = Object.entries(savedServers).map(([name, srv]) => 
          `${name}: ${srv.host}:${srv.port}${srv.username ? ` (username: ${srv.username})` : ''}`
        ).join('\n') || 'None';
        await interaction.editReply(`Saved servers:\n${serverList}`);
        break;

    case 'connect':
      await connectToServer(options.getString('server_name'), options.getString('username'), options.getInteger('minutes'), async (msg) => {
        await interaction.editReply(msg);
      });
      break;

    case 'disconnect':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      if (disconnectTimer) clearTimeout(disconnectTimer);
      stopAntiAfk();
      stopPingMonitoring();
      mcBot.quit();
      mcBot = null;
      await interaction.editReply('Minecraft bot disconnected.');
      break;

    case 'offline':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      const offlineTime = options.getInteger('minutes');
      if (isNaN(offlineTime) || offlineTime <= 0) {
        await interaction.editReply('Please provide a valid number of minutes.');
        return;
      }
      if (disconnectTimer) clearTimeout(disconnectTimer);
      const ms = offlineTime * 60 * 1000;
      disconnectTimer = setTimeout(() => {
        if (mcBot) mcBot.quit();
        stopAntiAfk();
        stopPingMonitoring();
        mcBot = null;
        if (logChannel) logChannel.send(`Auto-disconnected after ${offlineTime} minutes.`).catch(console.error);
      }, ms);
      await interaction.editReply(`Set to disconnect in ${offlineTime} minutes.`);
      break;

    case 'setlogchannel':
      const newChannelId = options.getString('channel_id');
      const newChannel = discordClient.channels.cache.get(newChannelId);
      if (!newChannel) {
        await interaction.editReply('Invalid channel ID.');
        return;
      }
      logChannel = newChannel;
      settings.logChannelId = newChannelId;
      settings.loggingEnabled = true;
      saveData(SETTINGS_FILE, settings);
      await interaction.editReply(`Log channel set to <#${newChannelId}>.`);
      break;

    case 'stoplog':
      settings.loggingEnabled = false;
      saveData(SETTINGS_FILE, settings);
      logChannel = null;
      await interaction.editReply('Stopped sending game logs and alerts.');
      break;

    case 'startlog':
      if (options.getString('channel_id')) {
        const newChannelId = options.getString('channel_id');
        const newChannel = discordClient.channels.cache.get(newChannelId);
        if (!newChannel) {
          await interaction.editReply('Invalid channel ID.');
          return;
        }
        logChannel = newChannel;
        settings.logChannelId = newChannelId;
      } else if (settings.logChannelId) {
        const channel = discordClient.channels.cache.get(settings.logChannelId);
        if (channel) {
          logChannel = channel;
        } else {
          await interaction.editReply('Saved log channel not found. Use /setlogchannel first.');
          return;
        }
      } else {
        logChannel = discordClient.channels.cache.get(COMMAND_CHANNEL_ID);
        settings.logChannelId = COMMAND_CHANNEL_ID;
      }
      
      settings.loggingEnabled = true;
      saveData(SETTINGS_FILE, settings);
      await interaction.editReply(`Started sending game logs to <#${settings.logChannelId}>.`);
      break;

    case 'respawn':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      mcBot.respawn();
      await interaction.editReply('Attempting to respawn the bot.');
      break;

    case 'interact':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      const interactType = options.getString('type');
      switch (interactType) {
        case 'mount':
          // Find the nearest mountable entity (horses, donkeys, etc.)
          const mountableEntities = Object.values(mcBot.entities).filter(e => 
            e !== mcBot.entity && 
            mcBot.entity.position.distanceTo(e.position) < 4 && 
            (e.displayName && e.displayName.toLowerCase().includes('horse') || 
             e.displayName && e.displayName.toLowerCase().includes('donkey') || 
             e.displayName && e.displayName.toLowerCase().includes('mule') ||
             e.name && e.name.toLowerCase().includes('boat') || 
             e.name && e.name.toLowerCase().includes('minecart'))
          );
          
          if (mountableEntities.length > 0) {
            // Sort by distance and mount the closest one
            mountableEntities.sort((a, b) => 
              mcBot.entity.position.distanceTo(a.position) - mcBot.entity.position.distanceTo(b.position)
            );
            mcBot.mount(mountableEntities[0]);
            await interaction.editReply(`Mounted ${mountableEntities[0].displayName || mountableEntities[0].name}.`);
          } else {
            await interaction.editReply('No mountable entity nearby (e.g., horse, donkey, boat, minecart).');
          }
          break;
        case 'dismount':
          if (mcBot.vehicle) {
            mcBot.dismount();
            await interaction.editReply('Dismounted.');
          } else {
            await interaction.editReply('Not currently mounted on anything.');
          }
          break;
        case 'use':
          mcBot.activateItem();
          await interaction.editReply('Used/activated held item.');
          break;
        case 'attack':
          // Find the nearest attackable entity (mobs)
          const attackableEntities = Object.values(mcBot.entities).filter(e => 
            e !== mcBot.entity && 
            e.type === 'mob' && 
            mcBot.entity.position.distanceTo(e.position) < 4
          );
          
          if (attackableEntities.length > 0) {
            // Sort by distance and attack the closest one
            attackableEntities.sort((a, b) => 
              mcBot.entity.position.distanceTo(a.position) - mcBot.entity.position.distanceTo(b.position)
            );
            currentTarget = attackableEntities[0];
            mcBot.attack(currentTarget);
            await interaction.editReply(`Attacking nearest mob: ${currentTarget.displayName || currentTarget.name}.`);
            mcBot.chat(`Attacking ${currentTarget.displayName || currentTarget.name}!`);
          } else {
            await interaction.editReply('No attackable entity nearby.');
          }
          break;
        case 'sleep':
          // Find a bed block nearby
          const bedBlock = mcBot.findBlock({
            matching: block => block.name.includes('bed'),
            maxDistance: 4
          });
          
          if (bedBlock) {
            try {
              await mcBot.sleep(bedBlock);
              await interaction.editReply('Sleeping in the bed.');
              mcBot.chat('Good night!');
            } catch (err) {
              await interaction.editReply(`Cannot sleep: ${err.message}`);
            }
          } else {
            await interaction.editReply('No bed found nearby.');
          }
          break;
        case 'wake':
          if (mcBot.isSleeping) {
            mcBot.wake();
            await interaction.editReply('Woke up from bed.');
            mcBot.chat('Good morning!');
          } else {
            await interaction.editReply('Not currently sleeping.');
          }
          break;
      }
      break;

    case 'players':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      const players = Object.keys(mcBot.players).filter(p => p !== mcBot.username);
      await interaction.editReply(`Online players (${players.length}): ${players.join(', ') || 'None'}`);
      break;

    case 'say':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      const sayMsg = options.getString('message');
      mcBot.chat(sayMsg);
      await interaction.editReply(`Sent in chat: ${sayMsg}`);
      break;

    case 'command':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      const cmd = options.getString('cmd');
      // Use the correct method to execute server commands
      mcBot.chat(`/${cmd}`);
      await interaction.editReply(`Executed command: /${cmd}`);
      break;

    case 'move':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      const direction = options.getString('direction');
      mcBot.setControlState(direction, true);
      await interaction.editReply(`Moving ${direction}.`);
      break;

    case 'stop':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      mcBot.clearControlStates();
      await interaction.editReply('Stopped movement.');
      break;

    case 'jump':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      mcBot.setControlState('jump', true);
      setTimeout(() => mcBot.setControlState('jump', false), 300);
      await interaction.editReply('Bot jumped.');
      break;

    case 'afk':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      const afkMode = options.getString('mode');
      if (afkMode === 'on') {
        startAntiAfk();
        await interaction.editReply('Anti-AFK enabled.');
      } else {
        stopAntiAfk();
        await interaction.editReply('Anti-AFK disabled.');
      }
      break;

    case 'coords':
      const x = options.getNumber('x');
      const y = options.getNumber('y');
      const z = options.getNumber('z');
      const name = options.getString('name');
      savedCoords[name] = { x, y, z };
      saveData(COORDS_FILE, savedCoords);
      await interaction.editReply(`Saved coordinates "${name}" at (${x}, ${y}, ${z}).`);
      break;

    case 'goto':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      const gotoName = options.getString('name');
      const coord = savedCoords[gotoName];
      if (!coord) {
        await interaction.editReply(`No coordinates saved under "${gotoName}".`);
        return;
      }
      const goal = new GoalNear(coord.x, coord.y, coord.z, 1);
      mcBot.pathfinder.setGoal(goal);
      await interaction.editReply(`Heading to "${gotoName}" at (${coord.x}, ${coord.y}, ${coord.z}).`);
      break;

    case 'inventory':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      
      let inventoryText = '**Bot Inventory:**\n';
      inventoryText += '**Hotbar (0-8):**\n';
      
      // Display hotbar (slots 0-8)
      for (let i = 0; i < 9; i++) {
        const item = mcBot.inventory.slots[i];
        inventoryText += `[${i}] ${item ? `${item.count}x ${item.displayName || item.name}` : 'Empty'}\n`;
      }
      
      inventoryText += '\n**Main Inventory (9-35):**\n';
      
      // Display main inventory (slots 9-35)
      for (let i = 9; i < 36; i++) {
        const item = mcBot.inventory.slots[i];
        if (item) {
          inventoryText += `[${i}] ${item.count}x ${item.displayName || item.name}\n`;
        }
      }
      
      // Display armor slots
      inventoryText += '\n**Armor:**\n';
      const armorSlots = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
      for (let i = 0; i < 4; i++) {
        const item = mcBot.inventory.slots[i + 36]; // Armor slots are 36-39
        inventoryText += `${armorSlots[i]}: ${item ? `${item.count}x ${item.displayName || item.name}` : 'Empty'}\n`;
      }
      
      // Display offhand slot (if available)
      if (mcBot.inventory.slots[45]) { // Offhand is slot 45
        const offhand = mcBot.inventory.slots[45];
        inventoryText += `Offhand: ${offhand.count}x ${offhand.displayName || offhand.name}\n`;
      }
      
      await interaction.editReply(inventoryText);
      break;

    case 'switchslot':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      
      const fromSlot = options.getInteger('from_slot');
      const toSlot = options.getInteger('to_slot');
      
      if (fromSlot < 0 || fromSlot > 35 || toSlot < 0 || toSlot > 35) {
        await interaction.editReply('Slot numbers must be between 0 and 35.');
        return;
      }
      
      try {
        // Swap items between slots
        await mcBot.swapSlots(fromSlot, toSlot);
        await interaction.editReply(`Swapped items from slot ${fromSlot} to slot ${toSlot}.`);
      } catch (error) {
        await interaction.editReply(`Failed to swap items: ${error.message}`);
      }
      break;

    case 'hotbar':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      
      const hotbarSlot = options.getInteger('slot');
      
      if (hotbarSlot < 0 || hotbarSlot > 8) {
        await interaction.editReply('Hotbar slot must be between 0 and 8.');
        return;
      }
      
      try {
        // Set the selected hotbar slot
        mcBot.setQuickBarSlot(hotbarSlot);
        const currentItem = mcBot.inventory.slots[hotbarSlot];
        await interaction.editReply(`Selected hotbar slot ${hotbarSlot}: ${currentItem ? currentItem.displayName || currentItem.name : 'Empty'}`);
      } catch (error) {
        await interaction.editReply(`Failed to select hotbar slot: ${error.message}`);
      }
      break;

    case 'dropitem':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      
      const dropSlot = options.getInteger('slot');
      const dropCount = options.getInteger('count') || 1;
      
      if (dropSlot < 0 || dropSlot > 35) {
        await interaction.editReply('Slot number must be between 0 and 35.');
        return;
      }
      
      try {
        // Drop items from the specified slot
        await mcBot.toss(dropSlot, dropCount);
        await interaction.editReply(`Dropped ${dropCount} item(s) from slot ${dropSlot}.`);
      } catch (error) {
        await interaction.editReply(`Failed to drop items: ${error.message}`);
      }
      break;

    case 'equip':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      
      const equipSlot = options.getInteger('slot');
      
      if (equipSlot < 0 || equipSlot > 35) {
        await interaction.editReply('Slot number must be between 0 and 35.');
        return;
      }
      
      try {
        const item = mcBot.inventory.slots[equipSlot];
        if (!item) {
          await interaction.editReply('No item in the specified slot.');
          return;
        }
        
        // Check if it's armor and equip it
        if (item.name.includes('helmet') || item.name.includes('chestplate') || 
            item.name.includes('leggings') || item.name.includes('boots')) {
          await mcBot.equip(item, 'hand');
          await interaction.editReply(`Equipped ${item.displayName || item.name} from slot ${equipSlot}.`);
        } else {
          await interaction.editReply('Item is not equipable armor.');
        }
      } catch (error) {
        await interaction.editReply(`Failed to equip item: ${error.message}`);
      }
      break;

    case 'health':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      
      const healthStatus = `**Health Status:**
        ❤️ Health: ${mcBot.health}/20
        🍖 Food: ${mcBot.food}/20
        ⚡ Saturation: ${mcBot.foodSaturation.toFixed(1)}`;
      
      await interaction.editReply(healthStatus);
      break;

    case 'ping':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      
      const ping = mcBot.player ? mcBot.player.ping : 'Unknown';
      await interaction.editReply(`📶 Bot's current ping: ${ping}ms`);
      break;

    // Add the eat command handler
    case 'eat':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      
      if (mcBot.food >= 20) {
        await interaction.editReply('Hunger is already full (20/20).');
        return;
      }
      
      await interaction.editReply('Looking for food and eating...');
      const success = await eatFood();
      
      if (success) {
        await interaction.followUp(`Finished eating. Hunger is now ${mcBot.food}/20.`);
      } else {
        await interaction.followUp('No food found in inventory or error while eating.');
      }
      break;
  }
});

discordClient.on('messageCreate', async (message) => {
  if (message.channel.id !== COMMAND_CHANNEL_ID || message.author.bot || !message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  switch (command) {
    case 'addserver':
      if (args.length < 3) {
        message.channel.send('Usage: !addserver <name> <host> <port> [username]');
        return;
      }
      const newServerName = args[0];
      const host = args[1];
      const port = parseInt(args[2]) || 25565;
      const serverUsername = args[3] || null; // Get username if provided
      savedServers[newServerName] = { host, port, username: serverUsername };
      saveData(SERVERS_FILE, savedServers);
      message.channel.send(`Saved server "${newServerName}" as ${host}:${port}${username ? ` with username ${username}` : ''}.`);
      break;

      case 'listservers':
        const serverList = Object.entries(savedServers).map(([name, srv]) => 
          `${name}: ${srv.host}:${srv.port}${srv.username ? ` (username: ${srv.username})` : ''}`
        ).join('\n') || 'None';
        message.channel.send(`Saved servers:\n${serverList}`);
        break;

    case 'connect':
      if (args.length < 1) {
        message.channel.send('Usage: !connect <server_name> [username] [minutes]');
        return;
      }
      const serverName = args[0];
      const username = args[1] && !args[1].match(/^\d+$/) ? args[1] : null;
      const minutes = args[1] && args[1].match(/^\d+$/) ? parseInt(args[1]) : (args[2] ? parseInt(args[2]) : null);
      await connectToServer(serverName, username, minutes, (msg) => {
        message.channel.send(msg);
      });
      break;

    case 'disconnect':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      if (disconnectTimer) clearTimeout(disconnectTimer);
      stopAntiAfk();
      stopPingMonitoring();
      mcBot.quit();
      mcBot = null;
      message.channel.send('Minecraft bot disconnected.');
      break;

    case 'offline':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      if (args.length < 1) {
        message.channel.send('Usage: !offline <minutes>');
        return;
      }
      const offlineTime = parseInt(args[0]);
      if (isNaN(offlineTime) || offlineTime <= 0) {
        message.channel.send('Please provide a valid number of minutes.');
        return;
      }
      if (disconnectTimer) clearTimeout(disconnectTimer);
      const ms = offlineTime * 60 * 1000;
      disconnectTimer = setTimeout(() => {
        if (mcBot) mcBot.quit();
        stopAntiAfk();
        stopPingMonitoring();
        mcBot = null;
        if (logChannel) logChannel.send(`Auto-disconnected after ${offlineTime} minutes.`).catch(console.error);
      }, ms);
      message.channel.send(`Set to disconnect in ${offlineTime} minutes.`);
      break;

    case 'setlogchannel':
      if (args.length < 1) {
        message.channel.send('Usage: !setlogchannel <channel_id>');
        return;
      }
      const newChannelId = args[0];
      const newChannel = discordClient.channels.cache.get(newChannelId);
      if (!newChannel) {
        message.channel.send('Invalid channel ID.');
        return;
      }
      logChannel = newChannel;
      settings.logChannelId = newChannelId;
      settings.loggingEnabled = true;
      saveData(SETTINGS_FILE, settings);
      message.channel.send(`Log channel set to <#${newChannelId}>.`);
      break;

    case 'stoplog':
      settings.loggingEnabled = false;
      saveData(SETTINGS_FILE, settings);
      logChannel = null;
      message.channel.send('Stopped sending game logs and alerts.');
      break;

    case 'startlog':
      if (args.length > 0) {
        const newChannelId = args[0];
        const newChannel = discordClient.channels.cache.get(newChannelId);
        if (!newChannel) {
          message.channel.send('Invalid channel ID.');
          return;
        }
        logChannel = newChannel;
        settings.logChannelId = newChannelId;
      } else if (settings.logChannelId) {
        const channel = discordClient.channels.cache.get(settings.logChannelId);
        if (channel) {
          logChannel = channel;
        } else {
          message.channel.send('Saved log channel not found. Use !setlogchannel first.');
          return;
        }
      } else {
        logChannel = discordClient.channels.cache.get(COMMAND_CHANNEL_ID);
        settings.logChannelId = COMMAND_CHANNEL_ID;
      }
      
      settings.loggingEnabled = true;
      saveData(SETTINGS_FILE, settings);
      message.channel.send(`Started sending game logs to <#${settings.logChannelId}>.`);
      break;

    case 'respawn':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      mcBot.respawn();
      message.channel.send('Attempting to respawn the bot.');
      break;

    case 'interact':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      const interactType = args[0]?.toLowerCase();
      if (!interactType) {
        message.channel.send('Usage: !interact <mount|dismount|use|attack|sleep|wake>');
        return;
      }
      switch (interactType) {
        case 'mount':
          // Find the nearest mountable entity (horses, donkeys, etc.)
          const mountableEntities = Object.values(mcBot.entities).filter(e => 
            e !== mcBot.entity && 
            mcBot.entity.position.distanceTo(e.position) < 4 && 
            (e.displayName && e.displayName.toLowerCase().includes('horse') || 
             e.displayName && e.displayName.toLowerCase().includes('donkey') || 
             e.displayName && e.displayName.toLowerCase().includes('mule') ||
             e.name && e.name.toLowerCase().includes('boat') || 
             e.name && e.name.toLowerCase().includes('minecart'))
          );
          
          if (mountableEntities.length > 0) {
            // Sort by distance and mount the closest one
            mountableEntities.sort((a, b) => 
              mcBot.entity.position.distanceTo(a.position) - mcBot.entity.position.distanceTo(b.position)
            );
            mcBot.mount(mountableEntities[0]);
            message.channel.send(`Mounted ${mountableEntities[0].displayName || mountableEntities[0].name}.`);
          } else {
            message.channel.send('No mountable entity nearby (e.g., horse, donkey, boat, minecart).');
          }
          break;
        case 'dismount':
          if (mcBot.vehicle) {
            mcBot.dismount();
            message.channel.send('Dismounted.');
          } else {
            message.channel.send('Not currently mounted on anything.');
          }
          break;
        case 'use':
          mcBot.activateItem();
          message.channel.send('Used/activated held item.');
          break;
        case 'attack':
          // Find the nearest attackable entity (mobs)
          const attackableEntities = Object.values(mcBot.entities).filter(e => 
            e !== mcBot.entity && 
            e.type === 'mob' && 
            mcBot.entity.position.distanceTo(e.position) < 4
          );
          
          if (attackableEntities.length > 0) {
            // Sort by distance and attack the closest one
            attackableEntities.sort((a, b) => 
              mcBot.entity.position.distanceTo(a.position) - mcBot.entity.position.distanceTo(b.position)
            );
            currentTarget = attackableEntities[0];
            mcBot.attack(currentTarget);
            message.channel.send(`Attacking nearest mob: ${currentTarget.displayName || currentTarget.name}.`);
            mcBot.chat(`Attacking ${currentTarget.displayName || currentTarget.name}!`);
          } else {
            message.channel.send('No attackable entity nearby.');
          }
          break;
        case 'sleep':
          // Find a bed block nearby
          const bedBlock = mcBot.findBlock({
            matching: block => block.name.includes('bed'),
            maxDistance: 4
          });
          
          if (bedBlock) {
            try {
              await mcBot.sleep(bedBlock);
              message.channel.send('Sleeping in the bed.');
              mcBot.chat('Good night!');
            } catch (err) {
              message.channel.send(`Cannot sleep: ${err.message}`);
            }
          } else {
            message.channel.send('No bed found nearby.');
          }
          break;
        case 'wake':
          if (mcBot.isSleeping) {
            mcBot.wake();
            message.channel.send('Woke up from bed.');
            mcBot.chat('Good morning!');
          } else {
            message.channel.send('Not currently sleeping.');
          }
          break;
        default:
          message.channel.send('Invalid interact type. Available: mount, dismount, use, attack, sleep, wake.');
      }
      break;

    case 'players':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      const players = Object.keys(mcBot.players).filter(p => p !== mcBot.username);
      message.channel.send(`Online players (${players.length}): ${players.join(', ') || 'None'}`);
      break;

    case 'say':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      const sayMsg = args.join(' ');
      if (!sayMsg) {
        message.channel.send('Usage: !say <message>');
        return;
      }
      mcBot.chat(sayMsg);
      message.channel.send(`Sent in chat: ${sayMsg}`);
      break;

    case 'command':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      const cmd = args.join(' ');
      if (!cmd) {
        message.channel.send('Usage: !command <cmd>');
        return;
      }
      // Use the correct method to execute server commands
      mcBot.chat(`/${cmd}`);
      message.channel.send(`Executed command: /${cmd}`);
      break;

    case 'move':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      const direction = args[0]?.toLowerCase();
      if (!['forward', 'back', 'left', 'right'].includes(direction)) {
        message.channel.send('Usage: !move <forward|back|left|right>');
        return;
      }
      mcBot.setControlState(direction, true);
      message.channel.send(`Moving ${direction}.`);
      break;

    case 'stop':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      mcBot.clearControlStates();
      message.channel.send('Stopped movement.');
      break;

    case 'jump':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      mcBot.setControlState('jump', true);
      setTimeout(() => mcBot.setControlState('jump', false), 300);
      message.channel.send('Bot jumped.');
      break;

    case 'afk':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      const afkMode = args[0]?.toLowerCase();
      if (afkMode === 'on') {
        startAntiAfk();
        message.channel.send('Anti-AFK enabled.');
      } else if (afkMode === 'off') {
        stopAntiAfk();
        message.channel.send('Anti-AFK disabled.');
      } else {
        message.channel.send('Usage: !afk <on|off>');
      }
      break;

    case 'coords':
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
      break;

    case 'goto':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      if (args.length < 1) {
        message.channel.send('Usage: !goto <name>');
        return;
      }
      const gotoName = args.join(' ');
      const coord = savedCoords[gotoName];
      if (!coord) {
        message.channel.send(`No coordinates saved under "${gotoName}".`);
        return;
      }
      const goal = new GoalNear(coord.x, coord.y, coord.z, 1);
      mcBot.pathfinder.setGoal(goal);
      message.channel.send(`Heading to "${gotoName}" at (${coord.x}, ${coord.y}, ${coord.z}).`);
      break;

    case 'inventory':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      
      let inventoryText = '**Bot Inventory:**\n';
      inventoryText += '**Hotbar (0-8):**\n';
      
      for (let i = 0; i < 9; i++) {
        const item = mcBot.inventory.slots[i];
        inventoryText += `[${i}] ${item ? `${item.count}x ${item.displayName || item.name}` : 'Empty'}\n`;
      }
      
      inventoryText += '\n**Main Inventory (9-35):**\n';
      
      for (let i = 9; i < 36; i++) {
        const item = mcBot.inventory.slots[i];
        if (item) {
          inventoryText += `[${i}] ${item.count}x ${item.displayName || item.name}\n`;
        }
      }
      
      inventoryText += '\n**Armor:**\n';
      const armorSlots = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
      for (let i = 0; i < 4; i++) {
        const item = mcBot.inventory.slots[i + 36];
        inventoryText += `${armorSlots[i]}: ${item ? `${item.count}x ${item.displayName || item.name}` : 'Empty'}\n`;
      }
      
      if (mcBot.inventory.slots[45]) {
        const offhand = mcBot.inventory.slots[45];
        inventoryText += `Offhand: ${offhand.count}x ${offhand.displayName || offhand.name}\n`;
      }
      
      message.channel.send(inventoryText);
      break;

    case 'switchslot':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      
      if (args.length < 2) {
        message.channel.send('Usage: !switchslot <from_slot> <to_slot>');
        return;
      }
      
      const fromSlot = parseInt(args[0]);
      const toSlot = parseInt(args[1]);
      
      if (isNaN(fromSlot) || isNaN(toSlot) || fromSlot < 0 || fromSlot > 35 || toSlot < 0 || toSlot > 35) {
        message.channel.send('Slot numbers must be between 0 and 35.');
        return;
      }
      
      try {
        await mcBot.swapSlots(fromSlot, toSlot);
        message.channel.send(`Swapped items from slot ${fromSlot} to slot ${toSlot}.`);
      } catch (error) {
        message.channel.send(`Failed to swap items: ${error.message}`);
      }
      break;

    case 'hotbar':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      
      if (args.length < 1) {
        message.channel.send('Usage: !hotbar <slot>');
        return;
      }
      
      const hotbarSlot = parseInt(args[0]);
      
      if (isNaN(hotbarSlot) || hotbarSlot < 0 || hotbarSlot > 8) {
        message.channel.send('Hotbar slot must be between 0 and 8.');
        return;
      }
      
      try {
        mcBot.setQuickBarSlot(hotbarSlot);
        const currentItem = mcBot.inventory.slots[hotbarSlot];
        message.channel.send(`Selected hotbar slot ${hotbarSlot}: ${currentItem ? currentItem.displayName || currentItem.name : 'Empty'}`);
      } catch (error) {
        message.channel.send(`Failed to select hotbar slot: ${error.message}`);
      }
      break;

    case 'dropitem':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      
      if (args.length < 1) {
        message.channel.send('Usage: !dropitem <slot> [count]');
        return;
      }
      
      const dropSlot = parseInt(args[0]);
      const dropCount = args[1] ? parseInt(args[1]) : 1;
      
      if (isNaN(dropSlot) || dropSlot < 0 || dropSlot > 35) {
        message.channel.send('Slot number must be between 0 and 35.');
        return;
      }
      
      try {
        await mcBot.toss(dropSlot, dropCount);
        message.channel.send(`Dropped ${dropCount} item(s) from slot ${dropSlot}.`);
      } catch (error) {
        message.channel.send(`Failed to drop items: ${error.message}`);
      }
      break;

    case 'equip':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      
      if (args.length < 1) {
        message.channel.send('Usage: !equip <slot>');
        return;
      }
      
      const equipSlot = parseInt(args[0]);
      
      if (isNaN(equipSlot) || equipSlot < 0 || equipSlot > 35) {
        message.channel.send('Slot number must be between 0 and 35.');
        return;
      }
      
      try {
        const item = mcBot.inventory.slots[equipSlot];
        if (!item) {
          message.channel.send('No item in the specified slot.');
          return;
        }
        
        if (item.name.includes('helmet') || item.name.includes('chestplate') || 
            item.name.includes('leggings') || item.name.includes('boots')) {
          await mcBot.equip(item, 'hand');
          message.channel.send(`Equipped ${item.displayName || item.name} from slot ${equipSlot}.`);
        } else {
          message.channel.send('Item is not equipable armor.');
        }
      } catch (error) {
        message.channel.send(`Failed to equip item: ${error.message}`);
      }
      break;

    case 'health':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      
      const healthStatus = `**Health Status:**
        ❤️ Health: ${mcBot.health}/20
        🍖 Food: ${mcBot.food}/20
        ⚡ Saturation: ${mcBot.foodSaturation.toFixed(1)}`;
      
      message.channel.send(healthStatus);
      break;

    case 'ping':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      
      const ping = mcBot.player ? mcBot.player.ping : 'Unknown';
      message.channel.send(`📶 Bot's current ping in the server: ${ping}ms`);
      break;

    // Add the eat command handler
    case 'eat':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      
      if (mcBot.food >= 20) {
        message.channel.send('Hunger is already full (20/20).');
        return;
      }
      
      message.channel.send('Looking for food and eating...');
      const success = await eatFood();
      
      if (success) {
        message.channel.send(`Finished eating. Hunger is now ${mcBot.food}/20.`);
      } else {
        message.channel.send('No food found in inventory or error while eating.');
      }
      break;

    default:
      message.channel.send('Unknown command. Available: addserver, listservers, connect, disconnect, offline, setlogchannel, stoplog, startlog, respawn, interact, players, say, command, move, stop, jump, afk, coords, goto, inventory, switchslot, hotbar, dropitem, equip, health, ping, eat');
  }
});

discordClient.login(process.env.DISCORD_TOKEN);