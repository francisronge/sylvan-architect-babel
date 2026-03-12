const fs = require('node:fs');
const path = require('node:path');

function parseBooleanLike(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  return /^(1|true|yes|on)$/i.test(raw);
}

module.exports = function loadLocalEnv() {
  const root = path.resolve(__dirname, '../..');
  const candidates = ['.env.local', '.env'].map((name) => path.join(root, name));

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;

    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match) continue;

      const [, key, rawValue] = match;
      if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;

      let value = rawValue.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      value = value.replace(/\\n/g, '\n');
      process.env[key] = value;
    }

    if (parseBooleanLike(process.env.BABEL_DEBUG_ENV_LOAD)) {
      console.log(`[harness-env] loaded ${path.basename(filePath)}`);
    }
    return;
  }
};
