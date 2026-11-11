import test from 'node:test';
import assert from 'node:assert/strict';
import { mountScript, normalizeItems } from '../src/ui/mount-script.ts';
import { clientHost } from '../src/ui/client-host.ts';

const items = [{ host: 'nas.lan', share: 'Photos', letter: 'P' }, { host: 'nas.lan', share: "Films d'été", letter: 'F' }];

test('Windows script mounts only when the server answers and never contains a password', () => {
  const { filename, content } = mountScript('windows', items, 'marie');
  assert.equal(filename, 'sillage-partages.cmd');
  assert.ok(content.includes("@{ Lettre = 'P:'; Serveur = 'nas.lan'; Partage = 'Photos' }"));
  assert.ok(content.includes("Partage = 'Films d''été'"), 'single quotes are doubled for PowerShell');
  assert.ok(content.includes('/persistent:no'));
  assert.ok(content.includes('Test-Serveur'));
  assert.ok(content.includes('EventID=10000'));
  assert.ok(!/password\s*=/i.test(content));
  assert.ok(content.includes('\r\n'));
});
test('Windows file is a double-click .cmd launcher wrapping the PowerShell part', () => {
  const { content } = mountScript('windows', items, 'marie');
  assert.ok(content.startsWith('<# :'), 'no BOM, first line is a cmd label and a PowerShell comment');
  const batch = content.slice(0, content.indexOf('\r\n#>\r\n'));
  assert.ok(batch.length > 0, 'batch part closed by #> on its own line');
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(batch), 'batch part is plain ASCII');
  assert.ok(batch.includes('-ExecutionPolicy Bypass') && batch.includes('%*') && batch.includes('\r\npause\r\nexit /b'));
  assert.ok(!content.includes('Read-Host'), 'the window is kept open by pause, not by PowerShell');
  assert.ok(content.includes('if ($PSCommandPath -ne $Cible)'));
});
test('macOS script uses the keychain, URL-encodes share names and installs a LaunchAgent', () => {
  const { content } = mountScript('mac', items, 'marie');
  assert.ok(content.includes("'nas.lan|Photos|Photos'"));
  assert.ok(content.includes('Films%20d'), 'spaces are URL-encoded');
  assert.ok(content.includes('mount volume'));
  assert.ok(content.includes('nc -z -G 2'));
  assert.ok(content.includes('WatchPaths'));
});
test('Linux script uses systemd automount with a short timeout and a root-only credential file', () => {
  const { content } = mountScript('linux', items, '');
  assert.ok(content.includes("COMPTE=''"));
  assert.ok(content.includes('x-systemd.automount'));
  assert.ok(content.includes('x-systemd.mount-timeout=5'));
  assert.ok(content.includes("'nas.lan|Photos|/mnt/photos'"));
  assert.ok(content.includes('umask 077'));
});
test('inputs are validated', () => {
  assert.throws(() => mountScript('windows', [], ''), /au moins un partage/);
  assert.throws(() => mountScript('windows', [{ host: 'nas', share: 'A', letter: 'P' }, { host: 'nas', share: 'B', letter: 'P' }]), /deux fois/);
  assert.throws(() => mountScript('windows', [{ host: 'nas', share: 'A', letter: 'C' }]), /lettre/);
  assert.throws(() => mountScript('linux', [{ host: 'nas;rm -rf /', share: 'A' }]), /Adresse/);
  assert.throws(() => mountScript('linux', [{ host: 'nas', share: 'A|B' }]), /non pris en charge/);
  assert.throws(() => mountScript('mac', [{ host: 'nas', share: 'A' }], "x'y"), /compte/);
  const twice = normalizeItems('linux', [{ host: 'a', share: 'Photos' }, { host: 'b', share: 'Photos' }], '');
  assert.deepEqual(twice.map(i => i.folder), ['/mnt/photos', '/mnt/photos-2']);
});
test('client address falls back to the SSH address', () => {
  assert.equal(clientHost({ host: '192.168.1.10', client_host: null }), '192.168.1.10');
  assert.equal(clientHost({ host: '192.168.1.10', client_host: 'nas.lan' }), 'nas.lan');
});
