const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb, updateEventStatuses } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// All admin routes require authentication
router.use(authMiddleware);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Use event name as base filename if available, fall back to timestamp
    const eventName = req.body.name || req.body.event_name || '';
    const sanitized = eventName
      ? eventName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 60)
      : '';
    const base = sanitized || 'upload';
    const uniqueSuffix = Date.now();
    cb(null, `${base}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// ==================== NEWS TICKER ====================

// GET /api/admin/news-ticker
router.get('/news-ticker', (req, res) => {
  const db = getDb();
  const items = db.prepare('SELECT * FROM news_ticker ORDER BY sort_order ASC').all();
  res.json(items);
});

// POST /api/admin/news-ticker
router.post('/news-ticker', (req, res) => {
  const { text, link, active, sort_order } = req.body;
  if (!text) return res.status(400).json({ error: 'Text is required' });

  const db = getDb();
  const result = db.prepare(
    'INSERT INTO news_ticker (text, link, active, sort_order) VALUES (?, ?, ?, ?)'
  ).run(text, link || '', active !== undefined ? active : 1, sort_order || 0);

  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/admin/news-ticker/:id
router.put('/news-ticker/:id', (req, res) => {
  const { text, link, active, sort_order } = req.body;
  const db = getDb();

  db.prepare(
    'UPDATE news_ticker SET text = ?, link = ?, active = ?, sort_order = ? WHERE id = ?'
  ).run(text, link || '', active !== undefined ? active : 1, sort_order || 0, req.params.id);

  res.json({ success: true });
});

// DELETE /api/admin/news-ticker/:id
router.delete('/news-ticker/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM news_ticker WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== EVENTS ====================

// GET /api/admin/events
router.get('/events', (req, res) => {
  updateEventStatuses();
  const db = getDb();
  const events = db.prepare('SELECT * FROM events ORDER BY date DESC').all();

  const getGallery = db.prepare('SELECT id, image_path FROM event_gallery WHERE event_id = ?');
  const result = events.map(event => ({
    ...event,
    gallery: getGallery.all(event.id)
  }));

  res.json(result);
});

// POST /api/admin/events
router.post('/events', upload.single('cover_image'), (req, res) => {
  const { name, date, end_date, venue, description, registration_open, is_paid, price, registration_link, status } = req.body;
  if (!name || !date) return res.status(400).json({ error: 'Name and date are required' });

  const cover_image = req.file ? `/uploads/${req.file.filename}` : '';
  const db = getDb();

  const result = db.prepare(`
    INSERT INTO events (name, date, end_date, venue, description, cover_image, registration_open, is_paid, price, registration_link, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, date, end_date || null, venue || '', description || '', cover_image,
    registration_open ? 1 : 0, is_paid ? 1 : 0, price || 0, registration_link || '',
    status || 'upcoming'
  );

  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/admin/events/:id
router.put('/events/:id', upload.single('cover_image'), (req, res) => {
  const { name, date, end_date, venue, description, registration_open, is_paid, price, registration_link, status } = req.body;
  const db = getDb();

  let cover_image;
  if (req.file) {
    cover_image = `/uploads/${req.file.filename}`;
    // Delete old image
    const old = db.prepare('SELECT cover_image FROM events WHERE id = ?').get(req.params.id);
    if (old?.cover_image) {
      const oldPath = path.join(__dirname, '..', old.cover_image);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
  } else {
    const existing = db.prepare('SELECT cover_image FROM events WHERE id = ?').get(req.params.id);
    cover_image = existing?.cover_image || '';
  }

  db.prepare(`
    UPDATE events SET name = ?, date = ?, end_date = ?, venue = ?, description = ?, cover_image = ?,
    registration_open = ?, is_paid = ?, price = ?, registration_link = ?, status = ?
    WHERE id = ?
  `).run(
    name, date, end_date || null, venue || '', description || '', cover_image,
    registration_open ? 1 : 0, is_paid ? 1 : 0, price || 0, registration_link || '',
    status || 'upcoming', req.params.id
  );

  res.json({ success: true });
});

// DELETE /api/admin/events/:id
router.delete('/events/:id', (req, res) => {
  const db = getDb();

  // Delete cover image
  const event = db.prepare('SELECT cover_image FROM events WHERE id = ?').get(req.params.id);
  if (event?.cover_image) {
    const imgPath = path.join(__dirname, '..', event.cover_image);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }

  // Delete gallery images
  const gallery = db.prepare('SELECT image_path FROM event_gallery WHERE event_id = ?').all(req.params.id);
  gallery.forEach(img => {
    const imgPath = path.join(__dirname, '..', img.image_path);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  });

  db.prepare('DELETE FROM event_gallery WHERE event_id = ?').run(req.params.id);
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/admin/events/:id/gallery - Upload gallery images
router.post('/events/:id/gallery', upload.array('images', 20), (req, res) => {
  const db = getDb();
  const insert = db.prepare('INSERT INTO event_gallery (event_id, image_path) VALUES (?, ?)');

  const images = [];
  if (req.files) {
    req.files.forEach(file => {
      const imagePath = `/uploads/${file.filename}`;
      const result = insert.run(req.params.id, imagePath);
      images.push({ id: result.lastInsertRowid, image_path: imagePath });
    });
  }

  res.json({ success: true, images });
});

// DELETE /api/admin/events/gallery/:imageId
router.delete('/events/gallery/:imageId', (req, res) => {
  const db = getDb();
  const image = db.prepare('SELECT image_path FROM event_gallery WHERE id = ?').get(req.params.imageId);
  if (image) {
    const imgPath = path.join(__dirname, '..', image.image_path);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
  db.prepare('DELETE FROM event_gallery WHERE id = ?').run(req.params.imageId);
  res.json({ success: true });
});

// ==================== POPUP ====================

// GET /api/admin/popup
router.get('/popup', (req, res) => {
  const db = getDb();
  const popups = db.prepare('SELECT * FROM popup ORDER BY created_at DESC').all();
  res.json(popups);
});

// POST /api/admin/popup
router.post('/popup', upload.single('image'), (req, res) => {
  const { event_name, description, layout, button_text, button_link, active } = req.body;
  if (!event_name) return res.status(400).json({ error: 'Event name is required' });

  const image = req.file ? `/uploads/${req.file.filename}` : '';
  const db = getDb();

  // If setting this popup as active, deactivate all others
  if (active && parseInt(active)) {
    db.prepare('UPDATE popup SET active = 0').run();
  }

  const result = db.prepare(`
    INSERT INTO popup (image, event_name, description, layout, button_text, button_link, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(image, event_name, description || '', layout || 'center', button_text || 'Learn More', button_link || '', active ? 1 : 0);

  res.json({ success: true, id: result.lastInsertRowid });
});

// PUT /api/admin/popup/:id
router.put('/popup/:id', upload.single('image'), (req, res) => {
  const { event_name, description, layout, button_text, button_link, active } = req.body;
  const db = getDb();

  let image;
  if (req.file) {
    image = `/uploads/${req.file.filename}`;
    const old = db.prepare('SELECT image FROM popup WHERE id = ?').get(req.params.id);
    if (old?.image) {
      const oldPath = path.join(__dirname, '..', old.image);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
  } else {
    const existing = db.prepare('SELECT image FROM popup WHERE id = ?').get(req.params.id);
    image = existing?.image || '';
  }

  // If setting this popup as active, deactivate all others
  if (active && parseInt(active)) {
    db.prepare('UPDATE popup SET active = 0').run();
  }

  db.prepare(`
    UPDATE popup SET image = ?, event_name = ?, description = ?, layout = ?, button_text = ?, button_link = ?, active = ?
    WHERE id = ?
  `).run(image, event_name, description || '', layout || 'center', button_text || 'Learn More', button_link || '', active ? 1 : 0, req.params.id);

  res.json({ success: true });
});

// DELETE /api/admin/popup/:id
router.delete('/popup/:id', (req, res) => {
  const db = getDb();
  const popup = db.prepare('SELECT image FROM popup WHERE id = ?').get(req.params.id);
  if (popup?.image) {
    const imgPath = path.join(__dirname, '..', popup.image);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
  db.prepare('DELETE FROM popup WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// PUT /api/admin/popup/:id/toggle - Toggle popup active status
router.put('/popup/:id/toggle', (req, res) => {
  const db = getDb();
  const popup = db.prepare('SELECT active FROM popup WHERE id = ?').get(req.params.id);
  if (!popup) return res.status(404).json({ error: 'Popup not found' });

  const newActive = popup.active ? 0 : 1;

  // If activating, deactivate all others
  if (newActive === 1) {
    db.prepare('UPDATE popup SET active = 0').run();
  }

  db.prepare('UPDATE popup SET active = ? WHERE id = ?').run(newActive, req.params.id);
  res.json({ success: true, active: newActive });
});

module.exports = router;
