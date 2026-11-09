import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'sillage-test-'));
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.BOOTSTRAP_TOKEN = 'test-bootstrap-token';
const { api, serverSchema, shareSchema, shareConfigSchema, sambaUserSchema } = await import('../server/api.mjs');
const { db, verifyPassword, hashPassword, digest } = await import('../server/store.mjs');
let session;
const request = (path, method = 'GET', body, cookie, origin = 'http://localhost:3000') => api(new Request('http://localhost:3000/api/' + path, { method, headers: { origin, 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), 'tests');
test('anonymous requests cannot read infrastructure or setup commands', async () => {
  for (const path of ['overview','settings','onboarding','helper']) assert.equal((await request(path)).status, 401);
});
test('administration endpoints reject anonymous writes',async()=>{
  for(const route of ['share-config','users','groups'])assert.equal((await request('servers/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/'+route,'POST',{})).status,401);
});
test('administration validation allows data mounts and rejects injected lines',()=>{
  const data={name:'Media',path:'/mnt/raid/Media',readOnly:false,revision:'a'.repeat(64),validUsers:'alice, @famille'};
  assert.equal(shareConfigSchema.safeParse(data).success,true);
  assert.equal(shareConfigSchema.safeParse({...data,path:'/mnt/raid\n[global]'}).success,false);
  assert.equal(shareConfigSchema.safeParse({...data,revision:'stale'}).success,false);
  assert.equal(sambaUserSchema.safeParse({name:'alice',password:'valid-example-password',groups:['famille']}).success,true);
  assert.equal(sambaUserSchema.safeParse({name:'alice',password:'bad\nsecret',groups:[]}).success,false);
});
test('cross-origin changes are rejected before authentication', async () => assert.equal((await request('auth/setup','POST',{},null,'http://evil.example')).status,403));
test('bootstrap requires the installation token', async () => assert.equal((await request('auth/setup','POST',{username:'admin',password:'long-test-password',bootstrap:'wrong'})).status,403));
test('setup issues an HttpOnly session and is one-shot', async () => {
  const response = await request('auth/setup','POST',{username:'admin',password:'long-test-password',bootstrap:'test-bootstrap-token'});
  assert.equal(response.status,200); const header=response.headers.get('set-cookie'); assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Lax/);
  session=header.split(';')[0];assert.equal((await request('auth/setup','POST',{})).status,409);
});
test('wrong local credentials cannot authenticate', async () => assert.equal((await request('auth/login','POST',{username:'admin',password:'incorrect'})).status,401));
test('authenticated API returns real empty state', async () => {
  const response=await request('overview','GET',undefined,session);assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.servers,[]);assert.equal(data.user.name,'admin');
});
test('share validation rejects configuration injection and traversal', () => {
  const valid={name:'Documents',path:'/srv/samba/documents',group:'family',readOnly:false,comment:''};
  assert.equal(shareSchema.safeParse(valid).success,true);
  for (const patch of [{name:'x\n[global]'},{path:'/etc/samba'},{path:'/srv/samba/../root'},{group:'root\nguest ok=yes'},{comment:'bad\npath=/'}]) assert.equal(shareSchema.safeParse({...valid,...patch}).success,false);
});
test('server validation rejects shell arguments and missing fingerprint', () => {
  const valid={name:'NAS',host:'192.168.1.10',port:22,username:'samba-manager',fingerprint:'SHA256:'+'A'.repeat(43)};
  assert.equal(serverSchema.safeParse(valid).success,true);
  for(const patch of [{host:'-oProxyCommand=sh'},{username:'root;id'},{port:70000},{fingerprint:''}])assert.equal(serverSchema.safeParse({...valid,...patch}).success,false);
});
test('passwords are salted and verified without plaintext storage', () => {const a=hashPassword('example-secret');const b=hashPassword('example-secret');assert.notEqual(a,b);assert.equal(verifyPassword('example-secret',a),true);assert.equal(verifyPassword('other',a),false);assert.equal(verifyPassword('example-secret',null),false)});
test('OIDC callback without one-time state is rejected', async () => assert.equal((await request('auth/callback')).status,401));
test('password change requires current password', async () => assert.equal((await request('auth/password','POST',{current:'wrong',password:'different-long-password'},session)).status,403));
test('password change rotates sessions and stores a new hash', async () => {
  const previous=session;const response=await request('auth/password','POST',{current:'long-test-password',password:'different-long-password'},session);
  assert.equal(response.status,200);session=response.headers.get('set-cookie').split(';')[0];assert.notEqual(session,previous);
  assert.equal((await request('overview','GET',undefined,previous)).status,401);
  assert.equal(verifyPassword('different-long-password',db.prepare('SELECT hash FROM users WHERE name=?').get('admin').hash),true);
});
test('expired sessions are rejected', async () => {db.prepare('UPDATE sessions SET expires=0 WHERE token=?').run(digest(session.split('=')[1]));assert.equal((await request('overview','GET',undefined,session)).status,401)});
test('repeated login failures are rate limited', async()=>{let status;for(let i=0;i<10;i++)status=(await request('auth/login','POST',{username:'missing',password:'incorrect'})).status;assert.equal(status,429)});

test('SSO-only mode rejects local login, setup and pre-existing local sessions', async () => {
  const local=db.prepare('SELECT id FROM users WHERE name=?').get('admin');
  const raw='sso-mode-local-session-test';
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(raw),local.id,Date.now()+60000);
  process.env.LOCAL_LOGIN_ENABLED='false';
  try {
    assert.equal((await api(new Request('http://localhost:3000/api/overview',{headers:{cookie:'sillage='+raw}}),'sso-only')).status,401);
    for(const path of ['login','setup']) {
      const response=await api(new Request('http://localhost:3000/api/auth/'+path,{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:'{}'}),'sso-only');
      assert.equal(response.status,403);
    }
    const status=await (await api(new Request('http://localhost:3000/api/auth/status'),'sso-only')).json();
    assert.equal(status.localLogin,false);assert.equal(status.setupRequired,false);
  } finally { delete process.env.LOCAL_LOGIN_ENABLED; db.prepare('DELETE FROM sessions WHERE token=?').run(digest(raw)); }
});
