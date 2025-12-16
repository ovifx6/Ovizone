const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const BOT_MAIN = process.env.BOT_MAIN || 'Rxabdullah.js';
const BOT_CWD = process.env.BOT_CWD || path.join(__dirname, 'bot'); // put your bot files here

let botProcess = null;
let botStatus = 'stopped';

function writeJSONSafe(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

app.get('/status', (req, res) => {
  res.json({ status: botStatus, pid: botProcess ? botProcess.pid : null });
});

app.post('/activate', (req, res) => {
  try {
    const { name, prefix, adminUID, appstate } = req.body;

    // Save config
    const cfg = { name, prefix, adminUID };
    const cfgPath = path.join(__dirname, 'config.json');
    writeJSONSafe(cfgPath, cfg);

    // Save appstate
    const appstatePath = path.join(__dirname, 'appstate.json');
    // If user sent a string, try parse
    let appstateObj = appstate;
    if (typeof appstate === 'string') {
      try { appstateObj = JSON.parse(appstate); } catch(e) { appstateObj = appstate; }
    }
    writeJSONSafe(appstatePath, appstateObj);

    // Restart bot if already running
    if (botProcess) {
      try {
        botProcess.kill('SIGTERM');
      } catch(e) { /* ignore */ }
      botProcess = null;
      botStatus = 'stopped';
    }

    // Spawn new bot process
    const fullBotPath = path.join(BOT_CWD, BOT_MAIN);
    botProcess = spawn('node', [fullBotPath], {
      cwd: BOT_CWD,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    botProcess.stdout.on('data', (data) => {
      console.log('[BOT]', data.toString());
    });
    botProcess.stderr.on('data', (data) => {
      console.error('[BOT-ERR]', data.toString());
    });
    botProcess.on('close', (code) => {
      console.log('Bot exited with code', code);
      botProcess = null;
      botStatus = 'stopped';
    });

    botStatus = 'running';

    res.json({ status: 'started', pid: botProcess.pid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/stop', (req, res) => {
  if (!botProcess) return res.json({ status: 'not_running' });
  try {
    botProcess.kill('SIGTERM');
    botProcess = null;
    botStatus = 'stopped';
    return res.json({ status: 'stopped' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Optional: endpoint to read current config
app.get('/config', (req, res) => {
  try {
    const cfg = fs.existsSync('./config.json') ? JSON.parse(fs.readFileSync('./config.json')) : {};
    const appstate = fs.existsSync('./appstate.json') ? JSON.parse(fs.readFileSync('./appstate.json')) : {};
    res.json({ config: cfg, appstate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log('Control server listening on', PORT));
