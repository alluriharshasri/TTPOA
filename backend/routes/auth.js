const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const db = getDb();
  const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get(username);

  if (!admin) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const validPassword = bcrypt.compareSync(password, admin.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: admin.id, username: admin.username },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  });

  res.json({ success: true, message: 'Login successful' });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out' });
});

// GET /api/auth/check
router.get('/check', (req, res) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ authenticated: false });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ authenticated: true, username: decoded.username });
  } catch {
    res.status(401).json({ authenticated: false });
  }
});

// PUT /api/auth/change-password
router.put('/change-password', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { currentPassword, newPassword } = req.body;

    const db = getDb();
    const admin = db.prepare('SELECT * FROM admin WHERE id = ?').get(decoded.id);

    if (!bcrypt.compareSync(currentPassword, admin.password)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE admin SET password = ? WHERE id = ?').run(hashedPassword, decoded.id);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
