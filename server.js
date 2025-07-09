const express = require('express');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// Telegram Bot Config
const BOT_TOKEN = '8157449994:AAENXtv_w_gfBz36ZVD_DKLETHzYzpEvAAM';
const CHANNEL_ID = '-1002846991732';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Fetch auth details from Telegram channel messages
async function fetchAuthFromTelegram(roomKey, username) {
  try {
    // Telegram API doesn't have getChatHistory, use getUpdates won't help for channels,
    // so instead use getChatHistory method (Telegram Bot API doesn't support it directly),
    // We'll use getChatMessage with offset = -100 and try getMessages using Telegram API with channel_id and limit.
    // But Telegram Bot API doesn't provide fetching channel history.
    // So we need to use Telegram Client API or a workaround.
    // Since Telegram Bot API cannot fetch channel history, here is a workaround using getUpdates of messages sent by bot.

    // For this example, we simulate with getUpdates for the bot only:
    const response = await axios.get(`${TELEGRAM_API}/getUpdates`, { params: { limit: 100 } });

    const updates = response.data.result || [];

    // Search messages from the channel in updates (if the bot posted those messages)
    for (const update of updates) {
      if (!update.message || !update.message.text) continue;

      // Only messages in the correct channel
      if (update.message.chat && update.message.chat.id == CHANNEL_ID) {
        const text = update.message.text;

        if (text.includes(`Room: ${roomKey}`) && text.includes(`Username: ${username}`)) {
          const passMatch = text.match(/Password:\s*(.+)/);
          if (passMatch) {
            return passMatch[1].trim();
          }
        }
      }
    }

    return null;
  } catch (err) {
    console.error('Telegram auth fetch error:', err.message);
    return null;
  }
}

const rooms = {}; // rooms with messages, clients, expiresAt

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

// Generate a new room key
app.get('/generate-key', (req, res) => {
  const key = uuidv4().split('-')[0];
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  rooms[key] = { messages: [], clients: [], expiresAt };
  res.json({ key });
});

// Check if room exists and is active
app.get('/join-room/:key', (req, res) => {
  const key = req.params.key;
  const room = rooms[key];
  if (!room || room.expiresAt < Date.now()) return res.json({ success: false });
  res.json({ success: true });
});

// Login - verify username & password fetched from Telegram
app.post('/login', async (req, res) => {
  const { key, username, password } = req.body;
  const room = rooms[key];
  if (!room || room.expiresAt < Date.now()) return res.json({ success: false });

  const expectedPassword = await fetchAuthFromTelegram(key, username);

  if (!expectedPassword || expectedPassword !== password) {
    return res.json({ success: false });
  }

  res.json({
    success: true,
    expiresAt: new Date(room.expiresAt).toISOString(),
    history: room.messages.map(m => `${m.user}: ${m.message}`)
  });
});

// Send chat message
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

// Stream messages using Server-Sent Events (SSE)
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
