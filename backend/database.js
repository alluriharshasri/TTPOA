const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'ttpoa.db');

let dbWrapper = null;

// ─── Wrapper that mimics better-sqlite3 API ───
class DatabaseWrapper {
  constructor(sqlJsDb) {
    this.db = sqlJsDb;
  }

  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        self.db.run(sql, params.length > 0 ? params : undefined);
        const changes = self.db.getRowsModified();
        const res = self.db.exec('SELECT last_insert_rowid() as id');
        const lastInsertRowid = res.length > 0 ? res[0].values[0][0] : 0;
        self._save();
        return { changes, lastInsertRowid };
      },
      get(...params) {
        let stmt;
        try {
          stmt = self.db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return undefined;
        } finally {
          if (stmt) stmt.free();
        }
      },
      all(...params) {
        let stmt;
        try {
          stmt = self.db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          const results = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          return results;
        } finally {
          if (stmt) stmt.free();
        }
      }
    };
  }

  exec(sql) {
    this.db.exec(sql);
    this._save();
  }

  pragma(str) {
    try {
      this.db.run(`PRAGMA ${str}`);
    } catch (_) {
      // WAL mode is not supported in sql.js (WASM) — ignore safely
    }
  }

  _save() {
    const data = this.db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

// ─── Public helpers ───

function getDb() {
  if (!dbWrapper) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return dbWrapper;
}

async function initializeDatabase() {
  const SQL = await initSqlJs();

  let sqlJsDb;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    sqlJsDb = new SQL.Database(fileBuffer);
  } else {
    sqlJsDb = new SQL.Database();
  }

  dbWrapper = new DatabaseWrapper(sqlJsDb);
  const db = dbWrapper;

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS news_ticker (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      link TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      end_date TEXT,
      venue TEXT DEFAULT '',
      description TEXT DEFAULT '',
      cover_image TEXT DEFAULT '',
      registration_open INTEGER DEFAULT 0,
      is_paid INTEGER DEFAULT 0,
      price REAL DEFAULT 0,
      registration_link TEXT DEFAULT '',
      status TEXT DEFAULT 'upcoming',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS event_gallery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS popup (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image TEXT DEFAULT '',
      event_name TEXT NOT NULL,
      description TEXT DEFAULT '',
      layout TEXT DEFAULT 'center',
      button_text TEXT DEFAULT 'Learn More',
      button_link TEXT DEFAULT '',
      active INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default admin if not exists
  const existingAdmin = db.prepare('SELECT id FROM admin WHERE username = ?').get('admin');
  if (!existingAdmin) {
    const hashedPassword = bcrypt.hashSync('Admin@123', 10);
    db.prepare('INSERT INTO admin (username, password) VALUES (?, ?)').run('admin', hashedPassword);
    console.log('Default admin user created (admin / Admin@123)');
  }

  // Seed some default news ticker items if empty
  const tickerCount = db.prepare('SELECT COUNT(*) as count FROM news_ticker').get();
  if (tickerCount.count === 0) {
    const defaultNews = [
      { text: '🎓 New Industry Partnership: TTPOA collaborates with 50+ Fortune 500 companies for campus placements', link: '/TTPOA/services/' },
      { text: '📢 Upcoming Workshop: Advanced Interview Preparation scheduled for March 2026', link: '/TTPOA/services/' },
      { text: '🏆 Achievement: 95% placement success rate recorded in 2025-26 academic year', link: '/TTPOA/about/' },
      { text: '💼 Job Fair Alert: Mega recruitment drive on March 15, 2026 - Register Now!', link: '/TTPOA/contact/' },
      { text: '🌟 Scholarship Announcement: Merit-based scholarships available for eligible students', link: '/TTPOA/services/' },
    ];
    const insert = db.prepare('INSERT INTO news_ticker (text, link, sort_order) VALUES (?, ?, ?)');
    defaultNews.forEach((item, index) => {
      insert.run(item.text, item.link, index);
    });
    console.log('Default news ticker items created');
  }

  console.log('Database initialized successfully');
}

// Auto-update event statuses based on date
// Only transitions past/today events automatically; future events keep admin-set status
function updateEventStatuses() {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Events with end_date that has passed → recent (takes priority)
  db.prepare(`
    UPDATE events SET status = 'recent'
    WHERE end_date IS NOT NULL AND end_date < ? AND status != 'recent'
  `).run(today);

  // Events whose start date has passed AND have no future end_date AND are ongoing → recent
  // NOTE: we do NOT auto-move 'upcoming' to 'recent' — admin controls that manually
  db.prepare(`
    UPDATE events SET status = 'recent'
    WHERE date < ? AND (end_date IS NULL OR end_date < ?) AND status = 'ongoing'
  `).run(today, today);

  // Events whose date is today and not yet ended → ongoing (only if upcoming)
  db.prepare(`
    UPDATE events SET status = 'ongoing'
    WHERE date = ? AND (end_date IS NULL OR end_date >= ?) AND status = 'upcoming'
  `).run(today, today);

  // Events whose date is in the future → restore to upcoming if auto-moved to ongoing/recent
  db.prepare(`
    UPDATE events SET status = 'upcoming'
    WHERE date > ? AND (end_date IS NULL OR end_date > ?) AND status IN ('recent', 'ongoing')
  `).run(today, today);
}

module.exports = { getDb, initializeDatabase, updateEventStatuses };
