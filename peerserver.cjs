const { PeerServer } = require('peer');

const server = PeerServer({
  port: 9000,
  path: '/myapp',
  allow_discovery: true,
});

server.on('connection', (client) => {
  console.log('Client connected:', client.getId());
});

server.on('disconnect', (client) => {
  console.log('Client disconnected:', client.getId());
});

console.log('PeerJS server running on port 9000');
