import { readFileSync } from 'node:fs';
export function setupScript(key) {
  const helper = readFileSync(new URL('../remote/samba-manager-helper.py', import.meta.url)).toString('base64');
  return `#!/bin/bash
set -euo pipefail
if [ "$(id -u)" != 0 ]; then echo 'Exécutez avec sudo bash.'; exit 1; fi
command -v smbd >/dev/null || { echo 'Samba doit déjà être installé.'; exit 1; }
command -v python3 >/dev/null
command -v sudo >/dev/null
id samba-manager >/dev/null 2>&1 || useradd --create-home --shell /bin/sh samba-manager
install -d -o samba-manager -g samba-manager -m 0700 /home/samba-manager/.ssh
printf '%s\\n' 'restrict,command="sudo -n /usr/local/sbin/samba-manager-helper" ${key}' > /home/samba-manager/.ssh/authorized_keys
chown samba-manager:samba-manager /home/samba-manager/.ssh/authorized_keys
chmod 0600 /home/samba-manager/.ssh/authorized_keys
printf '%s' '${helper}' | base64 -d > /usr/local/sbin/samba-manager-helper
chown root:root /usr/local/sbin/samba-manager-helper
chmod 0755 /usr/local/sbin/samba-manager-helper
printf '%s\\n' 'samba-manager ALL=(root) NOPASSWD: /usr/local/sbin/samba-manager-helper ""' > /etc/sudoers.d/samba-manager
chmod 0440 /etc/sudoers.d/samba-manager
visudo -cf /etc/sudoers.d/samba-manager
install -d -o root -g root -m 0700 /var/lib/samba-manager/backups
if ! grep -Fq 'include = /etc/samba/samba-manager.conf' /etc/samba/smb.conf; then
  backup="/var/lib/samba-manager/backups/smb.conf.$(date +%Y%m%dT%H%M%S)"
  cp -p /etc/samba/smb.conf "$backup"
  touch /etc/samba/samba-manager.conf
  chown root:root /etc/samba/samba-manager.conf
  chmod 0644 /etc/samba/samba-manager.conf
  printf '\\n[global]\\n    include = /etc/samba/samba-manager.conf\\n' >> /etc/samba/smb.conf
  if ! testparm -s >/dev/null 2>&1 || ! systemctl reload smbd; then
    cp -p "$backup" /etc/samba/smb.conf
    systemctl reload smbd || true
    echo 'Configuration restaurée : intégration refusée.'; exit 1
  fi
fi
echo 'Compte Sillage installé. Empreinte SSH à renseigner dans l’application :'
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
`;
}
