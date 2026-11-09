// Fills a database with fictional servers, shares, accounts and disks, for screenshots and UI work.
// Usage: DATA_DIR=./demo-data node scripts/demo-data.mjs   then start the app with the same DATA_DIR.
// Nothing here is real: names, addresses and sizes are made up. No server is contacted.
import { randomUUID } from 'node:crypto';
const { db } = await import('../server/store.mjs');

const TB = 1e12, GB = 1e9;
const now = new Date().toISOString();
const fingerprint = 'SHA256:' + 'A'.repeat(43);

function share(name, path, comment, opts = {}) {
  return { name, path, comment, readOnly: false, validUsers: '@famille', writeList: '', browseable: true, forceGroup: 'famille', printable: false,
    managed: true, owner: 'root', group: 'famille', mode: '0o2775', pathExists: true, mountTarget: opts.mount || '/', mountSource: opts.source || '/dev/md0',
    editable: true, revision: null, ...opts.extra };
}
function disk(name, size, model, children = [], fstype = null) {
  return { name, kname: name, path: '/dev/' + name, type: 'disk', size, fstype, model, parents: [], children, mountpoints: [] };
}
function mount(target, source, fstype, total, used, pool = null, technical = false) {
  return { target, source, fstype, deviceId: '0:' + Math.floor(Math.random() * 90 + 10), fsroot: '/', total, used, available: total - used, reserved: 0, technical, readOnly: false, pool };
}
const users = [
  { name: 'alice', uid: 1000, gid: 1000, groups: ['alice', 'famille', 'admins'], sambaEnabled: true, editable: true },
  { name: 'bob', uid: 1001, gid: 1001, groups: ['bob', 'famille'], sambaEnabled: true, editable: true },
  { name: 'claire', uid: 1002, gid: 1002, groups: ['claire', 'famille'], sambaEnabled: true, editable: true },
  { name: 'invite', uid: 1003, gid: 1003, groups: ['invite'], sambaEnabled: false, editable: true },
];
const groups = [
  { name: 'famille', gid: 2000, members: ['alice', 'bob', 'claire'] },
  { name: 'admins', gid: 2001, members: ['alice'] },
];

