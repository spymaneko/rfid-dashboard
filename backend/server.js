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
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Initialize SQLite Database
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Create tables
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reg_number TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // RFID logs table
  db.run(`CREATE TABLE IF NOT EXISTS rfid_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL,
    card_uid TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default user with reg number 6216922
  const defaultPassword = bcrypt.hashSync('password123', 10);
  db.run(`INSERT OR IGNORE INTO users (reg_number, name, email, password) 
          VALUES (?, ?, ?, ?)`, 
          ['6216922', 'Default User', 'user@example.com', defaultPassword]);
});

const JWT_SECRET = 'rfid-dashboard-secret-key';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Routes

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { regNumber, name, email, password } = req.body;

    // Check if user exists
    db.get('SELECT * FROM users WHERE reg_number = ? OR email = ?', 
      [regNumber, email], async (err, row) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        if (row) {
          return res.status(400).json({ error: 'User already exists' });
        }

        // Hash password and create user
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run('INSERT INTO users (reg_number, name, email, password) VALUES (?, ?, ?, ?)',
          [regNumber, name, email, hashedPassword],
          function(err) {
            if (err) {
              return res.status(500).json({ error: 'Failed to create user' });
            }
            res.status(201).json({ message: 'User registered successfully' });
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
app.post('/api/login', (req, res) => {
  const { regNumber, password } = req.body;

  db.get('SELECT * FROM users WHERE reg_number = ?', [regNumber], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Check password
    bcrypt.compare(password, user.password, (err, valid) => {
      if (err || !valid) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      // Generate token
      const token = jwt.sign(
        { userId: user.id, regNumber: user.reg_number },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        token,
        user: {
          id: user.id,
          regNumber: user.reg_number,
          name: user.name,
          email: user.email
        }
      });
    });
  });
});

// Add RFID log
app.post('/api/rfid-log', (req, res) => {
  const { user, uid, action, status } = req.body;

  db.run('INSERT INTO rfid_logs (user_name, card_uid, action, status) VALUES (?, ?, ?, ?)',
    [user, uid, action, status],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to log RFID event' });
      }

      // Emit real-time update to all connected clients
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

// Get RFID logs
app.get('/api/rfid-logs', authenticateToken, (req, res) => {
  db.all('SELECT * FROM rfid_logs ORDER BY timestamp DESC LIMIT 100', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch logs' });
    }
    res.json(rows);
  });
});

// Get dashboard stats
app.get('/api/dashboard-stats', authenticateToken, (req, res) => {
  const queries = [
    'SELECT COUNT(*) as total FROM rfid_logs',
    'SELECT COUNT(DISTINCT user_name) as unique_users FROM rfid_logs',
    `SELECT COUNT(*) as today FROM rfid_logs 
     WHERE DATE(timestamp) = DATE('now')`
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

// Socket.io for real-time updates
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});