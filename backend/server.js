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

// ✅ FIX: Use FILE database instead of memory
const db = new sqlite3.Database('./rfid_database.db', (err) => {
  if (err) {
    console.error('Database error:', err);
  } else {
    console.log('✅ Connected to persistent SQLite database');
    console.log('📊 Data will survive server restarts!');
  }
});

// ✅ FIX: Better table creation with error handling
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reg_number TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating users table:', err);
    } else {
      console.log('✅ Users table ready');
    }
  });

  // RFID logs table
  db.run(`CREATE TABLE IF NOT EXISTS rfid_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL,
    card_uid TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating rfid_logs table:', err);
    } else {
      console.log('✅ RFID logs table ready');
    }
  });

  // ✅ FIX: Insert default user only if doesn't exist
  const defaultPassword = bcrypt.hashSync('password123', 10);
  db.get('SELECT * FROM users WHERE reg_number = ?', ['6216922'], (err, row) => {
    if (err) {
      console.error('Error checking default user:', err);
    } else if (!row) {
      db.run(`INSERT INTO users (reg_number, name, email, password) VALUES (?, ?, ?, ?)`, 
        ['6216922', 'Default User', 'user@example.com', defaultPassword],
        function(err) {
          if (err) {
            console.error('Error creating default user:', err);
          } else {
            console.log('✅ Default user created: 6216922 / password123');
          }
        }
      );
    } else {
      console.log('✅ Default user already exists');
    }
  });
});

const JWT_SECRET = 'rfid-dashboard-secret';

// ... rest of your API routes remain the same ...
// (login, register, rfid-log, rfid-logs, dashboard-stats)

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
  console.log(`💾 Database: rfid_database.db (persistent)`);
});
