import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';

export const dataDir = resolve(process.env.DATA_DIR || './data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(resolve(dataDir, 'sillage.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth (token TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL, fingerprint TEXT NOT NULL, snapshot TEXT, checked TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, outcome TEXT NOT NULL);`);
// Adresse que les postes utilisent pour joindre les partages (IP ou nom DNS local) ; vide = adresse SSH.
if (!db.prepare("SELECT 1 FROM pragma_table_info('servers') WHERE name='client_host'").get()) db.exec('ALTER TABLE servers ADD COLUMN client_host TEXT');
export function token() { return randomBytes(32).toString('base64url'); }
export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function hashPassword(password, salt = randomBytes(16).toString('hex')) { return salt + ':' + scryptSync(password, salt, 64).toString('hex'); }
const dummy = hashPassword(token());
export function verifyPassword(password, stored) {
  const [salt, hash] = (stored || dummy).split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex')) && Boolean(stored);
}
export function audit(actor, action, target, outcome = 'ok') { db.prepare('INSERT INTO audit(at,actor,action,target,outcome) VALUES(?,?,?,?,?)').run(new Date().toISOString(), actor, action, target, outcome); }
export function servers() { return db.prepare('SELECT * FROM servers ORDER BY name').all().map(row => ({ ...row, snapshot: row.snapshot ? JSON.parse(row.snapshot) : null })); }
