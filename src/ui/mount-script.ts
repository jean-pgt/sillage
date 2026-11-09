// Scripts de montage des partages pour les postes (Windows, macOS, Linux).
// Aucun mot de passe n'est jamais écrit dans un script : il est demandé sur le poste, une seule fois,
// puis rangé par le système (Gestionnaire d'identification Windows, trousseau macOS, fichier root 600 sous Linux).
// Logique « portable » commune : on ne monte que si le serveur répond sur le port 445, sinon on démonte,
// pour que l'explorateur de fichiers ne reste jamais bloqué hors du réseau local ou du VPN.

export type MountSystem = 'windows' | 'mac' | 'linux'
export type MountItem = { host: string; share: string; letter?: string; folder?: string }
export type MountScript = { filename: string; content: string }

const HOST = /^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}$/
const LETTER = /^[D-Z]$/
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'"
const psQuote = (value: string) => "'" + value.replaceAll("'", "''") + "'"

export function slug(name: string) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'partage'
}

/** Vérifie les entrées et donne à chaque partage un dossier Linux unique. Lève une erreur lisible sinon. */
export function normalizeItems(system: MountSystem, items: MountItem[], username: string) {
  if (!items.length) throw new Error('Cochez au moins un partage.')
  if (/[,\r\n\0'"|\\]/.test(username)) throw new Error('Le compte ne doit contenir ni virgule, ni guillemet, ni barre, ni retour à la ligne.')
  const letters = new Set<string>(); const folders = new Set<string>()
  return items.map(item => {
    if (!HOST.test(item.host)) throw new Error(`Adresse de serveur invalide : ${item.host}`)
    if (!item.share || /[|\r\n\0\\/]/.test(item.share)) throw new Error(`Nom de partage non pris en charge : ${item.share}`)
    const letter = (item.letter || '').toUpperCase().replace(/:$/, '')
    if (system === 'windows') {
      if (!LETTER.test(letter)) throw new Error(`Choisissez une lettre de lecteur (D à Z) pour ${item.share}.`)
      if (letters.has(letter)) throw new Error(`La lettre ${letter}: est utilisée deux fois.`)
      letters.add(letter)
    }
    let folder = item.folder || '/mnt/' + slug(item.share)
    for (let n = 2; folders.has(folder); n++) folder = (item.folder || '/mnt/' + slug(item.share)) + '-' + n
    folders.add(folder)
    return { host: item.host, share: item.share, letter, folder }
  })
}

export function mountScript(system: MountSystem, rawItems: MountItem[], username = '', generatedAt = new Date()): MountScript {
  const items = normalizeItems(system, rawItems, username.trim())
  const user = username.trim()
  const stamp = generatedAt.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })
  if (system === 'windows') return { filename: 'sillage-partages.ps1', content: windows(items, user, stamp) }
  if (system === 'mac') return { filename: 'sillage-partages-mac.sh', content: mac(items, user, stamp) }
  return { filename: 'sillage-partages-linux.sh', content: linux(items, user, stamp) }
}

type Item = ReturnType<typeof normalizeItems>[number]

