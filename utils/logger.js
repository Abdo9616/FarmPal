// logger.js
module.exports = function initializeLogger() {
    // Save original console methods
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
  
    // ANSI color codes
    const colors = {
      reset: '\x1b[0m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m'
    };
  
    // Set default timezone to UTC, but allow override via .env
    const timezone = process.env.bot_timezone === 'system' ? Intl.DateTimeFormat().resolvedOptions().timeZone : (process.env.bot_timezone || 'UTC');
  
    function getFormattedTimestamp() {
      const now = new Date();
      
      // Convert to specified timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      
      const parts = formatter.formatToParts(now);
      const year = parts.find(part => part.type === 'year').value;
      const month = parts.find(part => part.type === 'month').value;
      const day = parts.find(part => part.type === 'day').value;
      const hour = parts.find(part => part.type === 'hour').value;
      const minute = parts.find(part => part.type === 'minute').value;
      const second = parts.find(part => part.type === 'second').value;
      const dayPeriod = parts.find(part => part.type === 'dayPeriod').value;
      
      return `[${year}/${month}/${day} ${hour}:${minute}:${second} ${dayPeriod}]`;
    }
  
    // Override console.log
    console.log = function(...args) {
      const timestamp = getFormattedTimestamp();
      originalConsoleLog(`${timestamp} [INFO]`, ...args);
    };
  
    // Override console.error
    console.error = function(...args) {
      const timestamp = getFormattedTimestamp();
      originalConsoleError(`${colors.red}${timestamp} [ERROR]`, ...args, colors.reset);
    };
  
    // Override console.warn
    console.warn = function(...args) {
      const timestamp = getFormattedTimestamp();
      originalConsoleWarn(`${colors.yellow}${timestamp} [WARN]`, ...args, colors.reset);
    };
  
    // Log timezone info on startup
    console.log(`✅ Custom logger initialized with timezone: ${colors.green}${timezone}${colors.reset}`);
  };