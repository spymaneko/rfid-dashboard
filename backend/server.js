import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Serve static files from dist folder
app.use(express.static(path.join(__dirname, 'dist')));

// Database setup
const db = new sqlite3.Database(':memory:', (err) => {
  if (err) {
    console.error('Database error:', err);
  } else {
    console.log('Database connected');
  }
});

// Create tables (your existing code)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reg_number TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rfid_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL,
    card_uid TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const defaultPassword = bcrypt.hashSync('password123', 10);
  db.run(`INSERT OR IGNORE INTO users (reg_number, name, email, password) 
          VALUES (?, ?, ?, ?)`, 
          ['6216922', 'Default User', 'user@example.com', defaultPassword]);
});

const JWT_SECRET = 'rfid-dashboard-secret';

// API Routes (keep your existing routes)
app.post('/api/login', (req, res) => {
  // Your existing login code
});

app.post('/api/register', async (req, res) => {
  // Your existing register code
});

app.post('/api/rfid-log', (req, res) => {
  const { user, uid, action, status } = req.body;

  db.run('INSERT INTO rfid_logs (user_name, card_uid, action, status) VALUES (?, ?, ?, ?)',
    [user, uid, action, status],
    function(err) {
      if (err) return res.status(500).json({ error: 'Failed to log RFID event' });

      const newLog = {
        id: this.lastID,
        user_name: user,
        card_uid: uid,
        action: action,
        status: status,
        timestamp: new Date().toISOString()
      };

      io.emit('new-rfid-log', newLog);
      res.json({ message: 'Log added successfully', log: newLog });
    }
  );
});

app.get('/api/rfid-logs', (req, res) => {
  db.all('SELECT * FROM rfid_logs ORDER BY timestamp DESC LIMIT 100', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch logs' });
    res.json(rows);
  });
});

app.get('/api/dashboard-stats', (req, res) => {
  const queries = [
    'SELECT COUNT(*) as total FROM rfid_logs',
    'SELECT COUNT(DISTINCT user_name) as unique_users FROM rfid_logs',
    'SELECT COUNT(*) as today FROM rfid_logs WHERE DATE(timestamp) = DATE("now")'
  ];

  db.serialize(() => {
    db.get(queries[0], (err, totalRow) => {
      db.get(queries[1], (err, usersRow) => {
        db.get(queries[2], (err, todayRow) => {
          res.json({
            totalEntries: totalRow.total,
            uniqueUsers: usersRow.unique_users,
            todayEntries: todayRow.today
          });
        });
      });
    });
  });
});

// Serve the dashboard for all routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Dashboard: http://localhost:${PORT}`);
});
