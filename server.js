const express = require('express');
const { v4: uuidv4 } = require('uuid');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// In-memory store
const rooms = {}; // key: { messages: [], users: [], expiresAt, clients: [] }

function cleanExpiredRooms() {
  const now = Date.now();
  for (const key in rooms) {
    const room = rooms[key];
    if (room.expiresAt < now) {
      // end all open SSE connections
      room.clients.forEach(res => res.end());
      delete rooms[key];
    } else {
      // delete messages older than 24hrs
      room.messages = room.messages.filter(msg => now - msg.timestamp < 24 * 3600 * 1000);
    }
  }
}
setInterval(cleanExpiredRooms, 60 * 1000); // every 1 minute

// Create key
app.get('/generate-key', (req, res) => {
  const key = uuidv4().split('-')[0];
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  rooms[key] = {
    messages: [],
    users: [],
    clients: [],
    expiresAt
  };
  res.json({ key });
});

// Join room
app.get('/join-room/:key', (req, res) => {
  const key = req.params.key;
  const room = rooms[key];

  if (!room || room.expiresAt < Date.now()) {
    return res.json({ success: false });
  }

  const username = `user${room.users.length + 1}`;
  room.users.push(username);

  res.json({
    success: true,
    username,
    expiresAt: new Date(room.expiresAt).toISOString(),
    history: room.messages.map(msg => `${msg.user}: ${msg.message}`)
  });
});

// Receive message
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

// SSE message stream
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