const salon = {
  hostname: 'nas-salon', service: 'active', managedRoot: '/srv/samba', version: 3,
  capabilities: { configureShares: true, accounts: true, dataRoots: ['/srv/samba', '/mnt/donnees', '/tank', '/tank/photos', '/tank/sauvegardes'] },
  shares: [
    share('Photos', '/tank/photos', 'Photos et vidéos de famille', { mount: '/tank/photos', source: 'tank/photos' }),
    share('Musique', '/mnt/donnees/musique', 'Bibliothèque musicale', { mount: '/mnt/donnees' }),
    share('Films', '/mnt/donnees/films', 'Films et séries', { mount: '/mnt/donnees', extra: { readOnly: true } }),
    share('Documents', '/mnt/donnees/documents', 'Papiers, factures, scans', { mount: '/mnt/donnees', extra: { validUsers: 'alice, bob' } }),
    share('Sauvegardes', '/tank/sauvegardes', 'Sauvegardes des ordinateurs', { mount: '/tank/sauvegardes', source: 'tank/sauvegardes', extra: { browseable: false } }),
    share('Jeux', '/mnt/donnees/jeux', 'Installateurs de jeux', { mount: '/mnt/donnees' }),
  ],
  users, groups,
  disks: [{ path: '/mnt/donnees', total: 24 * TB, used: 15.8 * TB, free: 8.2 * TB }, { path: '/tank', total: 7.9 * TB, used: 3.1 * TB, free: 4.8 * TB }],
  storage: {
    mounts: [
      mount('/', '/dev/nvme0n1p2', 'ext4', 240 * GB, 38 * GB),
      mount('/boot/efi', '/dev/nvme0n1p1', 'vfat', 1 * GB, 0.01 * GB),
      mount('/mnt/donnees', '/dev/md0', 'ext4', 24 * TB, 15.8 * TB),
      mount('/tank', 'tank', 'zfs', 4.8 * TB, 0.2 * TB, 'tank'),
      mount('/tank/photos', 'tank/photos', 'zfs', 6.9 * TB, 2.1 * TB, 'tank'),
      mount('/tank/sauvegardes', 'tank/sauvegardes', 'zfs', 5.6 * TB, 0.8 * TB, 'tank'),
      mount('/run', 'tmpfs', 'tmpfs', 3 * GB, 0.002 * GB, null, true),
    ],
    devices: [
      disk('nvme0n1', 256 * GB, 'Samsung SSD 980', ['/dev/nvme0n1p1', '/dev/nvme0n1p2']),
      { name: 'nvme0n1p1', kname: 'nvme0n1p1', path: '/dev/nvme0n1p1', type: 'part', size: 1 * GB, fstype: 'vfat', model: '', parents: ['/dev/nvme0n1'], children: [], mountpoints: ['/boot/efi'] },
      { name: 'nvme0n1p2', kname: 'nvme0n1p2', path: '/dev/nvme0n1p2', type: 'part', size: 255 * GB, fstype: 'ext4', model: '', parents: ['/dev/nvme0n1'], children: [], mountpoints: ['/'] },
      ...['sda', 'sdb', 'sdc', 'sdd'].map(name => disk(name, 8 * TB, 'WDC WD80EFZZ', ['/dev/md0'], 'linux_raid_member')),
      { name: 'md0', kname: 'md0', path: '/dev/md0', type: 'raid5', size: 24 * TB, fstype: 'ext4', model: '', parents: ['/dev/sda', '/dev/sdb', '/dev/sdc', '/dev/sdd'], children: [], mountpoints: ['/mnt/donnees'] },
      ...['sde', 'sdf'].map(name => disk(name, 8 * TB, 'ST8000VN004', [], 'zfs_member')),
    ],
    arrays: [{ path: '/dev/md0', level: 'raid5', state: 'clean', degraded: '0', expectedDisks: '4', syncAction: 'idle', members: ['/dev/sda', '/dev/sdb', '/dev/sdc', '/dev/sdd'], size: 24 * TB }],
    pools: [{ name: 'tank', size: 7.98 * TB, allocated: 3.1 * TB, freeRaw: 4.88 * TB, health: 'ONLINE', available: 4.8 * TB }],
    datasets: [
      { name: 'tank', used: 3.1 * TB, available: 4.8 * TB, referenced: 0.2 * TB, mountpoint: '/tank' },
      { name: 'tank/photos', used: 2.1 * TB, available: 4.8 * TB, referenced: 2.1 * TB, mountpoint: '/tank/photos' },
      { name: 'tank/sauvegardes', used: 0.8 * TB, available: 4.8 * TB, referenced: 0.8 * TB, mountpoint: '/tank/sauvegardes' },
    ],
    warnings: [],
  },
};
const bureau = {
  ...salon, hostname: 'serveur-bureau',
  capabilities: { configureShares: true, accounts: true, dataRoots: ['/srv/samba', '/srv/projets'] },
  shares: [
    share('Projets', '/srv/projets', 'Projets en cours', { mount: '/srv/projets', source: '/dev/sdb1', extra: { validUsers: '@admins' } }),
    share('Archives', '/srv/samba/archives', 'Anciens projets', { mount: '/', source: '/dev/sda2', extra: { readOnly: true } }),
  ],
  users: users.slice(0, 2), groups: groups.slice(1),
  disks: [{ path: '/srv/projets', total: 4 * TB, used: 1.2 * TB, free: 2.8 * TB }],
  storage: {
    mounts: [mount('/', '/dev/sda2', 'ext4', 480 * GB, 64 * GB), mount('/srv/projets', '/dev/sdb1', 'ext4', 4 * TB, 1.2 * TB)],
    devices: [disk('sda', 500 * GB, 'Crucial MX500'), disk('sdb', 4 * TB, 'WDC WD40EFPX')],
    arrays: [], pools: [], datasets: [], warnings: [],
  },
};

db.exec('DELETE FROM servers');
const insert = db.prepare('INSERT INTO servers(id,name,host,port,username,fingerprint,snapshot,checked,client_host) VALUES(?,?,?,?,?,?,?,?,?)');
insert.run(randomUUID(), 'NAS du salon', '192.168.1.10', 22, 'samba-manager', fingerprint, JSON.stringify(salon), now, 'nas.maison.lan');
insert.run(randomUUID(), 'Serveur du bureau', '192.168.1.20', 22, 'samba-manager', fingerprint, JSON.stringify(bureau), now, null);
const log = db.prepare('INSERT INTO audit(at,actor,action,target,outcome) VALUES(?,?,?,?,?)');
[['Connexion SSO', 'Application'], ['Actualisation', 'NAS du salon'], ['Enregistrement du partage', 'NAS du salon / Jeux'], ['Configuration du partage', 'NAS du salon / Documents']]
  .forEach(([action, target], i) => log.run(new Date(Date.now() - (4 - i) * 3600e3).toISOString(), 'alice', action, target, 'ok'));
console.log('Demo data written to', process.env.DATA_DIR || './data');
