import type { Mount } from './Storage'

const categories = [
  { id: 'raid', title: 'Volumes RAID', description: 'Volumes assemblés à partir de plusieurs disques.', expanded: true },
  { id: 'zfs', title: 'Stockage ZFS', description: 'Pools et datasets montés. La capacité totale des pools est indiquée dans « RAID et pools ZFS ».', expanded: true },
  { id: 'local', title: 'Autres volumes de stockage', description: 'Volumes locaux dédiés aux données, internes ou externes.', expanded: true },
  { id: 'network', title: 'Montages réseau', description: 'Stockage accessible depuis un autre serveur : NFS, SMB ou SSHFS.', expanded: true },
  { id: 'system', title: 'Système Linux', description: 'Système et démarrage : /, /boot, /var… Ces volumes sont séparés du stockage de données.', expanded: false },
  { id: 'technical', title: 'Montages techniques Linux', description: 'Mémoire, noyau et conteneurs. Ces montages ne représentent pas des disques de données.', expanded: true },
] as const

export function mountCategory(mount: Mount, arrays: { path: string }[] = []) {
  if (mount.technical) return 'technical'
  if (['nfs','nfs4','cifs','smb3','sshfs','fuse.sshfs','9p','ceph','glusterfs','fuse.rclone'].includes(mount.fstype)) return 'network'
  if (mount.target === '/' || ['/boot','/usr','/var','/etc','/opt','/home','/root','/tmp'].some(path => mount.target === path || mount.target.startsWith(path + '/'))) return 'system'
  if (mount.fstype === 'zfs') return 'zfs'
  const source = mount.source.split('[')[0]
  if (/^\/dev\/md(?:\d|\/)/.test(source) || arrays.some(array => array.path === source)) return 'raid'
  return 'local'
}

export function groupMounts(mounts: Mount[], arrays: { path: string }[] = []) {
  return categories.map(category => ({ ...category, mounts: mounts.filter(mount => mountCategory(mount, arrays) === category.id) })).filter(group => group.mounts.length > 0)
}