function windows(items: Item[], user: string, stamp: string) {
  const list = items.map(i => `  @{ Lettre = ${psQuote(i.letter + ':')}; Serveur = ${psQuote(i.host)}; Partage = ${psQuote(i.share)} }`).join("\n")
  const body = `# Sillage : montage des partages réseau (Windows)
# Généré le ${stamp}. Ce fichier ne contient aucun mot de passe.
#
# Installer : clic droit sur ce fichier > « Exécuter avec PowerShell »
#   ou : powershell -ExecutionPolicy Bypass -File .\\sillage-partages.ps1
# Retirer   : powershell -ExecutionPolicy Bypass -File .\\sillage-partages.ps1 -Desinstaller
#
# Le mot de passe est demandé une fois et rangé dans le Gestionnaire d'identification Windows.
# Les lecteurs ne sont montés que si le serveur répond (réseau local ou VPN) : à l'ouverture de session,
# à chaque changement de réseau et toutes les 5 minutes. Hors réseau, ils sont retirés : l'Explorateur ne se fige plus.
param([switch]$Monter, [switch]$Desinstaller)

$Partages = @(
${list}
)
$Compte = ${psQuote(user)}
$Dossier = Join-Path $env:LOCALAPPDATA 'Sillage'
$Cible = Join-Path $Dossier 'partages.ps1'
$Lanceur = Join-Path $Dossier 'partages.vbs'
$Tache = 'Sillage - partages reseau'

function Test-Serveur([string]$Nom) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $essai = $client.BeginConnect($Nom, 445, $null, $null)
    return ($essai.AsyncWaitHandle.WaitOne(1500) -and $client.Connected)
  } catch { return $false } finally { $client.Close() }
}

function Monter-Partages {
  foreach ($serveur in ($Partages | ForEach-Object { $_.Serveur } | Select-Object -Unique)) {
    $joignable = Test-Serveur $serveur
    foreach ($p in ($Partages | Where-Object { $_.Serveur -eq $serveur })) {
      $chemin = "\\\\$($p.Serveur)\\$($p.Partage)"
      $actuel = Get-SmbMapping -LocalPath $p.Lettre -ErrorAction SilentlyContinue
      if ($joignable) {
        if ($actuel -and ($actuel.RemotePath -ne $chemin -or $actuel.Status -ne 'OK')) {
          net use $p.Lettre /delete /y 2>$null | Out-Null
          $actuel = $null
        }
        if (-not $actuel) { net use $p.Lettre $chemin /persistent:no 2>$null | Out-Null }
      } elseif ($actuel) {
        net use $p.Lettre /delete /y 2>$null | Out-Null
      }
    }
  }
}

if ($Monter) { Monter-Partages; exit 0 }

if ($Desinstaller) {
  Unregister-ScheduledTask -TaskName $Tache -Confirm:$false -ErrorAction SilentlyContinue
  foreach ($p in $Partages) { net use $p.Lettre /delete /y 2>$null | Out-Null }
  Remove-Item -LiteralPath $Dossier -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'Partages Sillage retirés. Les identifiants restent dans le Gestionnaire d''identification Windows.'
  exit 0
}

# Installation : identifiants demandés une fois par serveur, gardés par Windows (cmdkey).
foreach ($serveur in ($Partages | ForEach-Object { $_.Serveur } | Select-Object -Unique)) {
  $message = "Compte Samba pour $serveur"
  $id = if ($Compte) { Get-Credential -UserName $Compte -Message $message } else { Get-Credential -Message $message }
  if (-not $id) { Write-Host 'Installation annulée.'; exit 1 }
  cmdkey /add:$serveur /user:$($id.UserName) /pass:$($id.GetNetworkCredential().Password) | Out-Null
}
New-Item -ItemType Directory -Force -Path $Dossier | Out-Null
Copy-Item -LiteralPath $PSCommandPath -Destination $Cible -Force
# Anciens lecteurs persistants sur ces lettres : ce sont eux qui figent l'Explorateur hors réseau.
foreach ($p in $Partages) { net use $p.Lettre /delete /y 2>$null | Out-Null }
# Lanceur invisible (pas de fenêtre qui clignote toutes les 5 minutes)
Set-Content -LiteralPath $Lanceur -Encoding Unicode -Value ('CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & "' + $Cible + '" & """ -Monter", 0, False')
$utilisateur = [Security.SecurityElement]::Escape([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$argument = [Security.SecurityElement]::Escape('"' + $Lanceur + '"')
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Monte les partages réseau quand le serveur est joignable (Sillage).</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>$utilisateur</UserId><Delay>PT10S</Delay><Repetition><Interval>PT5M</Interval></Repetition></LogonTrigger>
    <EventTrigger><Enabled>true</Enabled><Delay>PT5S</Delay><Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="Microsoft-Windows-NetworkProfile/Operational"&gt;&lt;Select Path="Microsoft-Windows-NetworkProfile/Operational"&gt;*[System[(EventID=10000 or EventID=10001)]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription></EventTrigger>
  </Triggers>
  <Principals><Principal id="Utilisateur"><UserId>$utilisateur</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Utilisateur"><Exec><Command>wscript.exe</Command><Arguments>$argument</Arguments></Exec></Actions>
</Task>
"@
Register-ScheduledTask -TaskName $Tache -Xml $xml -Force | Out-Null
Monter-Partages
Write-Host 'Partages Sillage installés :'
Get-SmbMapping | Where-Object { $Partages.Lettre -contains $_.LocalPath } | Format-Table LocalPath, RemotePath, Status -AutoSize
Write-Host 'Hors réseau, les lecteurs sont retirés puis remontés automatiquement au retour.'
`
  // PowerShell 5.1 lit les .ps1 sans BOM comme ANSI : on garde des fins de ligne Windows, le BOM est ajouté au téléchargement.
  return body.replaceAll("\n", "\r\n")
}

