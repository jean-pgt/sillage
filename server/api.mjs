import { readFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import * as oidc from 'openid-client';
import { db, token, digest, hashPassword, verifyPassword, audit, servers } from './store.mjs';
import { publicKey, remote } from './ssh.mjs';
import { setupScript } from './onboarding.mjs';
import { isOidcAdmin, localLoginEnabled } from './oidc-policy.mjs';

const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
const secure = origin.startsWith('https:');
const providerName = (process.env.OIDC_PROVIDER_NAME || 'SSO').slice(0, 40);
const cookieName = secure ? '__Host-sillage' : 'sillage';
const counts = new Map();
const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
const cookies = request => Object.fromEntries((request.headers.get('cookie') || '').split(';').map(v => v.trim().split('=')));
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const redirect = (location, headers = {}) => new Response(null, { status: 302, headers: { Location: location, ...headers } });
const constantEqual = (a, b) => { const x = Buffer.from(a || ''); const y = Buffer.from(b || ''); return x.length === y.length && timingSafeEqual(x, y); };
const localSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(12).max(256), bootstrap: z.string().optional() });
const serverSchema = z.object({ name: z.string().trim().min(1).max(80), host: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}$/), port: z.number().int().min(1).max(65535).default(22), username: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/).default('samba-manager'), fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}=?$/) });
const shareSchema = z.object({ name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63}$/), path: z.string().regex(/^\/srv\/samba\/[a-zA-Z0-9_-]+$/), group: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/), readOnly: z.boolean(), comment: z.string().max(160).regex(/^[^\r\n\0]*$/).default('') });
export { serverSchema, shareSchema };
const configText=z.string().max(1024).regex(/^[^\r\n\0]*$/);
export const shareConfigSchema=z.object({
  name:z.string().min(1).max(80).regex(/^[^\[\]\r\n\0/\\]+$/),path:configText.refine(value=>value.startsWith('/')),
  revision:z.string().regex(/^[a-f0-9]{64}$/).optional(),comment:configText.default(''),
  readOnly:z.boolean(),browseable:z.boolean().default(true),group:z.union([z.literal(''),z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/)]).default(''),
  validUsers:configText.default(''),writeList:configText.default(''),
  createDirectory:z.boolean().default(false),applyPermissions:z.boolean().default(false),directoryMode:z.enum(['2770','2775','0770','0750']).default('2770'),
});
export const sambaUserSchema=z.object({name:z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/),password:z.string().max(256).regex(/^[^\r\n\0]*$/).refine(value=>!value||value.length>=12).default(''),groups:z.array(z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/)).max(64).default([])});
function limited(key, max = 8) {
  const now = Date.now();
  if (counts.size > 5000) for (const [k, v] of counts) if (v.until < now) counts.delete(k);
  const count = counts.get(key);
  if (count && count.until > now && count.n >= max) throw fail('Trop de tentatives. Réessayez dans une minute.', 429);
  counts.set(key, count && count.until > now ? { ...count, n: count.n + 1 } : { n: 1, until: now + 60000 });
}
async function body(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw fail('Contenu JSON requis.', 415);
  const text = await request.text(); if (text.length > 20000) throw fail('Requête trop volumineuse.', 413);
  try { return JSON.parse(text); } catch { throw fail('Requête JSON invalide.'); }
}
function principal(request) {
  const session = db.prepare('SELECT users.id,users.name FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?').get(digest(cookies(request)[cookieName] || ''), Date.now());
  if (!session) throw fail('Connexion requise.', 401);
  if (!localLoginEnabled() && !session.id.startsWith('oidc:')) throw fail(`Connexion avec ${providerName} requise.`, 401);
  return session;
}
function issueSession(user, lifetime = 8 * 3600) {
  const raw = token();
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(raw), user.id, Date.now() + lifetime * 1000);
  return cookie(cookieName, raw, lifetime);
}
let provider;
function oidcReady() { return Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET); }
async function config() {
  if (!provider) {
    const discovered = await oidc.discovery(new URL(process.env.OIDC_ISSUER), process.env.OIDC_CLIENT_ID, process.env.OIDC_CLIENT_SECRET);
    oidc.enableNonRepudiationChecks(discovered);
    provider = discovered;
  }
  return provider;
}
function getServer(id) { const row = db.prepare('SELECT * FROM servers WHERE id=?').get(id); if (!row) throw fail('Serveur introuvable.', 404); return row; }
async function refresh(server) {
  try {
    const snapshot = await remote(server, { op: 'inventory' });
    db.prepare('UPDATE servers SET snapshot=?,checked=?,error=NULL WHERE id=?').run(JSON.stringify(snapshot), new Date().toISOString(), server.id);
    return snapshot;
  } catch (error) { db.prepare('UPDATE servers SET error=? WHERE id=?').run(error.message, server.id); throw error; }
}
export async function api(request, ip = 'local') {
  try {
    const url = new URL(request.url); const path = url.pathname; const method = request.method;
    if (!['GET', 'HEAD'].includes(method) && request.headers.get('origin') !== new URL(origin).origin) throw fail('Origine de la requête refusée.', 403);
    if (path.startsWith('/api/auth/')) limited('auth:' + ip, 30);
    if (path === '/api/auth/status') {
      let user = null; try { user = principal(request); } catch {}
      return json({ user, setupRequired: localLoginEnabled() && !db.prepare('SELECT id FROM users WHERE hash IS NOT NULL LIMIT 1').get(), oidc: oidcReady(), localLogin: localLoginEnabled(), providerName });
    }
    if (path === '/api/auth/setup' && method === 'POST') {
      if (!localLoginEnabled()) throw fail(`Connexion avec ${providerName} requise.`, 403);
      limited('login:' + ip);
      if (db.prepare('SELECT id FROM users WHERE hash IS NOT NULL LIMIT 1').get()) throw fail('Compte local déjà configuré.', 409);
      const data = localSchema.parse(await body(request));
      if (!process.env.BOOTSTRAP_TOKEN || !constantEqual(data.bootstrap, process.env.BOOTSTRAP_TOKEN)) throw fail('Code d’installation incorrect.', 403);
      const user = { id: randomUUID(), name: data.username };
      db.prepare('INSERT INTO users VALUES(?,?,?)').run(user.id, user.name, hashPassword(data.password));
      audit(user.name, 'Création du compte administrateur', 'Application');
      return json({ ok: true }, 200, { 'Set-Cookie': issueSession(user) });
    }
    if (path === '/api/auth/login' && method === 'POST') {
      if (!localLoginEnabled()) throw fail(`Connexion avec ${providerName} requise.`, 403);
      limited('login:' + ip);
      const data = z.object({ username: z.string().max(64), password: z.string().max(256) }).parse(await body(request));
      const user = db.prepare('SELECT * FROM users WHERE name=? AND hash IS NOT NULL').get(data.username);
      if (!verifyPassword(data.password, user?.hash)) throw fail('Identifiant ou mot de passe incorrect.', 401);
      audit(user.name, 'Connexion locale', 'Application');
      return json({ ok: true }, 200, { 'Set-Cookie': issueSession(user) });
    }
    if (path === '/api/auth/oidc' && method === 'GET') {
      if (!oidcReady()) throw fail(`${providerName} n’est pas encore configuré.`, 503);
      const cfg = await config(); const verifier = oidc.randomPKCECodeVerifier(); const state = oidc.randomState(); const nonce = oidc.randomNonce(); const raw = token();
      db.prepare('DELETE FROM oauth WHERE expires<?').run(Date.now());
      db.prepare('INSERT INTO oauth VALUES(?,?,?)').run(digest(raw), JSON.stringify({ verifier, state, nonce }), Date.now() + 600000);
      const target = oidc.buildAuthorizationUrl(cfg, { redirect_uri: origin + '/api/auth/callback', scope: 'openid profile email', code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', state, nonce });
      return redirect(target.href, { 'Set-Cookie': cookie('sillage-oidc', raw, 600) });
    }
    if (path === '/api/auth/callback' && method === 'GET') {
      const key = digest(cookies(request)['sillage-oidc'] || '');
      const row = db.prepare('SELECT data FROM oauth WHERE token=? AND expires>?').get(key, Date.now());
      db.prepare('DELETE FROM oauth WHERE token=?').run(key);
      if (!row) throw fail('Connexion expirée. Recommencez.', 401);
      const { verifier, state, nonce } = JSON.parse(row.data);
      const tokens = await oidc.authorizationCodeGrant(await config(), new URL(url.pathname + url.search, origin), { pkceCodeVerifier: verifier, expectedState: state, expectedNonce: nonce, idTokenExpected: true });
      const claims = tokens.claims();
      if (!isOidcAdmin(claims)) { audit(providerName, 'Connexion refusée', 'Droits administrateur requis', 'denied'); throw fail('Accès réservé aux administrateurs.', 403); }
      const id = 'oidc:' + claims.sub; const name = typeof claims.preferred_username === 'string' ? claims.preferred_username : claims.sub;
      db.prepare('INSERT INTO users VALUES(?,?,NULL) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(id, name);
      audit(name, 'Connexion ' + providerName, 'Application');
      const response = redirect('/', { 'Set-Cookie': issueSession({ id }, 3600) }); response.headers.append('Set-Cookie', cookie('sillage-oidc', '', 0)); return response;
    }
    const user = principal(request);
    limited('api:' + user.id, 120);
    if (path === '/api/auth/logout' && method === 'POST') { db.prepare('DELETE FROM sessions WHERE token=?').run(digest(cookies(request)[cookieName] || '')); return json({ ok: true }, 200, { 'Set-Cookie': cookie(cookieName, '', 0) }); }
    if (path === '/api/auth/password' && method === 'POST') {
      limited('password:' + user.id, 5);
      const data = z.object({ current: z.string().max(256), password: z.string().min(12).max(256) }).parse(await body(request));
      const account = db.prepare('SELECT hash FROM users WHERE id=?').get(user.id);
      if (!verifyPassword(data.current, account?.hash)) throw fail('Mot de passe actuel incorrect, ou compte géré par ' + providerName + '.', 403);
      db.prepare('UPDATE users SET hash=? WHERE id=?').run(hashPassword(data.password), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      audit(user.name, 'Changement du mot de passe local', 'Application');
      return json({ ok: true }, 200, { 'Set-Cookie': issueSession(user) });
    }
    if (path === '/api/overview' && method === 'GET') return json({ servers: servers(), audit: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all(), user });
    if (path === '/api/settings' && method === 'GET') return json({ origin, callback: origin + '/api/auth/callback', issuer: process.env.OIDC_ISSUER || '', providerName, oidc: oidcReady(), publicKey: publicKey(), version: '0.1.0' });
    if (path === '/api/helper' && method === 'GET') return new Response(readFileSync(new URL('../remote/samba-manager-helper.py', import.meta.url)), { headers: { 'Content-Type': 'text/x-python', 'Content-Disposition': 'attachment; filename="samba-manager-helper.py"' } });
    if (path === '/api/onboarding' && method === 'GET') return json({ script: setupScript(publicKey()) });
    if (path === '/api/servers' && method === 'POST') {
      const data = serverSchema.parse(await body(request)); const id = randomUUID();
      db.prepare('INSERT INTO servers(id,name,host,port,username,fingerprint) VALUES(?,?,?,?,?,?)').run(id, data.name, data.host, data.port, data.username, data.fingerprint);
      audit(user.name, 'Ajout du serveur', data.name); return json({ id }, 201);
    }
    const administration=path.match(/^\/api\/servers\/([a-f0-9-]+)\/(share-config|users|groups)$/);
    if(administration) {
      const server=getServer(administration[1]);
      if(administration[2]==='share-config'&&method==='POST') {
        const data=shareConfigSchema.parse(await body(request));
        await remote(server,{op:'configure_share',...data});audit(user.name,'Configuration du partage',server.name+' / '+data.name);await refresh(server);return json({ok:true});
      }
      if(administration[2]==='share-config'&&method==='DELETE') {
        const data=z.object({name:shareConfigSchema.shape.name,revision:z.string().regex(/^[a-f0-9]{64}$/)}).parse(await body(request));
        await remote(server,{op:'remove_share',...data});audit(user.name,'Retrait du partage (fichiers conservés)',server.name+' / '+data.name);await refresh(server);return json({ok:true});
      }
      if(administration[2]==='users'&&method==='POST') {
        const data=sambaUserSchema.parse(await body(request));
        await remote(server,{op:'save_user',...data});audit(user.name,'Configuration du compte Samba',server.name+' / '+data.name);await refresh(server);return json({ok:true});
      }
      if(administration[2]==='groups'&&method==='POST') {
        const data=z.object({name:z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/)}).parse(await body(request));
        await remote(server,{op:'create_group',...data});audit(user.name,'Création du groupe',server.name+' / '+data.name);await refresh(server);return json({ok:true});
      }
      if(administration[2]==='groups'&&method==='PUT') {
        const data=z.object({name:z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/),members:z.array(z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/)).max(128)}).parse(await body(request));
        await remote(server,{op:'save_group',...data});audit(user.name,'Modification des membres du groupe',server.name+' / '+data.name);await refresh(server);return json({ok:true});
      }
    }
    const match = path.match(/^\/api\/servers\/([a-f0-9-]+)(?:\/(refresh|shares|client-host))?$/);
    if (match) {
      const server = getServer(match[1]);
      if (match[2] === 'refresh' && method === 'POST') { const snapshot = await refresh(server); audit(user.name, 'Actualisation', server.name); return json(snapshot); }
      if (match[2] === 'shares' && method === 'POST') {
        const data = shareSchema.parse(await body(request));
        await remote(server, { op: 'save_share', ...data }); audit(user.name, 'Enregistrement du partage', server.name + ' / ' + data.name); await refresh(server); return json({ ok: true });
      }
      if (match[2] === 'shares' && method === 'DELETE') {
        const data = z.object({ name: shareSchema.shape.name }).parse(await body(request));
        await remote(server, { op: 'delete_share', ...data }); audit(user.name, 'Retrait du partage (fichiers conservés)', server.name + ' / ' + data.name); await refresh(server); return json({ ok: true });
      }
      if (match[2] === 'client-host' && method === 'PUT') {
        const data = z.object({ clientHost: z.union([z.literal(''), z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}$/)]) }).parse(await body(request));
        db.prepare('UPDATE servers SET client_host=? WHERE id=?').run(data.clientHost || null, server.id);
        audit(user.name, 'Adresse pour les postes', server.name + ' / ' + (data.clientHost || server.host));
        return json({ ok: true, host: data.clientHost || server.host, resolved: await resolveHost(data.clientHost || server.host) });
      }
      if (!match[2] && method === 'DELETE') { db.prepare('DELETE FROM servers WHERE id=?').run(server.id); audit(user.name, 'Retrait du serveur', server.name); return json({ ok: true }); }
    }
    throw fail('Action introuvable.', 404);
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Champs invalides : vérifiez le nom, le chemin et les informations de connexion.' }, 400);
    return json({ error: error.status ? error.message : 'Opération impossible. Vérifiez la connexion et les permissions du compte dédié.' }, error.status || 502);
  }
}

// Vérifie qu'un nom DNS local se résout depuis Sillage (indication seulement : les postes peuvent avoir un autre DNS).
async function resolveHost(host) {
  if (isIP(host)) return [host];
  try {
    const found = await Promise.race([lookup(host, { all: true }), new Promise((_, reject) => setTimeout(() => reject(new Error('délai')), 3000))]);
    return [...new Set(found.map(item => item.address))];
  } catch { return []; }
}
