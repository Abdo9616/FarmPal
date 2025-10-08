require('dotenv').config();
require('./utils/consolelogger');
require('./utils/logger.js')();
const { logCommand } = require('./utils/cmdLogger.js');
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const fs = require('fs');
const initializeHealthServer = require('./utils/healthHandler');
const { setupPresence } = require('./utils/presenceManager.js');  // Adjust the path if it's in a different folder, e.g., './src/modules/presenceManager.js'

const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

let mcBot = null;
let logChannel = null;
const COMMAND_CHANNEL_IDS = process.env.DISCORD_CHANNEL_IDS ? process.env.DISCORD_CHANNEL_IDS.split(',').map(id => id.trim()) : [];
let disconnectTimer = null;
let currentTarget = null; // Track current combat target
let lastTimeState = null; // Track last time state to prevent spam

const DATABASE_FOLDER = 'database';

// Ensure the database folder exists
if (!fs.existsSync(DATABASE_FOLDER)) {
  fs.mkdirSync(DATABASE_FOLDER);
}

// File paths for persistent data
const SERVERS_FILE = `${DATABASE_FOLDER}/servers.json`;
const COORDS_FILE = `${DATABASE_FOLDER}/coords.json`;
const SETTINGS_FILE = `${DATABASE_FOLDER}/settings.json`;
const SCHEDULED_CONNECTIONS_FILE = `${DATABASE_FOLDER}/scheduled_connections.json`;
const LAST_SESSION_FILE = `${DATABASE_FOLDER}/last_session.json`;

let scheduledConnections = loadData(SCHEDULED_CONNECTIONS_FILE);
let scheduledTimers = {};
let intentionalDisconnect = false; // Track if disconnect was intentional
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectTimer = null;

// Connection tracking variables
let connectionStartTime = null;
let currentServerName = null;
let currentBotUsername = null;



process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Optional: Add cleanup logic here
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Optional: Add cleanup logic here
});

const getStatus = () => {
  if (!mcBot || !mcBot.player) {
    return { connected: false };
  }
  const playerCount = Object.keys(mcBot.players).length - 1; // Exclude the bot itself
  const ping = mcBot.player.ping || 'N/A';
  const serverName = currentServerName || 'Unknown Server'; // Use saved server name (not IP)
  return {
    connected: true,
    serverName,
    playerCount,
    ping
  };
};


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

function saveScheduledConnections() {
  saveData(SCHEDULED_CONNECTIONS_FILE, scheduledConnections);
}

// Last session management
function saveLastSession(serverName, username, connectTime) {
  const lastSession = {
    serverName: serverName,
    username: username,
    connectTime: connectTime,
    timestamp: new Date().toISOString(),
    reconnectAttempts: reconnectAttempts
  };
  saveData(LAST_SESSION_FILE, lastSession);
  console.log('Last session saved:', lastSession);
}

function clearLastSession() {
  if (fs.existsSync(LAST_SESSION_FILE)) {
    fs.unlinkSync(LAST_SESSION_FILE);
    console.log('Last session cleared');
  }
  reconnectAttempts = 0;
}

function getLastSession() {
  return loadData(LAST_SESSION_FILE);
}

// Connection info management
function clearConnectionInfo() {
  connectionStartTime = null;
  currentServerName = null;
  currentBotUsername = null;
}

// Automated reconnection function
function scheduleReconnection(serverName, username, connectTime) {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    sendLog(`❌ Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`, 'connectionLogs');
    clearLastSession();
    clearConnectionInfo();
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(30000 * reconnectAttempts, 120000); // Exponential backoff: 30s, 60s, 90s, 120s, 120s
  
  sendLog(`🔁 Attempting to reconnect in ${delay/1000} seconds (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`, 'connectionLogs');

  reconnectTimer = setTimeout(() => {
    connectToServer(serverName, username, connectTime, (msg) => {
      sendLog(`Reconnection attempt: ${msg}`, 'connectionLogs');
    });
  }, delay);
}

function cancelReconnection() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
}

// Automated connection functions
function scheduleConnection(serverName, delayMinutes, username = null, connectTime = null) {
  const connectionId = Date.now().toString(); // Unique ID for this scheduled connection
  const delayMs = delayMinutes * 60 * 1000; // Convert minutes to milliseconds
  
  const scheduledConnection = {
    id: connectionId,
    serverName: serverName,
    username: username,
    connectTime: connectTime,
    scheduledFor: new Date(Date.now() + delayMs).toISOString(),
    delayMinutes: delayMinutes
  };
  
  scheduledConnections[connectionId] = scheduledConnection;
  saveScheduledConnections();
  
  // Set the timer
  scheduledTimers[connectionId] = setTimeout(() => {
    executeScheduledConnection(connectionId);
  }, delayMs);
  
  return connectionId;
}

function cancelScheduledConnection(connectionId) {
  if (scheduledTimers[connectionId]) {
    clearTimeout(scheduledTimers[connectionId]);
    delete scheduledTimers[connectionId];
  }
  
  if (scheduledConnections[connectionId]) {
    delete scheduledConnections[connectionId];
    saveScheduledConnections();
  }
}

function executeScheduledConnection(connectionId) {
  const connection = scheduledConnections[connectionId];
  if (!connection) return;
  
  const server = savedServers[connection.serverName];
  if (!server) {
    sendLog(`❌ Scheduled connection failed: Server "${connection.serverName}" not found.`, 'connectionLogs');
    return;
  }
  
  sendLog(`⏰ Executing scheduled connection to "${connection.serverName}"...`, 'connectionLogs');

  connectToServer(connection.serverName, connection.username, connection.connectTime, (msg) => {
    sendLog(`Scheduled connection result: ${msg}`, 'connectionLogs');
  });
  
  // Clean up
  delete scheduledConnections[connectionId];
  delete scheduledTimers[connectionId];
  saveScheduledConnections();
}

function listScheduledConnections() {
  if (Object.keys(scheduledConnections).length === 0) {
    return "No scheduled connections.";
  }
  
  let result = "**Scheduled Connections:**\n";
  Object.values(scheduledConnections).forEach(conn => {
    const scheduledTime = new Date(conn.scheduledFor);
    const timeUntil = Math.max(0, scheduledTime - Date.now());
    const minutesLeft = Math.ceil(timeUntil / (60 * 1000));
    
    result += `• **${conn.serverName}** in ${minutesLeft} minutes (ID: ${conn.id})\n`;
  });
  
  return result;
}

// Load scheduled connections on startup
function loadScheduledConnectionsOnStartup() {
  Object.values(scheduledConnections).forEach(conn => {
    const scheduledTime = new Date(conn.scheduledFor);
    const timeUntil = scheduledTime - Date.now();
    
    if (timeUntil > 0) {
      // Connection is still in the future, reschedule it
      scheduledTimers[conn.id] = setTimeout(() => {
        executeScheduledConnection(conn.id);
      }, timeUntil);
      
      console.log(`Rescheduled connection to ${conn.serverName} in ${Math.ceil(timeUntil / (60 * 1000))} minutes`);
    } else {
      // Connection time has passed, remove it
      delete scheduledConnections[conn.id];
    }
  });
  saveScheduledConnections();
}


