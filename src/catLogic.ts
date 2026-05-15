import Database from 'better-sqlite3';

import type { CatAction, CatProfile } from './types';

const db = new Database('kotnost.sqlite');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS cats (
    user_id INTEGER PRIMARY KEY,
    name TEXT,
    kotost INTEGER NOT NULL DEFAULT 0,
    fed_count INTEGER NOT NULL DEFAULT 0,
    petted_count INTEGER NOT NULL DEFAULT 0,
    washed_count INTEGER NOT NULL DEFAULT 0,
    pending_name INTEGER NOT NULL DEFAULT 0,
    last_message_id INTEGER,
    last_interaction_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    last_reminder_at INTEGER
  );
`);

const hasColumn = (columnName: string): boolean => {
  const columns = db.prepare("PRAGMA table_info('cats')").all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
};

// Lightweight migrations for existing DBs.
if (!hasColumn('last_interaction_at')) {
  db.exec(`ALTER TABLE cats ADD COLUMN last_interaction_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))`);
}
if (!hasColumn('last_reminder_at')) {
  db.exec(`ALTER TABLE cats ADD COLUMN last_reminder_at INTEGER`);
}

const getCatStmt = db.prepare(
  'SELECT user_id as userId, name, kotost, fed_count as fedCount, petted_count as pettedCount, washed_count as washedCount, pending_name as pendingName, last_message_id as lastMessageId, last_interaction_at as lastInteractionAt, last_reminder_at as lastReminderAt FROM cats WHERE user_id = ?'
);
const upsertUserStmt = db.prepare('INSERT INTO cats (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING');
const setPendingStmt = db.prepare('UPDATE cats SET pending_name = ? WHERE user_id = ?');
const createCatStmt = db.prepare(
  "UPDATE cats SET name = ?, kotost = 0, fed_count = 0, petted_count = 0, washed_count = 0, pending_name = 0, last_interaction_at = strftime('%s','now'), last_reminder_at = NULL WHERE user_id = ?"
);
const updateLastMessageStmt = db.prepare('UPDATE cats SET last_message_id = ? WHERE user_id = ?');
const touchInteractionStmt = db.prepare(
  "UPDATE cats SET last_interaction_at = strftime('%s','now'), last_reminder_at = NULL WHERE user_id = ?"
);
const penalizeKotostStmt = db.prepare('UPDATE cats SET kotost = MAX(0, kotost - ?) WHERE user_id = ?');
const setLastReminderStmt = db.prepare("UPDATE cats SET last_reminder_at = strftime('%s','now') WHERE user_id = ?");

export const ensureUser = (userId: number) => {
  upsertUserStmt.run(userId);
  return getCatStmt.get(userId) as CatProfile;
};

export const touchInteraction = (userId: number) => {
  touchInteractionStmt.run(userId);
};

export const gainKotost = (userId: number, action: CatAction) => {
  const cat = ensureUser(userId);
  if (!cat.name) return null;

  let score = 0;
  if (action === 'feed') {
    score = 3;
    db.prepare('UPDATE cats SET fed_count = fed_count + 1, kotost = kotost + ? WHERE user_id = ?').run(score, userId);
  }
  if (action === 'pet') {
    score = 2;
    db.prepare('UPDATE cats SET petted_count = petted_count + 1, kotost = kotost + ? WHERE user_id = ?').run(score, userId);
  }
  if (action === 'wash') {
    score = 4;
    db.prepare('UPDATE cats SET washed_count = washed_count + 1, kotost = kotost + ? WHERE user_id = ?').run(score, userId);
  }

  touchInteraction(userId);
  return { cat: ensureUser(userId), score };
};

export const applyIgnorePenalty = (userId: number, amount: number) => {
  penalizeKotostStmt.run(amount, userId);
  return ensureUser(userId);
};

export const markReminderSent = (userId: number) => {
  setLastReminderStmt.run(userId);
};

export const getInactiveCatsForReminder = (inactiveSeconds: number) =>
  db
    .prepare(
      `SELECT user_id as userId, name, kotost, fed_count as fedCount, petted_count as pettedCount, washed_count as washedCount, pending_name as pendingName, last_message_id as lastMessageId, last_interaction_at as lastInteractionAt, last_reminder_at as lastReminderAt
       FROM cats
       WHERE name IS NOT NULL
         AND last_interaction_at <= strftime('%s','now') - ?
         AND (last_reminder_at IS NULL OR last_reminder_at < last_interaction_at)`
    )
    .all(inactiveSeconds) as CatProfile[];

export const profileText = (cat: CatProfile) =>
  `🐱 Кличка: ${cat.name}\n` +
  `✨ Котость: ${cat.kotost}\n` +
  `🍗 Кормлений: ${cat.fedCount}\n` +
  `🖐 Поглаживаний: ${cat.pettedCount}\n` +
  `🛁 Помывок: ${cat.washedCount}`;

export const getLeaders = () =>
  db
    .prepare('SELECT name, kotost FROM cats WHERE name IS NOT NULL ORDER BY kotost DESC LIMIT 10')
    .all() as Array<{ name: string; kotost: number }>;

export { createCatStmt, setPendingStmt, updateLastMessageStmt };