function mac(items: Item[], user: string, stamp: string) {
  const list = items.map(i => `  ${shellQuote(i.host + '|' + i.share + '|' + encodeURIComponent(i.share))}`).join("\n")
  return `#!/bin/bash
# Sillage : montage des partages réseau (macOS)
# Généré le ${stamp}. Ce fichier ne contient aucun mot de passe.
#
# Installer : bash sillage-partages-mac.sh
# Retirer   : bash sillage-partages-mac.sh --desinstaller
#
# Le mot de passe est demandé une fois par macOS : cochez « Mémoriser ce mot de passe dans mon trousseau ».
# Les partages apparaissent dans le Finder (/Volumes). Ils ne sont montés que si le serveur répond
# (réseau local ou VPN) : à l'ouverture de session, à chaque changement de réseau et toutes les 5 minutes.
set -u
COMPTE=${shellQuote(user)}
PARTAGES=(
${list}
)
DOSSIER="$HOME/Library/Application Support/Sillage"
CIBLE="$DOSSIER/partages.sh"
AGENT="$HOME/Library/LaunchAgents/fr.sillage.partages.plist"

joignable() { /usr/bin/nc -z -G 2 "$1" 445 >/dev/null 2>&1; }
point_de_montage() { /sbin/mount | grep -F "@$1/$2 on " | sed -E 's/^.* on (.*) \\(smbfs.*$/\\1/' | head -n 1; }

monter() {
  for entree in "\${PARTAGES[@]}"; do
    IFS='|' read -r serveur partage code <<< "$entree"
    point=$(point_de_montage "$serveur" "$code")
    if joignable "$serveur"; then
      [ -n "$point" ] && continue
      /usr/bin/osascript -e "mount volume \\"smb://$COMPTE@$serveur/$code\\"" >/dev/null 2>&1 \\
        || echo "Montage impossible : $partage sur $serveur"
    elif [ -n "$point" ]; then
      /usr/sbin/diskutil unmount force "$point" >/dev/null 2>&1
    fi
  done
}

case "\${1:-}" in
  --monter) monter; exit 0 ;;
  --desinstaller)
    launchctl bootout "gui/$(id -u)" "$AGENT" 2>/dev/null
    rm -f "$AGENT"; rm -rf "$DOSSIER"
    for entree in "\${PARTAGES[@]}"; do
      IFS='|' read -r serveur partage code <<< "$entree"
      point=$(point_de_montage "$serveur" "$code"); [ -n "$point" ] && /usr/sbin/diskutil unmount "$point" >/dev/null 2>&1
    done
    echo "Partages Sillage retirés. Le mot de passe reste dans le trousseau (app Trousseaux d'accès)."
    exit 0 ;;
esac

if [ -z "$COMPTE" ]; then
  read -r -p "Compte Samba : " COMPTE
  [ -n "$COMPTE" ] || { echo "Compte obligatoire."; exit 1; }
fi
mkdir -p "$DOSSIER" "$HOME/Library/LaunchAgents"
sed "s|^COMPTE=.*$|COMPTE='$COMPTE'|" "$0" > "$CIBLE"
chmod 700 "$CIBLE"
cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>fr.sillage.partages</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$CIBLE</string><string>--monter</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>300</integer>
  <key>WatchPaths</key><array><string>/Library/Preferences/SystemConfiguration</string></array>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)" "$AGENT" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" "$AGENT"
monter
echo "Partages Sillage installés. Hors réseau, ils sont démontés puis remontés automatiquement au retour."
`
}