let savedServers = loadData(SERVERS_FILE);
let savedCoords = loadData(COORDS_FILE);
let settings = loadData(SETTINGS_FILE);

// Initialize settings with proper defaults
if (!settings.logChannelId) {
  settings.logChannelId = null;
  settings.loggingEnabled = false;
}
if (!settings.logging) {
  settings.logging = {
    timeUpdates: true,
    damageAlerts: true,
    deathAlerts: true,
    pathAlerts: true,
    chatLogs: true,
    pingAlerts: true,
    connectionLogs: true,
    lowResources: true,
  };
}
if (!settings.inGameLogging) {
  settings.inGameLogging = {
    timeUpdates: true,
    damageAlerts: true,
    deathAlerts: true,
    attackAlerts: true,
    sleepAlerts: true,
  };
  saveData(SETTINGS_FILE, settings);
}

// Global log sending function
function sendLog(message, category = 'connectionLogs') {
  if (logChannel && settings.loggingEnabled && settings.logging[category]) {
    logChannel.send(message).catch(error => {
      console.error('Failed to send log message:', error);
    });
  }
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
      if (ping > 500) {
        sendLog(`⚠️ High ping alert: ${ping}ms`, 'pingAlerts');
      }
      
      // Random chance to log normal ping (about 20% chance)
      if (Math.random() < 0.2) {
        sendLog(`📊 Current ping: ${ping}ms`, 'pingAlerts');
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
  const botUsername = username || server.username || 'FarmPal';
  
  try {
    mcBot = mineflayer.createBot({
      host: server.host,
      port: server.port,
      username: botUsername,
      auth: 'offline', // Keep as offline but detect login requirements
      version: false
    });

    // Load plugin but don't set up movements until spawn
    mcBot.loadPlugin(pathfinder);

    let loginRequired = false;
    let loginPromptDetected = false;
    const loginKeywords = ['login', 'register', 'password', 'auth', 'premium', 'cracked'];

    // Enhanced chat monitoring for login prompts
    mcBot.on('chat', (username, msg) => {
      if (username !== mcBot.username) {
        sendLog(`[MC Chat] ${username}: ${msg}`, 'chatLogs');
        
        // Detect login requirements in chat messages
        const lowerMsg = msg.toLowerCase();
        if (loginKeywords.some(keyword => lowerMsg.includes(keyword)) && 
            (lowerMsg.includes(mcBot.username.toLowerCase()) || 
             lowerMsg.includes('please') || 
             lowerMsg.includes('required'))) {
          loginPromptDetected = true;
          if (!loginRequired) {
            loginRequired = true;
            const loginMessage = `🔐 **LOGIN REQUIRED**: Server requires authentication. Use \`/command login <password>\` or \`/command register <password>\` to authenticate.`;
            sendLog(loginMessage, 'connectionLogs');
          }
        }
      }
    });

    mcBot.once('spawn', () => {
      // Set up movements after spawn
      const defaultMovements = new Movements(mcBot);
      mcBot.pathfinder.setMovements(defaultMovements);
      
      // Set connection information
      connectionStartTime = new Date();
      currentServerName = serverName;
      currentBotUsername = mcBot.username;
      
      // Save successful connection to last session
      saveLastSession(serverName, botUsername, connectTime);
      reconnectAttempts = 0; // Reset reconnect attempts on successful connection
      
      sendLog(`✅ Minecraft bot connected to ${server.host}:${server.port} as ${mcBot.username}.`, 'connectionLogs');
      
      // Start ping monitoring
      startPingMonitoring();
      
      if (connectTime) {
        const ms = connectTime * 60 * 1000;
        disconnectTimer = setTimeout(() => {
          intentionalDisconnect = true;
          if (mcBot) mcBot.quit();
          mcBot = null;
          stopPingMonitoring();
          clearLastSession();
          clearConnectionInfo();
          sendLog(`Auto-disconnected after ${connectTime} minutes.`, 'connectionLogs');
        }, ms);
        sendLog(`Set to auto-disconnect in ${connectTime} minutes.`, 'connectionLogs');
      }
    });

    // Enhanced error handler with login detection
    mcBot.on('kicked', (reason) => {
      const reasonString = typeof reason === 'object' ? JSON.stringify(reason) : reason;
      const lowerReason = reasonString.toLowerCase();
      
      // Check if kick reason indicates login requirement
      if (loginKeywords.some(keyword => lowerReason.includes(keyword))) {
        sendLog(`🔐 **KICKED - LOGIN REQUIRED**: ${reasonString}\nUse \`/command login <password>\` after reconnecting.`, 'connectionLogs');
      } else {
        sendLog(`❌ Kicked from server: ${reasonString}`, 'connectionLogs');
      }
      
      stopAntiAfk();
      stopPingMonitoring();
      
      if (!intentionalDisconnect) {
        sendLog(`💡 Will attempt to reconnect in 30 seconds...`, 'connectionLogs');
        scheduleReconnection(serverName, botUsername, connectTime);
      } else {
        clearConnectionInfo();
      }
      
      mcBot = null;
    });

    mcBot.on('error', (err) => {
      sendLog(`❌ Connection Error: ${err.message}`, 'connectionLogs');
      if (err.message.includes('auth') || err.message.includes('premium')) {
        sendLog(`💡 **AUTHENTICATION ISSUE**: This server may require a premium account or specific authentication.`, 'connectionLogs');
      }
      
      stopAntiAfk();
      stopPingMonitoring();
      
      if (!intentionalDisconnect) {
        sendLog(`💡 Will attempt to reconnect in 30 seconds...`, 'connectionLogs');
        scheduleReconnection(serverName, botUsername, connectTime);
      } else {
        clearConnectionInfo();
      }
      
      mcBot = null;
    });

    mcBot.on('end', () => {
      stopAntiAfk();
      stopPingMonitoring();
      
      if (!intentionalDisconnect && mcBot) {
        sendLog(`🔌 Connection ended unexpectedly. Will attempt to reconnect in 30 seconds...`, 'connectionLogs');
        scheduleReconnection(serverName, botUsername, connectTime);
      } else {
        clearConnectionInfo();
      }
      
      mcBot = null;
    });

    // Set a timeout to detect if login is required but no prompt received
    const loginCheckTimeout = setTimeout(() => {
      if (loginPromptDetected && !mcBot.username) {
        sendLog(`⏰ **Login may be required**. Use \`/command login <password>\` if the server has authentication.`, 'connectionLogs');
      }
    }, 10000); // Check after 10 seconds

    mcBot.on('path_update', (results) => {
      if (results.status === 'noPath') {
        sendLog('Cannot reach the target coordinates.', 'pathAlerts');
      }
    });

    mcBot.on('goal_reached', () => {
      sendLog('Reached the target coordinates.', 'pathAlerts');
    });

    mcBot.on('health', () => {
      if (mcBot.health < 10) sendLog(`Alert: Bot health low (${mcBot.health}/20)!`, 'lowResources');
      if (mcBot.food < 10) sendLog(`Alert: Bot hunger low (${mcBot.food}/20)!`, 'lowResources');
    });

    mcBot.on('entityHurt', (entity) => {
      if (entity === mcBot.entity) {
        sendLog('Alert: Bot is taking damage!', 'damageAlerts');
        const attacker = Object.values(mcBot.entities).find(e => 
          e !== mcBot.entity && 
          e.position && 
          mcBot.entity.position.distanceTo(e.position) < 5
        );
        if (attacker && settings.inGameLogging.damageAlerts) {
          mcBot.chat(`I'm being attacked by ${attacker.displayName || attacker.name}!`);
        }
      } else if (currentTarget && entity === currentTarget) {
        if (settings.inGameLogging.attackAlerts) mcBot.chat(`Attacking ${entity.displayName || entity.name}!`);
      }
    });

    mcBot.on('death', () => {
      sendLog('Alert: Bot has died! Use !respawn or /respawn to respawn.', 'deathAlerts');
      stopAntiAfk();
      stopPingMonitoring();
      if (settings.inGameLogging.deathAlerts) mcBot.chat('I died!');
    });

    mcBot.on('respawn', () => {
      sendLog('Bot has respawned.', 'deathAlerts');
      startPingMonitoring();
      if (settings.inGameLogging.deathAlerts) mcBot.chat('I respawned!');
    });

    mcBot.on('time', () => {
      const isDay = mcBot.time.isDay;
      if (lastTimeState !== isDay) {
        lastTimeState = isDay;
        if (isDay) {
          sendLog('Time update: Daytime has begun.', 'timeUpdates');
          if (settings.inGameLogging.timeUpdates) mcBot.chat('Daytime has begun!');
        } else {
          sendLog('Time update: Nighttime has begun.', 'timeUpdates');
          if (settings.inGameLogging.timeUpdates) mcBot.chat('Nighttime has begun!');
        }
      }
    });

    replyCallback(`🔗 Connecting to ${server.host}:${server.port} as ${botUsername}...`);
  } catch (err) {
    replyCallback(`❌ Connection failed: ${err.message}`);
    if (err.message.includes('auth') || err.message.includes('premium')) {
      replyCallback(`💡 **Tip**: This server may require login. If connection succeeds but bot is stuck, use \`/command login <password>\``);
    }
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
    .setDescription('Drop items from inventory (slots 0-45 as shown in /inventory)')
    .addIntegerOption(option => option.setName('slot').setDescription('Slot number (0-45) as shown in /inventory').setRequired(true))
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
  new SlashCommandBuilder()
    .setName('eat')
    .setDescription('Find and eat food to restore hunger'),
  new SlashCommandBuilder()
    .setName('scheduleconnect')
    .setDescription('Schedule an automated connection to a server')
    .addStringOption(option => option.setName('server_name').setDescription('Saved server name').setRequired(true))
    .addIntegerOption(option => option.setName('delay_minutes').setDescription('Minutes until connection').setRequired(true))
    .addStringOption(option => option.setName('username').setDescription('Custom username').setRequired(false))
    .addIntegerOption(option => option.setName('connect_time').setDescription('Auto-disconnect after minutes').setRequired(false)),
  new SlashCommandBuilder()
    .setName('listscheduled')
    .setDescription('List all scheduled connections'),
  new SlashCommandBuilder()
    .setName('cancelschedule')
    .setDescription('Cancel a scheduled connection')
    .addStringOption(option => option.setName('connection_id').setDescription('Connection ID from /listscheduled').setRequired(true)),
  new SlashCommandBuilder()
    .setName('cancelreconnect')
    .setDescription('Cancel automatic reconnection attempts'),
  new SlashCommandBuilder()
    .setName('connectioninfo')
    .setDescription('Show current connection information'),
  new SlashCommandBuilder()
    .setName('togglelog')
    .setDescription('Toggle Discord logging preferences')
    .addStringOption(option => option.setName('type').setDescription('Log type').setRequired(true)
      .addChoices(
        { name: 'time updates', value: 'timeUpdates' },
        { name: 'damage alerts', value: 'damageAlerts' },
        { name: 'death alerts', value: 'deathAlerts' },
        { name: 'path alerts', value: 'pathAlerts' },
        { name: 'chat logs', value: 'chatLogs' },
        { name: 'ping alerts', value: 'pingAlerts' },
        { name: 'connection logs', value: 'connectionLogs' },
        { name: 'low resources', value: 'lowResources' }
      ))
    .addStringOption(option => option.setName('state').setDescription('on/off').setRequired(true)
      .addChoices(
        { name: 'on', value: 'true' },
        { name: 'off', value: 'false' }
      )),
  new SlashCommandBuilder()
    .setName('toggleingamelog')
    .setDescription('Toggle in-game event logging preferences')
    .addStringOption(option => option.setName('type').setDescription('Log type').setRequired(true)
      .addChoices(
        { name: 'time updates', value: 'timeUpdates' },
        { name: 'damage alerts', value: 'damageAlerts' },
        { name: 'death alerts', value: 'deathAlerts' },
        { name: 'attack alerts', value: 'attackAlerts' },
        { name: 'sleep alerts', value: 'sleepAlerts' }
      ))
    .addStringOption(option => option.setName('state').setDescription('on/off').setRequired(true)
      .addChoices(
        { name: 'on', value: 'true' },
        { name: 'off', value: 'false' }
      )),
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

discordClient.on('clientReady', () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}`);
  console.log(`Bot can be controlled from channels: ${COMMAND_CHANNEL_IDS.join(', ')}`);
  

  setupPresence(discordClient, getStatus);
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
  
  // Load scheduled connections on startup
  loadScheduledConnectionsOnStartup();
  
  // Check for last session and attempt to reconnect
  const lastSession = getLastSession();
  if (lastSession && lastSession.serverName) {
    console.log('Found last session, attempting to reconnect...');
    sendLog(`🔁 Found previous session. Attempting to reconnect to ${lastSession.serverName}...`, 'connectionLogs');
    
    // Wait a few seconds before attempting reconnect to ensure everything is loaded
    setTimeout(() => {
      connectToServer(lastSession.serverName, lastSession.username, lastSession.connectTime, (msg) => {
        sendLog(`Auto-reconnect: ${msg}`, 'connectionLogs');
      });
    }, 5000);
  }
  
  registerSlashCommands();
});

discordClient.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand() || !COMMAND_CHANNEL_IDS.includes(interaction.channel.id)) return;

  logCommand(interaction);

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
          intentionalDisconnect = false; // Reset intentional disconnect flag
          await connectToServer(options.getString('server_name'), options.getString('username'), options.getInteger('minutes'), async (msg) => {
            await interaction.editReply(msg);
            
            // Add login guidance to the response
            if (msg.includes('Connecting to')) {
              setTimeout(async () => {
                await interaction.followUp(`💡 **Tip**: If the bot connects but can't move/interact, the server may require login. Use \`/command login <password>\` or \`/command register <password>\` to authenticate.`);
              }, 3000);
            }
          });
          break;

    case 'disconnect':
      if (!mcBot) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      intentionalDisconnect = true;
      cancelReconnection();
      if (disconnectTimer) clearTimeout(disconnectTimer);
      stopAntiAfk();
      stopPingMonitoring();
      mcBot.quit();
      mcBot = null;
      clearLastSession();
      clearConnectionInfo();
      await interaction.editReply('Minecraft bot disconnected. Auto-reconnect disabled.');
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
      intentionalDisconnect = true;
      cancelReconnection();
      if (disconnectTimer) clearTimeout(disconnectTimer);
      const ms = offlineTime * 60 * 1000;
      disconnectTimer = setTimeout(() => {
        intentionalDisconnect = true;
        if (mcBot) mcBot.quit();
        stopAntiAfk();
        stopPingMonitoring();
        mcBot = null;
        clearLastSession();
        clearConnectionInfo();
        sendLog(`Auto-disconnected after ${offlineTime} minutes.`, 'connectionLogs');
      }, ms);
      await interaction.editReply(`Set to disconnect in ${offlineTime} minutes. Auto-reconnect disabled.`);
      break;

    case 'setlogchannel':
      const newChannelId = options.getString('channel_id');
      // Check if the channel is in the allowed command channels
      if (!COMMAND_CHANNEL_IDS.includes(newChannelId)) {
        await interaction.editReply('This channel is not authorized for bot commands.');
        return;
      }
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
        // Check if the channel is in the allowed command channels
        if (!COMMAND_CHANNEL_IDS.includes(newChannelId)) {
          await interaction.editReply('This channel is not authorized for bot commands.');
          return;
        }
        const newChannel = discordClient.channels.cache.get(newChannelId);
        if (!newChannel) {
          await interaction.editReply('Invalid channel ID.');
          return;
        }
        logChannel = newChannel;
        settings.logChannelId = newChannelId;
      } else if (settings.logChannelId) {
        // Check if the saved channel is in the allowed command channels
        if (!COMMAND_CHANNEL_IDS.includes(settings.logChannelId)) {
          await interaction.editReply('Saved log channel is not authorized. Use /setlogchannel with an authorized channel.');
          return;
        }
        const channel = discordClient.channels.cache.get(settings.logChannelId);
        if (channel) {
          logChannel = channel;
        } else {
          await interaction.editReply('Saved log channel not found. Use /setlogchannel first.');
          return;
        }
      } else {
        // Use the first command channel as default if no log channel is set
        logChannel = discordClient.channels.cache.get(COMMAND_CHANNEL_IDS[0]);
        settings.logChannelId = COMMAND_CHANNEL_IDS[0];
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
            if (settings.inGameLogging.attackAlerts) mcBot.chat(`Attacking ${currentTarget.displayName || currentTarget.name}!`);
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
              if (settings.inGameLogging.sleepAlerts) mcBot.chat('Good night!');
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
            if (settings.inGameLogging.sleepAlerts) mcBot.chat('Good morning!');
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
        
        // Special handling for login-related commands
        if (cmd.toLowerCase().startsWith('login') || cmd.toLowerCase().startsWith('register')) {
          await interaction.editReply(`🔐 Attempting login/registration... Check game logs for results.`);
        }
        
        mcBot.chat(`/${cmd}`);
        await interaction.editReply(`✅ Executed command: /${cmd}`);
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
  
  // Get current held item slot (relative hotbar 0-8)
  const currentHeldSlot = mcBot.quickBarSlot;
  
  // Crafting slots (0-4)
  inventoryText += '**🛠️ Crafting Grid (Slots 0-4):**\n';
  const craftingSlots = [
    { slot: 0, name: 'Output' },
    { slot: 1, name: 'Input Top-Left' },
    { slot: 2, name: 'Input Top-Right' },
    { slot: 3, name: 'Input Bottom-Left' },
    { slot: 4, name: 'Input Bottom-Right' }
  ];
  
  for (const craft of craftingSlots) {
    const item = mcBot.inventory.slots[craft.slot];
    inventoryText += `• ${craft.name} [${craft.slot}]: ${item ? `${item.count}x ${item.displayName || item.name}` : 'Empty'}\n`;
  }
  
  // Armor slots (5-8)
  inventoryText += '\n**🎽 Armor (Slots 5-8):**\n';
  const armorSlots = [
    { slot: 5, name: 'Helmet' },
    { slot: 6, name: 'Chestplate' },
    { slot: 7, name: 'Leggings' },
    { slot: 8, name: 'Boots' }
  ];
  
  for (const armor of armorSlots) {
    const item = mcBot.inventory.slots[armor.slot];
    inventoryText += `• ${armor.name} [${armor.slot}]: ${item ? `${item.count}x ${item.displayName || item.name}` : 'Empty'}\n`;
  }
  
  // Offhand slot
  let offhandItem = null;
  let offhandSlot = null;
  
  // Prefer modern offhand slot
  if (mcBot.inventory.slots[45]) {
    offhandItem = mcBot.inventory.slots[45];
    offhandSlot = 45;
  } else if (mcBot.inventory.slots[40]) {
    offhandItem = mcBot.inventory.slots[40];
    offhandSlot = 40;
  }
  
  inventoryText += `\n**🛡️ Offhand [${offhandSlot || 'N/A'}]:** ${offhandItem ? `${offhandItem.count}x ${offhandItem.displayName || offhandItem.name}` : 'Empty'}\n`;
  
  // Hotbar (slots 36-44)
  inventoryText += '\n**🔥 Hotbar (Slots 36-44):**\n';
  let hotbarText = '';
  for (let i = 0; i < 9; i++) {
    const slot = 36 + i;
    const item = mcBot.inventory.slots[slot];
    const slotDisplay = `[${slot.toString().padStart(2, '0')}]`;
    const isCurrent = (i === currentHeldSlot) ? '✋ ' : '';
    
    if (item) {
      const itemName = (item.displayName || item.name).substring(0, 12);
      hotbarText += `${isCurrent}${slotDisplay} ${item.count}x ${itemName}  `;
    } else {
      hotbarText += `${isCurrent}${slotDisplay} ----------  `;
    }
  }
  inventoryText += hotbarText.trim() + '\n';
  
  // Main inventory grid (3 rows of 9 slots) - slots 9-35
  inventoryText += '\n**📦 Main Inventory (Slots 9-35):**\n';
  
  for (let row = 0; row < 3; row++) {
    let rowText = '';
    for (let col = 0; col < 9; col++) {
      const slot = 9 + (row * 9) + col;
      const item = mcBot.inventory.slots[slot];
      const slotDisplay = `[${slot.toString().padStart(2, '0')}]`;
      
      if (item) {
        const itemName = (item.displayName || item.name).substring(0, 8);
        rowText += `${slotDisplay} ${item.count}x ${itemName}  `;
      } else {
        rowText += `${slotDisplay} --------  `;
      }
    }
    inventoryText += rowText.trim() + '\n';
  }
  
  // Current held item info
  const heldItem = mcBot.inventory.slots[36 + currentHeldSlot];
  if (heldItem) {
    inventoryText += `\n**Currently Holding [${(36 + currentHeldSlot).toString().padStart(2, '0')}]:** ${heldItem.count}x ${heldItem.displayName || heldItem.name}`;
  }
  
  // Inventory summary
  inventoryText += '\n\n**📊 Inventory Summary:**\n';
  const itemCounts = {};
  
  // Check all slots (0-45)
  for (let slot = 0; slot < 46; slot++) {
    const item = mcBot.inventory.slots[slot];
    if (item) {
      const itemName = item.displayName || item.name;
      itemCounts[itemName] = (itemCounts[itemName] || 0) + item.count;
    }
  }
  
  const uniqueItems = Object.keys(itemCounts);
  if (uniqueItems.length > 0) {
    uniqueItems.sort((a, b) => itemCounts[b] - itemCounts[a]);
    uniqueItems.slice(0, 15).forEach(itemName => {
      inventoryText += `• ${itemCounts[itemName]}x ${itemName}\n`;
    });
    if (uniqueItems.length > 15) {
      inventoryText += `• ... and ${uniqueItems.length - 15} more items`;
    }
  } else {
    inventoryText += 'No items in inventory';
  }
  
  // Health and food status
  inventoryText += `\n**❤️ Health:** ${mcBot.health}/20 | **🍖 Food:** ${mcBot.food}/20`;
  
  // Truncate if too long for Discord (2000 char limit)
  if (inventoryText.length > 2000) {
    inventoryText = inventoryText.substring(0, 1900) + '\n... (inventory too large to display completely)';
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
        
        // Use the correct slot range (0-44 for main inventory + armor)
        if (dropSlot < 0 || dropSlot > 44) {
            await interaction.editReply('Slot number must be between 0 and 44.');
            return;
        }
        
        try {
            const item = mcBot.inventory.slots[dropSlot];
            if (!item) {
                await interaction.editReply(`Slot [${dropSlot}] is empty.`);
                return;
            }
            
            // Use the correct method for dropping items from specific slots
            // For armor slots (36-39) and main inventory (0-35), we can use tossStack
            if (dropCount >= item.count) {
                // Drop entire stack
                await mcBot.tossStack(item);
            } else {
                // Drop specific count - we need to use a different approach
                // Since tossStack doesn't support partial drops, we'll drop the entire stack
                // and re-add the remaining items if needed
                await interaction.editReply(`Partial dropping not supported yet. Dropping entire stack of ${item.count} items.`);
                await mcBot.tossStack(item);
            }
            
            await interaction.editReply(`Dropped ${dropCount} item(s) from slot [${dropSlot}].`);
        } catch (error) {
            console.error('Drop item error:', error);
            await interaction.editReply(`Failed to drop items: ${error.message}\nNote: Some slots (like armor) may have restrictions on dropping.`);
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
        
        // Better armor detection - check for actual armor types
        const isArmor = item.name.includes('helmet') || 
                       item.name.includes('chestplate') || 
                       item.name.includes('leggings') || 
                       item.name.includes('boots') ||
                       item.name.includes('cap') || // leather cap
                       item.name.includes('tunic') || // leather tunic
                       item.name.includes('pants'); // leather pants
        
        if (isArmor) {
          // Determine armor type and equip to correct slot
          let armorType = 'head';
          if (item.name.includes('chestplate') || item.name.includes('tunic')) armorType = 'torso';
          else if (item.name.includes('leggings') || item.name.includes('pants')) armorType = 'legs';
          else if (item.name.includes('boots')) armorType = 'feet';
          
          await mcBot.equip(item, armorType);
          await interaction.editReply(`Equipped ${item.displayName || item.name} as ${armorType} armor.`);
        } else {
          await interaction.editReply('Item is not equipable armor. Armor must be helmet, chestplate, leggings, or boots.');
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

    case 'scheduleconnect':
        const scheduledServerName = options.getString('server_name');
        const delayMinutes = options.getInteger('delay_minutes');
        const scheduleUsername = options.getString('username');
        const scheduleConnectTime = options.getInteger('connect_time');
      
        if (!savedServers[scheduledServerName]) {
          await interaction.editReply(`Server "${scheduledServerName}" not found. Use /addserver first.`);
          return;
        }
      
        if (delayMinutes <= 0) {
          await interaction.editReply('Delay must be a positive number of minutes.');
          return;
        }
      
        const connectionId = scheduleConnection(scheduledServerName, delayMinutes, scheduleUsername, scheduleConnectTime);
        
        await interaction.editReply(
          `✅ Connection to **${scheduledServerName}** scheduled in **${delayMinutes} minutes**.\n` +
          `Connection ID: ${connectionId}`
        );
        break;

    case 'listscheduled':
      const scheduledList = listScheduledConnections();
      await interaction.editReply(scheduledList);
      break;

    case 'cancelschedule':
      const connectionIdToCancel = options.getString('connection_id');
      
      if (scheduledConnections[connectionIdToCancel]) {
        cancelScheduledConnection(connectionIdToCancel);
        await interaction.editReply(`✅ Cancelled scheduled connection (ID: ${connectionIdToCancel})`);
      } else {
        await interaction.editReply('❌ No scheduled connection found with that ID.');
      }
      break;

    case 'cancelreconnect':
      cancelReconnection();
      clearLastSession();
      clearConnectionInfo();
      await interaction.editReply('✅ Automatic reconnection cancelled and last session cleared.');
      break;

    case 'connectioninfo':
      if (!mcBot || !connectionStartTime) {
        await interaction.editReply('Minecraft bot is not connected.');
        return;
      }
      
      const serverInfo = savedServers[currentServerName];
      if (!serverInfo) {
        await interaction.editReply('Error: Could not retrieve server information.');
        return;
      }
      
      // Calculate connection duration
      const now = new Date();
      const durationMs = now - connectionStartTime;
      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((durationMs % (1000 * 60)) / 1000);
      
      const durationString = hours > 0 
        ? `${hours}h ${minutes}m ${seconds}s`
        : `${minutes}m ${seconds}s`;
      
      const connectionInfo = `**Connection Information:**
🌐 **Server:** ${currentServerName} (${serverInfo.host}:${serverInfo.port})
👤 **Username:** ${currentBotUsername}
⏰ **Connected Since:** ${connectionStartTime.toLocaleString()}
⏱️ **Duration:** ${durationString}`;
      
      await interaction.editReply(connectionInfo);
      break;

    case 'togglelog':
      const logType = options.getString('type');
      const state = options.getString('state') === 'true';

      if (!(logType in settings.logging)) {
        await interaction.editReply('Invalid log type.');
        return;
      }

      settings.logging[logType] = state;
      saveData(SETTINGS_FILE, settings);
      await interaction.editReply(`Discord logging for ${logType} set to ${state ? 'on' : 'off'}.`);
      break;

    case 'toggleingamelog':
      const inGameLogType = options.getString('type');
      const inGameState = options.getString('state') === 'true';

      if (!(inGameLogType in settings.inGameLogging)) {
        await interaction.editReply('Invalid in-game log type.');
        return;
      }

      settings.inGameLogging[inGameLogType] = inGameState;
      saveData(SETTINGS_FILE, settings);
      await interaction.editReply(`In-game logging for ${inGameLogType} set to ${inGameState ? 'on' : 'off'}.`);
      break;
  }
});

discordClient.on('messageCreate', async (message) => {
  if (!COMMAND_CHANNEL_IDS.includes(message.channel.id) || message.author.bot || !message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  const mockInteraction = {
    commandName: command,
    user: message.author,
    inGuild: () => message.guild !== null,
    guild: message.guild,
    channel: message.channel
  };

  // Log the prefix command
  logCommand(mockInteraction);

  switch (command) {
    case 'addserver':
      if (args.length < 3) {
        message.channel.send('Usage: !addserver <name> <host> <port> [username]');
        return;
      }
      const newServerName = args[0];
      const host = args[1];
      const port = parseInt(args[2]) || 25565;
      const serverUsername = args[3] || null;
      savedServers[newServerName] = { host, port, username: serverUsername };
      saveData(SERVERS_FILE, savedServers);
      message.channel.send(`Saved server "${newServerName}" as ${host}:${port}${serverUsername ? ` with username ${serverUsername}` : ''}.`);
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
      const connectServerName = args[0];
      const username = args[1] && !args[1].match(/^\d+$/) ? args[1] : null;
      const connectMinutes = args[1] && args[1].match(/^\d+$/) ? parseInt(args[1]) : (args[2] ? parseInt(args[2]) : null);
      intentionalDisconnect = false;
      await connectToServer(connectServerName, username, connectMinutes, (msg) => {
        message.channel.send(msg);
      });
      break;

    case 'disconnect':
      if (!mcBot) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      intentionalDisconnect = true;
      cancelReconnection();
      if (disconnectTimer) clearTimeout(disconnectTimer);
      stopAntiAfk();
      stopPingMonitoring();
      mcBot.quit();
      mcBot = null;
      clearLastSession();
      clearConnectionInfo();
      message.channel.send('Minecraft bot disconnected. Auto-reconnect disabled.');
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
      intentionalDisconnect = true;
      cancelReconnection();
      if (disconnectTimer) clearTimeout(disconnectTimer);
      const ms = offlineTime * 60 * 1000;
      disconnectTimer = setTimeout(() => {
        intentionalDisconnect = true;
        if (mcBot) mcBot.quit();
        stopAntiAfk();
        stopPingMonitoring();
        mcBot = null;
        clearLastSession();
        clearConnectionInfo();
        sendLog(`Auto-disconnected after ${offlineTime} minutes.`, 'connectionLogs');
      }, ms);
      message.channel.send(`Set to disconnect in ${offlineTime} minutes. Auto-reconnect disabled.`);
      break;

    case 'setlogchannel':
      if (args.length < 1) {
        message.channel.send('Usage: !setlogchannel <channel_id>');
        return;
      }
      const newChannelId = args[0];
      // Check if the channel is in the allowed command channels
      if (!COMMAND_CHANNEL_IDS.includes(newChannelId)) {
        message.channel.send('This channel is not authorized for bot commands.');
        return;
      }
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
        // Check if the channel is in the allowed command channels
        if (!COMMAND_CHANNEL_IDS.includes(newChannelId)) {
          message.channel.send('This channel is not authorized for bot commands.');
          return;
        }
        const newChannel = discordClient.channels.cache.get(newChannelId);
        if (!newChannel) {
          message.channel.send('Invalid channel ID.');
          return;
        }
        logChannel = newChannel;
        settings.logChannelId = newChannelId;
      } else if (settings.logChannelId) {
        // Check if the saved channel is in the allowed command channels
        if (!COMMAND_CHANNEL_IDS.includes(settings.logChannelId)) {
          message.channel.send('Saved log channel is not authorized. Use !setlogchannel with an authorized channel.');
          return;
        }
        const channel = discordClient.channels.cache.get(settings.logChannelId);
        if (channel) {
          logChannel = channel;
        } else {
          message.channel.send('Saved log channel not found. Use !setlogchannel first.');
          return;
        }
      } else {
        // Use the first command channel as default if no log channel is set
        logChannel = discordClient.channels.cache.get(COMMAND_CHANNEL_IDS[0]);
        settings.logChannelId = COMMAND_CHANNEL_IDS[0];
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
          const attackableEntities = Object.values(mcBot.entities).filter(e => 
            e !== mcBot.entity && 
            e.type === 'mob' && 
            mcBot.entity.position.distanceTo(e.position) < 4
          );
          
          if (attackableEntities.length > 0) {
            attackableEntities.sort((a, b) => 
              mcBot.entity.position.distanceTo(a.position) - mcBot.entity.position.distanceTo(b.position)
            );
            currentTarget = attackableEntities[0];
            mcBot.attack(currentTarget);
            message.channel.send(`Attacking nearest mob: ${currentTarget.displayName || currentTarget.name}.`);
            if (settings.inGameLogging.attackAlerts) mcBot.chat(`Attacking ${currentTarget.displayName || currentTarget.name}!`);
          } else {
            message.channel.send('No attackable entity nearby.');
          }
          break;
        case 'sleep':
          const bedBlock = mcBot.findBlock({
            matching: block => block.name.includes('bed'),
            maxDistance: 4
          });
          
          if (bedBlock) {
            try {
              await mcBot.sleep(bedBlock);
              message.channel.send('Sleeping in the bed.');
              if (settings.inGameLogging.sleepAlerts) mcBot.chat('Good night!');
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
            if (settings.inGameLogging.sleepAlerts) mcBot.chat('Good morning!');
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
    await interaction.editReply('Minecraft bot is not connected.');
    return;
  }
  
  let inventoryText = '**Bot Inventory:**\n';
  
  // Get current held item slot (relative hotbar 0-8)
  const currentHeldSlot = mcBot.quickBarSlot;
  
  // Crafting slots (0-4)
  inventoryText += '**🛠️ Crafting Grid (Slots 0-4):**\n';
  const craftingSlots = [
    { slot: 0, name: 'Output' },
    { slot: 1, name: 'Input Top-Left' },
    { slot: 2, name: 'Input Top-Right' },
    { slot: 3, name: 'Input Bottom-Left' },
    { slot: 4, name: 'Input Bottom-Right' }
  ];
  
  for (const craft of craftingSlots) {
    const item = mcBot.inventory.slots[craft.slot];
    inventoryText += `• ${craft.name} [${craft.slot}]: ${item ? `${item.count}x ${item.displayName || item.name}` : 'Empty'}\n`;
  }
  
  // Armor slots (5-8)
  inventoryText += '\n**🎽 Armor (Slots 5-8):**\n';
  const armorSlots = [
    { slot: 5, name: 'Helmet' },
    { slot: 6, name: 'Chestplate' },
    { slot: 7, name: 'Leggings' },
    { slot: 8, name: 'Boots' }
  ];
  
  for (const armor of armorSlots) {
    const item = mcBot.inventory.slots[armor.slot];
    inventoryText += `• ${armor.name} [${armor.slot}]: ${item ? `${item.count}x ${item.displayName || item.name}` : 'Empty'}\n`;
  }
  
  // Offhand slot
  let offhandItem = null;
  let offhandSlot = null;
  
  // Prefer modern offhand slot
  if (mcBot.inventory.slots[45]) {
    offhandItem = mcBot.inventory.slots[45];
    offhandSlot = 45;
  } else if (mcBot.inventory.slots[40]) {
    offhandItem = mcBot.inventory.slots[40];
    offhandSlot = 40;
  }
  
  inventoryText += `\n**🛡️ Offhand [${offhandSlot || 'N/A'}]:** ${offhandItem ? `${offhandItem.count}x ${offhandItem.displayName || offhandItem.name}` : 'Empty'}\n`;
  
  // Hotbar (slots 36-44)
  inventoryText += '\n**🔥 Hotbar (Slots 36-44):**\n';
  let hotbarText = '';
  for (let i = 0; i < 9; i++) {
    const slot = 36 + i;
    const item = mcBot.inventory.slots[slot];
    const slotDisplay = `[${slot.toString().padStart(2, '0')}]`;
    const isCurrent = (i === currentHeldSlot) ? '✋ ' : '';
    
    if (item) {
      const itemName = (item.displayName || item.name).substring(0, 12);
      hotbarText += `${isCurrent}${slotDisplay} ${item.count}x ${itemName}  `;
    } else {
      hotbarText += `${isCurrent}${slotDisplay} ----------  `;
    }
  }
  inventoryText += hotbarText.trim() + '\n';
  
  // Main inventory grid (3 rows of 9 slots) - slots 9-35
  inventoryText += '\n**📦 Main Inventory (Slots 9-35):**\n';
  
  for (let row = 0; row < 3; row++) {
    let rowText = '';
    for (let col = 0; col < 9; col++) {
      const slot = 9 + (row * 9) + col;
      const item = mcBot.inventory.slots[slot];
      const slotDisplay = `[${slot.toString().padStart(2, '0')}]`;
      
      if (item) {
        const itemName = (item.displayName || item.name).substring(0, 8);
        rowText += `${slotDisplay} ${item.count}x ${itemName}  `;
      } else {
        rowText += `${slotDisplay} --------  `;
      }
    }
    inventoryText += rowText.trim() + '\n';
  }
  
  // Current held item info
  const heldItem = mcBot.inventory.slots[36 + currentHeldSlot];
  if (heldItem) {
    inventoryText += `\n**Currently Holding [${(36 + currentHeldSlot).toString().padStart(2, '0')}]:** ${heldItem.count}x ${heldItem.displayName || heldItem.name}`;
  }
  
  // Inventory summary
  inventoryText += '\n\n**📊 Inventory Summary:**\n';
  const itemCounts = {};
  
  // Check all slots (0-45)
  for (let slot = 0; slot < 46; slot++) {
    const item = mcBot.inventory.slots[slot];
    if (item) {
      const itemName = item.displayName || item.name;
      itemCounts[itemName] = (itemCounts[itemName] || 0) + item.count;
    }
  }
  
  const uniqueItems = Object.keys(itemCounts);
  if (uniqueItems.length > 0) {
    uniqueItems.sort((a, b) => itemCounts[b] - itemCounts[a]);
    uniqueItems.slice(0, 15).forEach(itemName => {
      inventoryText += `• ${itemCounts[itemName]}x ${itemName}\n`;
    });
    if (uniqueItems.length > 15) {
      inventoryText += `• ... and ${uniqueItems.length - 15} more items`;
    }
  } else {
    inventoryText += 'No items in inventory';
  }
  
  // Health and food status
  inventoryText += `\n**❤️ Health:** ${mcBot.health}/20 | **🍖 Food:** ${mcBot.food}/20`;
  
  // Truncate if too long for Discord (2000 char limit)
  if (inventoryText.length > 2000) {
    inventoryText = inventoryText.substring(0, 1900) + '\n... (inventory too large to display completely)';
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
        await interaction.editReply('Minecraft bot is not connected.');
        return;
    }
    
    const dropSlot = options.getInteger('slot');
    const dropCount = options.getInteger('count') || 1;
    
    // Use the correct slot range (0-44 for main inventory + armor)
    if (dropSlot < 0 || dropSlot > 44) {
        await interaction.editReply('Slot number must be between 0 and 44.');
        return;
    }
    
    try {
        const item = mcBot.inventory.slots[dropSlot];
        if (!item) {
            await interaction.editReply(`Slot [${dropSlot}] is empty.`);
            return;
        }
        
        // Use the correct method for dropping items from specific slots
        // For armor slots (36-39) and main inventory (0-35), we can use tossStack
        if (dropCount >= item.count) {
            // Drop entire stack
            await mcBot.tossStack(item);
        } else {
            // Drop specific count - we need to use a different approach
            // Since tossStack doesn't support partial drops, we'll drop the entire stack
            // and re-add the remaining items if needed
            await interaction.editReply(`Partial dropping not supported yet. Dropping entire stack of ${item.count} items.`);
            await mcBot.tossStack(item);
        }
        
        await interaction.editReply(`Dropped ${dropCount} item(s) from slot [${dropSlot}].`);
    } catch (error) {
        console.error('Drop item error:', error);
            message.channel.send(`Failed to drop items: ${error.message}`);
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
            
            // Better armor detection - check for actual armor types
            const isArmor = item.name.includes('helmet') || 
                           item.name.includes('chestplate') || 
                           item.name.includes('leggings') || 
                           item.name.includes('boots') ||
                           item.name.includes('cap') || // leather cap
                           item.name.includes('tunic') || // leather tunic
                           item.name.includes('pants'); // leather pants
            
            if (isArmor) {
              // Determine armor type and equip to correct slot
              let armorType = 'head';
              if (item.name.includes('chestplate') || item.name.includes('tunic')) armorType = 'torso';
              else if (item.name.includes('leggings') || item.name.includes('pants')) armorType = 'legs';
              else if (item.name.includes('boots')) armorType = 'feet';
              
              await mcBot.equip(item, armorType);
              await interaction.editReply(`Equipped ${item.displayName || item.name} as ${armorType} armor.`);
            } else {
              await interaction.editReply('Item is not equipable armor. Armor must be helmet, chestplate, leggings, or boots.');
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

    case 'scheduleconnect':
      if (args.length < 2) {
        message.channel.send('Usage: !scheduleconnect <server_name> <delay_minutes> [username] [connect_time]');
        return;
      }
      
      const scheduleServerName = args[0];
      const delayMinutes = parseInt(args[1]);
      const scheduleUsername = args[2] && !args[2].match(/^\d+$/) ? args[2] : null;
      const scheduleConnectTime = args[2] && args[2].match(/^\d+$/) ? parseInt(args[2]) : (args[3] ? parseInt(args[3]) : null);

      if (!savedServers[scheduleServerName]) {
        message.channel.send(`Server "${scheduleServerName}" not found. Use !addserver first.`);
        return;
      }

      if (isNaN(delayMinutes) || delayMinutes <= 0) {
        message.channel.send('Delay must be a positive number of minutes.');
        return;
      }

      const connectionId = scheduleConnection(scheduleServerName, delayMinutes, scheduleUsername, scheduleConnectTime);
      
      message.channel.send(
        `✅ Connection to **${scheduleServerName}** scheduled in **${delayMinutes} minutes**.\n` +
        `Connection ID: ${connectionId}`
      );
      break;

    case 'listscheduled':
      const scheduledList = listScheduledConnections();
      message.channel.send(scheduledList);
      break;

    case 'cancelschedule':
      if (args.length < 1) {
        message.channel.send('Usage: !cancelschedule <connection_id>');
        return;
      }
      
      const connectionIdToCancel = args[0];
      
      if (scheduledConnections[connectionIdToCancel]) {
        cancelScheduledConnection(connectionIdToCancel);
        message.channel.send(`✅ Cancelled scheduled connection (ID: ${connectionIdToCancel})`);
      } else {
        message.channel.send('❌ No scheduled connection found with that ID.');
      }
      break;

    case 'cancelreconnect':
      cancelReconnection();
      clearLastSession();
      clearConnectionInfo();
      message.channel.send('✅ Automatic reconnection cancelled and last session cleared.');
      break;

    case 'connectioninfo':
      if (!mcBot || !connectionStartTime) {
        message.channel.send('Minecraft bot is not connected.');
        return;
      }
      
      const serverInfo = savedServers[currentServerName];
      if (!serverInfo) {
        message.channel.send('Error: Could not retrieve server information.');
        return;
      }
      
      // Calculate connection duration
      const now = new Date();
      const durationMs = now - connectionStartTime;
      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((durationMs % (1000 * 60)) / 1000);
      
      const durationString = hours > 0 
        ? `${hours}h ${minutes}m ${seconds}s`
        : `${minutes}m ${seconds}s`;
      
      const connectionInfo = `**Connection Information:**
🌐 **Server:** ${currentServerName} (${serverInfo.host}:${serverInfo.port})
👤 **Username:** ${currentBotUsername}
⏰ **Connected Since:** ${connectionStartTime.toLocaleString()}
⏱️ **Duration:** ${durationString}`;
      
      message.channel.send(connectionInfo);
      break;

    case 'togglelog':
      if (args.length < 2) {
        message.channel.send('Usage: !togglelog <type> <on/off>\nTypes: time, damage, death, path, chat, ping, connection, resources');
        return;
      }

      const logTypeShort = args[0].toLowerCase();
      const stateStr = args[1].toLowerCase();
      const state = stateStr === 'on' ? true : (stateStr === 'off' ? false : null);

      if (state === null) {
        message.channel.send('State must be on or off.');
        return;
      }

      const typeMap = {
        'time': 'timeUpdates',
        'damage': 'damageAlerts',
        'death': 'deathAlerts',
        'path': 'pathAlerts',
        'chat': 'chatLogs',
        'ping': 'pingAlerts',
        'connection': 'connectionLogs',
        'resources': 'lowResources',
      };

      const logType = typeMap[logTypeShort];

      if (!logType) {
        message.channel.send('Invalid log type. Available: time, damage, death, path, chat, ping, connection, resources');
        return;
      }

      settings.logging[logType] = state;
      saveData(SETTINGS_FILE, settings);
      message.channel.send(`Discord logging for ${logTypeShort} set to ${state ? 'on' : 'off'}.`);
      break;

    case 'toggleingamelog':
      if (args.length < 2) {
        message.channel.send('Usage: !toggleingamelog <type> <on/off>\nTypes: time, damage, death, attack, sleep');
        return;
      }

      const inGameLogTypeShort = args[0].toLowerCase();
      const inGameStateStr = args[1].toLowerCase();
      const inGameState = inGameStateStr === 'on' ? true : (inGameStateStr === 'off' ? false : null);

      if (inGameState === null) {
        message.channel.send('State must be on or off.');
        return;
      }

      const inGameTypeMap = {
        'time': 'timeUpdates',
        'damage': 'damageAlerts',
        'death': 'deathAlerts',
        'attack': 'attackAlerts',
        'sleep': 'sleepAlerts',
      };

      const inGameLogType = inGameTypeMap[inGameLogTypeShort];

      if (!inGameLogType) {
        message.channel.send('Invalid in-game log type. Available: time, damage, death, attack, sleep');
        return;
      }

      settings.inGameLogging[inGameLogType] = inGameState;
      saveData(SETTINGS_FILE, settings);
      message.channel.send(`In-game logging for ${inGameLogTypeShort} set to ${inGameState ? 'on' : 'off'}.`);
      break;

    default:
      message.channel.send('Unknown command. Available: addserver, listservers, connect, disconnect, offline, setlogchannel, stoplog, startlog, respawn, interact, players, say, command, move, stop, jump, afk, coords, goto, inventory, switchslot, hotbar, dropitem, equip, health, ping, eat, scheduleconnect, listscheduled, cancelschedule, cancelreconnect, connectioninfo, togglelog, toggleingamelog');
  }
});

initializeHealthServer(discordClient);

discordClient.login(process.env.DISCORD_TOKEN);