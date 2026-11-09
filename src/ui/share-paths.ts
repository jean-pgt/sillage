const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'"

export function sharePaths(host: string, name: string, username = 'VOTRE_COMPTE_SAMBA') {
  const bareHost = host.replace(/^\[|\]$/g, '')
  const authority = bareHost.includes(':') ? `[${bareHost}]` : bareHost
  const windowsHost = bareHost.includes(':') ? bareHost.replaceAll(':', '-').replaceAll('%', 's') + '.ipv6-literal.net' : bareHost
  const windows = `\\\\${windowsHost}\\${name}`
  const smb = `smb://${authority}/${encodeURIComponent(name)}`
  const source = `//${authority}/${name}`
  const localPath = '/mnt/' + (name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'partage')
  // cifs-utils parses commas as option separators; never accept an option injection.
  const validUsername = Boolean(username.trim()) && !/[,\r\n\0]/.test(username)
  const command = validUsername ? `sudo mkdir -p ${shellQuote(localPath)}\nsudo mount -t cifs ${shellQuote(source)} ${shellQuote(localPath)} -o ${shellQuote('username=' + username.trim())},uid=$(id -u),gid=$(id -g)` : null
  return { windows, smb, source, localPath, command }
}

export function isServiceShare(share: {name: string; printable?: boolean}) {
  return share.printable === true || share.name.toLowerCase() === 'printers' || share.name.endsWith('$')
}
