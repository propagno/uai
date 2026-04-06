'use strict';

const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  constructor(opts = {}) {
    this.level = LEVELS[opts.level || 'info'] ?? 1;
    this.logDir = opts.logDir || null;
    this._stream = null;
  }

  _openStream() {
    if (this._stream || !this.logDir) return;
    fs.mkdirSync(this.logDir, { recursive: true });
    const name = new Date().toISOString().slice(0, 10) + '.log';
    this._stream = fs.createWriteStream(path.join(this.logDir, name), { flags: 'a' });
  }

  _write(levelName, msg, data) {
    const ts = new Date().toISOString();
    const line = data
      ? `[${ts}] ${levelName.toUpperCase()} ${msg} ${JSON.stringify(data)}`
      : `[${ts}] ${levelName.toUpperCase()} ${msg}`;

    if (LEVELS[levelName] >= this.level) {
      const color = levelName === 'error' ? '\x1b[31m'
                  : levelName === 'warn'  ? '\x1b[33m'
                  : levelName === 'info'  ? '\x1b[36m'
                  : '';
      process.stderr.write(color + line + '\x1b[0m\n');
    }

    if (this.logDir) {
      this._openStream();
      this._stream.write(line + '\n');
    }
  }

  debug(msg, data) { this._write('debug', msg, data); }
  info(msg, data)  { this._write('info',  msg, data); }
  warn(msg, data)  { this._write('warn',  msg, data); }
  error(msg, data) { this._write('error', msg, data); }

  close() {
    if (this._stream) { this._stream.end(); this._stream = null; }
  }
}

// Singleton used by CLI; can be replaced for tests
let _instance = new Logger();

function getLogger() { return _instance; }
function setLogger(l) { _instance = l; }

module.exports = { Logger, getLogger, setLogger };
