function ensureSettingsDefaults(settings = {}) {
  const safeSettings = settings && typeof settings === 'object' ? settings : {};

  if (typeof safeSettings.autoReconnectEnabled !== 'boolean') {
    safeSettings.autoReconnectEnabled = true;
  }

  return safeSettings;
}

module.exports = {
  ensureSettingsDefaults,
};
