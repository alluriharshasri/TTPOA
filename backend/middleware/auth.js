const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ttpoa-admin-secret-key-2026';

function authMiddleware(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// For page redirects (not API)
function authPageMiddleware(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.redirect('/ttpoa/admin/login');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.redirect('/ttpoa/admin/login');
  }
}

module.exports = { authMiddleware, authPageMiddleware, JWT_SECRET };