function linux(items: Item[], user: string, stamp: string) {
  const list = items.map(i => `  ${shellQuote(i.host + '|' + i.share + '|' + i.folder)}`).join("\n")
  return `#!/bin/bash
# Sillage : montage des partages réseau (Linux, systemd)
# Généré le ${stamp}. Ce fichier ne contient aucun mot de passe.
#
# Installer : sudo bash sillage-partages-linux.sh
# Retirer   : sudo bash sillage-partages-linux.sh --desinstaller
#
# Le mot de passe est demandé une fois et rangé dans /etc/sillage (lisible par root seulement).
# Montage automatique à la demande (systemd automount) : le partage n'est monté qu'à l'ouverture du dossier,
# avec un délai court ; hors réseau, l'accès échoue vite au lieu de bloquer le gestionnaire de fichiers.
set -eu
[ "$(id -u)" = 0 ] || exec sudo bash "$0" "$@"
COMPTE=${shellQuote(user)}
PARTAGES=(
${list}
)
UTILISATEUR="\${SUDO_USER:-root}"
DEBUT='# >>> Sillage (partages réseau) >>>'
FIN='# <<< Sillage (partages réseau) <<<'
fstab_echap() { printf '%s' "$1" | sed 's/ /\\\\040/g'; }
retirer_bloc() { sed -i "/^$DEBUT\$/,/^$FIN\$/d" /etc/fstab; }
unites() { for entree in "\${PARTAGES[@]}"; do IFS='|' read -r s p dossier <<< "$entree"; systemd-escape -p --suffix=automount "$dossier"; done; }

if [ "\${1:-}" = "--desinstaller" ]; then
  for u in $(unites); do systemctl stop "$u" 2>/dev/null || true; done
  for entree in "\${PARTAGES[@]}"; do IFS='|' read -r s p dossier <<< "$entree"; umount -l "$dossier" 2>/dev/null || true; done
  cp /etc/fstab "/etc/fstab.sillage-$(date +%F-%H%M%S).bak"
  retirer_bloc; rm -rf /etc/sillage
  systemctl daemon-reload
  echo "Partages Sillage retirés."; exit 0
fi

if ! command -v mount.cifs >/dev/null 2>&1; then
  if command -v apt-get >/dev/null; then apt-get install -y cifs-utils
  elif command -v dnf >/dev/null; then dnf install -y cifs-utils
  elif command -v pacman >/dev/null; then pacman -S --noconfirm cifs-utils
  else echo "Installez cifs-utils puis relancez."; exit 1; fi
fi
if [ -z "$COMPTE" ]; then read -r -p "Compte Samba : " COMPTE; fi
[ -n "$COMPTE" ] || { echo "Compte obligatoire."; exit 1; }
uid=$(id -u "$UTILISATEUR"); gid=$(id -g "$UTILISATEUR")
install -d -m 700 /etc/sillage
bloc="$DEBUT"
for entree in "\${PARTAGES[@]}"; do
  IFS='|' read -r serveur partage dossier <<< "$entree"
  ident="/etc/sillage/$(printf '%s' "$serveur" | tr -c 'a-zA-Z0-9.-' '_').cred"
  if [ ! -s "$ident" ]; then
    read -r -s -p "Mot de passe Samba de $COMPTE sur $serveur : " mdp; echo
    ( umask 077; printf 'username=%s\\npassword=%s\\n' "$COMPTE" "$mdp" > "$ident" ); unset mdp
  fi
  mkdir -p "$dossier"
  bloc="$bloc
$(fstab_echap "//$serveur/$partage") $(fstab_echap "$dossier") cifs credentials=$ident,uid=$uid,gid=$gid,iocharset=utf8,soft,_netdev,nofail,noauto,x-systemd.automount,x-systemd.idle-timeout=120,x-systemd.mount-timeout=5 0 0"
done
bloc="$bloc
$FIN"
cp /etc/fstab "/etc/fstab.sillage-$(date +%F-%H%M%S).bak"
retirer_bloc
printf '%s\\n' "$bloc" >> /etc/fstab
systemctl daemon-reload
for u in $(unites); do systemctl restart "$u"; done
echo "Partages Sillage installés :"
for entree in "\${PARTAGES[@]}"; do IFS='|' read -r s p dossier <<< "$entree"; echo "  $dossier  ←  //$s/$p"; done
echo "Ils se montent à l'ouverture du dossier, quand le serveur répond (réseau local ou VPN)."
`
}
