const express = require('express');
const { v4: uuidv4 } = require('uuid');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const rooms = {}; // key: { messages: [], users: [{ username, password }], clients: [], expiresAt }

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

app.get('/generate-key', (req, res) => {
  const key = uuidv4().split('-')[0];
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  rooms[key] = { messages: [], users: [], clients: [], expiresAt };
  res.json({ key });
});

app.get('/join-room/:key', (req, res) => {
  const key = req.params.key;
  const room = rooms[key];
  if (!room || room.expiresAt < Date.now()) return res.json({ success: false });
  res.json({ success: true });
});

app.post('/login', (req, res) => {
  const { key, username, password } = req.body;
  const room = rooms[key];
  if (!room || room.expiresAt < Date.now()) return res.json({ success: false });

  const existing = room.users.find(u => u.username === username);
  if (existing) {
    if (existing.password !== password) return res.json({ success: false });
  } else {
    room.users.push({ username, password });
  }

  res.json({
    success: true,
    expiresAt: new Date(room.expiresAt).toISOString(),
    history: room.messages.map(m => `${m.user}: ${m.message}`)
  });
});

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

app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
