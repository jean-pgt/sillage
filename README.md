# Sillage

**Interface web auto-hébergée pour administrer plusieurs serveurs Samba**, en français, pensée pour un homelab ou une petite structure.

*Self-hosted web UI to manage one or more Samba file servers over SSH (shares, accounts, groups, storage view, client mount scripts). The interface is in French.*

## Ce que fait Sillage

- **Partages** : liste de tous les partages de tous vos serveurs, avec recherche. Création, modification (lecture/écriture, comptes et groupes autorisés, visibilité, description) et retrait sans toucher aux fichiers.
- **Se connecter** : chemin Windows (`\\serveur\partage`), adresse macOS/Linux (`smb://…`) et commande `mount -t cifs`, prêts à copier.
- **Scripts de montage** : cochez des partages, choisissez une lettre de lecteur, téléchargez un script **Windows (PowerShell)**, **macOS** ou **Linux**.
  - Aucun mot de passe dans le script : il est demandé une fois sur le poste (Gestionnaire d'identification Windows, trousseau macOS, fichier root 600 sous Linux).
  - Les partages ne sont montés que si le serveur répond. Hors réseau local ou VPN, ils sont retirés : l'explorateur de fichiers ne se fige plus.
- **Adresse pour les postes** : par serveur, l'IP ou le nom DNS local que les ordinateurs utilisent (peut différer de l'adresse SSH).
- **Comptes et groupes** : comptes Samba, mots de passe Samba, membres des groupes.
- **Stockage** : disques, RAID Linux, pools et datasets ZFS, montages, en consultation seule.
- **Sécurité** : connexion OpenID Connect (Authentik, Keycloak, Authelia, Zitadel…) avec PKCE, state, nonce et groupe obligatoire ; empreintes SSH épinglées ; historique des actions ; chaque modification Samba est sauvegardée, validée par `testparm` et annulée automatiquement en cas d'erreur.

## Fonctionnement

Sillage se connecte en SSH à chaque serveur Samba avec un **compte dédié** (`samba-manager`) et une clé Ed25519. Ce compte ne peut lancer qu'**un seul programme** (`/usr/local/sbin/samba-manager-helper`, commande forcée et `sudo` limité), qui accepte un petit document JSON validé : inventaire et gestion des partages. Aucun service supplémentaire n'est installé sur le serveur Samba.

Les partages créés par Sillage sont écrits dans `/etc/samba/samba-manager.conf`, inclus à la fin de `smb.conf`. Les partages existants de `smb.conf` restent modifiables section par section, sans réécrire le reste.

## Installation

Deux méthodes : **Docker** ou **conteneur LXC** (Proxmox ou toute machine Debian). Node.js 24 est requis (fourni dans les deux cas).

### Docker

```bash
git clone https://github.com/<vous>/sillage.git && cd sillage
cp .env.example .env
# Renseignez APP_ORIGIN (adresse exacte de l'appli) et BOOTSTRAP_TOKEN (openssl rand -hex 24)
docker compose up -d --build
```

L'application écoute sur le port 3000. Les données (base SQLite et clé SSH) sont dans le volume `sillage-data`.

### LXC (Proxmox) ou Debian

Créez un conteneur Debian 12 ou 13 (1 cœur, 1 Go de mémoire, 4 Go de disque suffisent ; sous Proxmox, cochez l'option **nesting** pour Debian 13), puis dans le conteneur :

```bash
apt-get update && apt-get install -y git
git clone https://github.com/<vous>/sillage.git /root/sillage && cd /root/sillage
bash install/lxc.sh
```

Le script installe Node.js (archive officielle, empreinte vérifiée), compile, lance les tests, crée le service `sillage` (systemd, compte sans connexion, démarrage automatique) et affiche l'adresse et le code d'installation. Code dans `/opt/sillage`, données dans `/var/lib/sillage`, réglages dans `/opt/sillage/.env`.

Mise à jour : `git pull && bash install/lxc.sh`.

> Donnez au conteneur une **adresse IP fixe** (ou une réservation DHCP) : c'est elle que vous déclarez dans votre reverse proxy et chez votre fournisseur OIDC.

## Premier lancement

1. Ouvrez l'application et créez le compte local avec le **code d'installation** (`BOOTSTRAP_TOKEN`).
2. **Ajouter un serveur** : l'assistant affiche un script à lancer avec `sudo bash` sur le serveur Samba. Il crée le compte `samba-manager`, installe le programme d'aide et affiche l'empreinte SSH du serveur, à recopier dans Sillage.
3. Cliquez sur **Actualiser** : partages, comptes et stockage apparaissent.

## Connexion OpenID Connect (recommandée)

Créez chez votre fournisseur une application OAuth2/OpenID Connect (client confidentiel) avec l'URL de retour :

```text
https://sillage.example.com/api/auth/callback
```

Puis dans `.env` :

```dotenv
APP_ORIGIN=https://sillage.example.com
OIDC_PROVIDER_NAME=Mon SSO
OIDC_ISSUER=https://auth.example.com/application/o/sillage/
OIDC_CLIENT_ID=…
OIDC_CLIENT_SECRET=…
OIDC_ADMIN_GROUP=sillage-admins
LOCAL_LOGIN_ENABLED=false
```

- `OIDC_ADMIN_GROUP` impose l'appartenance exacte à ce groupe dans le jeton signé (claim `groups`). Sans lui, `OIDC_ADMIN_SUBJECTS` donne une liste explicite d'identifiants `sub`.
- `LOCAL_LOGIN_ENABLED=false` désactive le compte local et refuse les anciennes sessions locales, une fois la connexion OIDC vérifiée. En secours, remettez `true` et redémarrez.
- Utilisez HTTPS (reverse proxy) en production : le cookie de session est alors `__Host-`, `Secure`, `HttpOnly`.

## Réglages (`.env`)

| Variable | Rôle |
|---|---|
| `APP_ORIGIN` | Adresse exacte de l'application (cookies, vérification d'origine, retour OIDC) |
| `HOST`, `PORT` | Écoute (par défaut `0.0.0.0:3000`) |
| `DATA_DIR`, `SSH_KEY_PATH` | Base SQLite et clé SSH de l'application |
| `BOOTSTRAP_TOKEN` | Code d'installation du premier compte local |
| `LOCAL_LOGIN_ENABLED` | `true` / `false` |
| `OIDC_PROVIDER_NAME` | Nom affiché sur le bouton de connexion |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Fournisseur OpenID Connect |
| `OIDC_ADMIN_GROUP`, `OIDC_ADMIN_SUBJECTS` | Qui peut administrer |

## Limites

Pas d'édition de la section `[global]`, des identités LDAP/AD, ni des ACL récursives ; pas de suppression des comptes Linux. La vue Stockage ne monte, ne formate et ne modifie aucun disque. Les sauvegardes faites par Sillage concernent la configuration Samba, pas les fichiers des partages.

## Développement

```bash
npm ci
npm test          # tests Node (sécurité, OIDC, chemins, scripts de montage)
npm run typecheck
npm run build
cp .env.example .env && npm start
```

Les tests du programme d'aide côté serveur : `python3 -m unittest discover remote`.

## Licence

MIT
