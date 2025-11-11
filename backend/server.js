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

// ✅ FIX: Use memory database for now (it works!)
const db = new sqlite3.Database(':memory:', (err) => {
  if (err) {
    console.error('Database error:', err);
  } else {
    console.log('✅ Database connected');
  }
});

// ✅ SIMPLE table creation
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reg_number TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // RFID logs table
  db.run(`CREATE TABLE rfid_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL,
    card_uid TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Default user
  const defaultPassword = bcrypt.hashSync('password123', 10);
  db.run(`INSERT INTO users (reg_number, name, email, password) VALUES (?, ?, ?, ?)`, 
    ['6216922', 'Default User', 'user@example.com', defaultPassword],
    function(err) {
      if (err) {
        console.log('Default user already exists');
      } else {
        console.log('✅ Default user created: 6216922 / password123');
      }
    }
  );
});

const JWT_SECRET = 'rfid-dashboard-secret';

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 RFID Dashboard API is LIVE!',
    status: 'Running',
    version: '1.0.0'
  });
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { regNumber, password } = req.body;
  console.log('Login attempt for:', regNumber);

  db.get('SELECT * FROM users WHERE reg_number = ?', [regNumber], (err, user) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!user) {
      console.log('User not found:', regNumber);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    bcrypt.compare(password, user.password, (err, valid) => {
      if (err || !valid) {
        console.log('Invalid password for:', regNumber);
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { userId: user.id, regNumber: user.reg_number },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      console.log('Login successful for:', user.name);
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

// Register endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { regNumber, name, email, password } = req.body;
    console.log('Registration attempt:', regNumber, name);

    db.get('SELECT * FROM users WHERE reg_number = ? OR email = ?', 
      [regNumber, email], async (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        if (row) {
          console.log('User already exists:', regNumber);
          return res.status(400).json({ error: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        db.run('INSERT INTO users (reg_number, name, email, password) VALUES (?, ?, ?, ?)',
          [regNumber, name, email, hashedPassword],
          function(err) {
            if (err) {
              console.error('Failed to create user:', err);
              return res.status(500).json({ error: 'Failed to create user' });
            }
            console.log('User registered successfully:', name);
            res.status(201).json({ message: 'User registered successfully' });
          }
        );
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// RFID log endpoint
app.post('/api/rfid-log', (req, res) => {
  const { user, uid, action, status } = req.body;
  console.log('RFID Log:', user, uid, action, status);

  db.run('INSERT INTO rfid_logs (user_name, card_uid, action, status) VALUES (?, ?, ?, ?)',
    [user, uid, action, status],
    function(err) {
      if (err) {
        console.error('Failed to log RFID:', err);
        return res.status(500).json({ error: 'Failed to log RFID event' });
      }

      const newLog = {
        id: this.lastID,
        user_name: user,
        card_uid: uid,
        action: action,
        status: status,
        timestamp: new Date().toISOString()
      };

      io.emit('new-rfid-log', newLog);
      console.log('RFID log saved:', newLog);
      res.json({ message: 'Log added successfully', log: newLog });
    }
  );
});

// Get RFID logs
app.get('/api/rfid-logs', (req, res) => {
  db.all('SELECT * FROM rfid_logs ORDER BY timestamp DESC LIMIT 100', (err, rows) => {
    if (err) {
      console.error('Failed to fetch logs:', err);
      return res.status(500).json({ error: 'Failed to fetch logs' });
    }
    res.json(rows);
  });
});

// Get dashboard stats
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
          if (err) {
            console.error('Stats error:', err);
            return res.status(500).json({ error: 'Failed to get stats' });
          }
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
