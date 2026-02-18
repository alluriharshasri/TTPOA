const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const { initializeDatabase, updateEventStatuses } = require('./database');
const { authPageMiddleware } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:4321', 'http://localhost:3000', 'http://127.0.0.1:4321'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes - API
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);

// Admin Pages
app.get('/ttpoa/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/ttpoa/admin/dashboard', authPageMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// Redirect /ttpoa/admin to login
app.get('/ttpoa/admin', (req, res) => {
  res.redirect('/ttpoa/admin/login');
});

// Auto-update event statuses every 5 minutes
setInterval(updateEventStatuses, 5 * 60 * 1000);

// Initialize database (async for sql.js WASM loading) then start server
(async () => {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`\n🚀 TTPOA Backend Server running on http://localhost:${PORT}`);
      console.log(`📋 Admin Login: http://localhost:${PORT}/ttpoa/admin/login`);
      console.log(`📡 API Base: http://localhost:${PORT}/api`);
      console.log(`\nDefault Admin Credentials:`);
      console.log(`  Username: admin`);
      console.log(`  Password: Admin@123\n`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();
