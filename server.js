const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const { connectDB } = require('./config/db');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key']
  }
});

app.set('io', io);

io.on('connection', (socket) => {
  socket.on('join_thread', ({ email } = {}) => {
    if (email) {
      const room = `thread:${String(email).trim().toLowerCase()}`;
      socket.join(room);
    }
  });

  socket.on('join_admin', () => {
    socket.join('admin_room');
  });
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: process.env.CLIENT_URL || '*',
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key']
  })
);
app.use(express.json());
app.use(morgan('dev'));

app.use('/api', apiRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

const clientBuildPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientBuildPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'), (err) => {
    if (err) {
      res.status(200).json({
        message: 'API is running. Start Vite client on port 5173.'
      });
    }
  });
});

connectDB().finally(() => {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});