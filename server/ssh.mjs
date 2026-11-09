import { Client } from 'ssh2';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { dataDir } from './store.mjs';

export const keyPath = resolve(process.env.SSH_KEY_PATH || resolve(dataDir, 'id_ed25519'));
export function publicKey() {
  if (!existsSync(keyPath)) execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'sillage', '-f', keyPath], { stdio: 'ignore' });
  return readFileSync(keyPath + '.pub', 'utf8').trim();
}
export function remote(server, payload) {
  publicKey();
  return new Promise((resolveResult, reject) => {
    const client = new Client();
    let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); client.end(); error ? reject(error) : resolveResult(result); };
    const timer = setTimeout(() => finish(new Error('Le serveur ne répond pas après 25 secondes.')), 25000);
    client.on('error', () => finish(new Error('Connexion SSH refusée. Vérifiez le compte, la clé et l’empreinte du serveur.')));
    client.on('ready', () => client.exec('sudo -n /usr/local/sbin/samba-manager-helper', (error, stream) => {
      if (error) return finish(new Error('Le compte de gestion ne peut pas lancer l’outil Samba.'));
      let out = ''; let err = '';
      stream.on('data', chunk => { out += chunk; if (out.length > 2000000) finish(new Error('Réponse du serveur trop volumineuse.')); });
      stream.stderr.on('data', chunk => { if (err.length < 4000) err += chunk; });
      stream.on('close', code => {
        try {
          if (code !== 0) throw new Error('L’outil distant a refusé l’opération. Vérifiez son installation.');
          const result = JSON.parse(out);
          if (!result.ok) throw new Error(result.error || 'Opération refusée.');
          finish(null, result.data);
        } catch (cause) { finish(cause); }
      });
      stream.end(JSON.stringify(payload));
    }));
    client.connect({ host: server.host, port: server.port, username: server.username, privateKey: readFileSync(keyPath), readyTimeout: 10000,
      hostVerifier: key => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '') === server.fingerprint.replace(/=+$/, '') });
  });
}
