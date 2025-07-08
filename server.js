const express = require('express');
const { v4: uuidv4 } = require('uuid');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const rooms = {}; // key: { messages: [], expiresAt: Date, clients: [] }

function cleanExpiredRooms() {
  const now = Date.now();
  for (let key in rooms) {
    if (rooms[key].expiresAt < now) {
      rooms[key].clients.forEach(res => res.end());
      delete rooms[key];
    }
  }
}
setInterval(cleanExpiredRooms, 1000 * 60); // check every 1 minute

app.get('/generate-key', (req, res) => {
  const key = uuidv4().split('-')[0];
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  rooms[key] = { messages: [], expiresAt, clients: [] };
  res.json({ key });
});

app.get('/join-room/:key', (req, res) => {
  const room = rooms[req.params.key];
  if (!room || room.expiresAt < Date.now()) return res.json({ success: false });
  res.json({ success: true, expiresAt: new Date(room.expiresAt).toISOString() });
});

app.post('/send-message', (req, res) => {
  const { key, message } = req.body;
  const room = rooms[key];
  if (!room) return res.status(404).end();
  room.messages.push(message);
  room.clients.forEach(client => client.write(`data: ${message}\n\n`));
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

  room.clients.push(res);

  req.on('close', () => {
    room.clients = room.clients.filter(c => c !== res);
  });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
