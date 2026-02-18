const express = require('express');
const { getDb, updateEventStatuses } = require('../database');

const router = express.Router();

// GET /api/news-ticker - Get active news ticker items
router.get('/news-ticker', (req, res) => {
  const db = getDb();
  const items = db.prepare('SELECT id, text, link FROM news_ticker WHERE active = 1 ORDER BY sort_order ASC').all();
  res.json(items);
});

// GET /api/events - Get all events (with auto-status update)
router.get('/events', (req, res) => {
  updateEventStatuses();
  const db = getDb();
  const events = db.prepare('SELECT * FROM events ORDER BY date DESC').all();

  // Attach gallery images
  const getGallery = db.prepare('SELECT id, image_path FROM event_gallery WHERE event_id = ?');
  const result = events.map(event => ({
    ...event,
    gallery: getGallery.all(event.id)
  }));

  res.json(result);
});

// GET /api/events/upcoming - Get upcoming events
router.get('/events/upcoming', (req, res) => {
  updateEventStatuses();
  const db = getDb();
  const events = db.prepare("SELECT * FROM events WHERE status = 'upcoming' ORDER BY date ASC").all();
  res.json(events);
});

// GET /api/events/ongoing - Get ongoing events
router.get('/events/ongoing', (req, res) => {
  updateEventStatuses();
  const db = getDb();
  const events = db.prepare("SELECT * FROM events WHERE status = 'ongoing' ORDER BY date ASC").all();
  res.json(events);
});

// GET /api/events/recent - Get recent/past events with galleries
router.get('/events/recent', (req, res) => {
  updateEventStatuses();
  const db = getDb();
  const events = db.prepare("SELECT * FROM events WHERE status = 'recent' ORDER BY date DESC").all();

  const getGallery = db.prepare('SELECT id, image_path FROM event_gallery WHERE event_id = ?');
  const result = events.map(event => ({
    ...event,
    gallery: getGallery.all(event.id)
  }));

  res.json(result);
});

// GET /api/popup - Get active popup
router.get('/popup', (req, res) => {
  const db = getDb();
  const popup = db.prepare('SELECT * FROM popup WHERE active = 1 ORDER BY created_at DESC LIMIT 1').get();
  res.json(popup || null);
});

module.exports = router;
