# Embedded into samba-manager-helper.py by tools/embed-admin.py.
# This file is the readable source of the administration operations.
SMB_CONFIG = pathlib.Path('/etc/samba/smb.conf')
PRIVILEGED_GROUPS = {'root', 'sudo', 'wheel', 'adm', 'disk', 'shadow', 'docker', 'lxd', 'libvirt', 'kvm'}

def _safe_account(name):
    if not isinstance(name, str) or not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', name):
        raise ValueError('Nom de compte ou de groupe invalide.')
    if name in PRIVILEGED_GROUPS or name == 'samba-manager':
        raise ValueError('Compte système ou de gestion protégé.')
    return name

def _share_name(name):
    if not isinstance(name, str) or not re.fullmatch(r'[^\[\]\r\n\0/\\]{1,80}', name) or name.lower() in {'global','homes','printers','print$','ipc$'}:
        raise ValueError('Nom de partage invalide ou réservé.')
    return name

def _revision(text):
    import hashlib
    return hashlib.sha256(text.encode()).hexdigest()

def _sections(text, name):
    headers = list(re.finditer(r'^\s*\[([^\]\r\n]+)\][ \t]*(?:[#;].*)?$', text, re.MULTILINE))
    return [(m.start(), headers[i+1].start() if i+1<len(headers) else len(text))
            for i,m in enumerate(headers) if m.group(1).casefold()==name.casefold()]

def _share_file(name):
    candidates=[]
    for path in [CONFIG,SMB_CONFIG]:
        text=path.read_text() if path.exists() else ''
        spans=_sections(text,name)
        if len(spans)>1:
            raise ValueError('Définition répétée dans un fichier : corrigez cette ambiguïté avant modification.')
        if spans:
            candidates.append((path,text,spans[0]))
    if len(candidates)>1:
        raise ValueError('Ce partage est défini dans plusieurs fichiers. Modification refusée.')
    return candidates[0] if candidates else None

def _data_roots(storage):
    excluded=('/proc','/sys','/dev','/run','/boot','/etc','/usr','/var','/opt','/home','/root','/tmp')
    roots=[str(ROOT)]
    for mount in storage.get('mounts',[]):
        target=mount['target']
        if target=='/' or mount.get('technical') or mount.get('readOnly'):
            continue
        if any(target==p or target.startswith(p+'/') for p in excluded):
            continue
        if os.path.isabs(target) and target not in roots:
            roots.append(target)
    return roots

def _check_path(value,roots):
    if not isinstance(value,str) or not value.startswith('/') or len(value)>1024 or any(c in value for c in '\r\n\0'):
        raise ValueError('Chemin absolu invalide.')
    path=pathlib.Path(value)
    if str(path)!=os.path.normpath(value) or '..' in path.parts or path.resolve()!=path:
        raise ValueError('Les chemins symboliques ou contenant .. ne sont pas acceptés.')
    if not any(value==root or value.startswith(root.rstrip('/')+'/') for root in roots):
        raise ValueError('Choisissez un dossier sur un volume de données ou sous /srv/samba.')
    return path

def _atomic_text(path,text):
    if path.is_symlink():
        raise ValueError('Fichier de configuration symbolique refusé.')
    mode=path.stat().st_mode & 0o777 if path.exists() else 0o644
    temporary=path.with_name(path.name+'.sillage-tmp')
    if temporary.is_symlink():
        raise ValueError('Fichier temporaire symbolique refusé.')
    temporary.write_text(text)
    os.chmod(temporary,mode)
    os.replace(temporary,path)

def configure_share(data):
    name=_share_name(data.get('name'))
    STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    with open(STATE/'lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        effective=config(run(['/usr/bin/testparm','-s']).stdout)
        effective_name=next((s for s in effective.sections() if s.casefold()==name.casefold()),None)
        located=_share_file(name)
        if effective_name and not located:
            raise ValueError('Ce partage vient d’un fichier inclus externe. Son édition n’est pas encore prise en charge.')
        if located:
            file,old,span=located
            if data.get('revision')!=_revision(old):
                raise ValueError('La configuration a changé. Actualisez le serveur puis rouvrez le partage.')
        else:
            if data.get('revision'):
                raise ValueError('Le partage a été retiré. Actualisez le serveur.')
            file=CONFIG;old=CONFIG.read_text() if CONFIG.exists() else '';span=None
        if data['op']=='remove_share':
            if not located: raise ValueError('Partage introuvable.')
            updated=old[:span[0]]+old[span[1]:]
            target=None;created=False;before=None
        else:
            roots=_data_roots(storage_inventory())
            path=data.get('path','')
            # An unchanged legacy path can be configured without changing files.
            unchanged=bool(effective_name and effective[effective_name].get('path')==path)
            target=pathlib.Path(path) if unchanged and not data.get('applyPermissions') else _check_path(path,roots)
            if unchanged and (not isinstance(path,str) or any(c in path for c in '\r\n\0')):
                raise ValueError('Chemin invalide.')
            group=data.get('group','')
            gid=None
            if group:
                _safe_account(group)
                try: entry=grp.getgrnam(group)
                except KeyError: raise ValueError('Le groupe n’existe pas sur le serveur.')
                if entry.gr_gid<1000: raise ValueError('Groupe système protégé.')
                gid=entry.gr_gid
            fields={'path':path,'comment':data.get('comment',''),'read only':'yes' if data.get('readOnly') else 'no',
                    'browseable':'yes' if data.get('browseable',True) else 'no',
                    'guest ok':effective[effective_name].get('guest ok','no') if effective_name else 'no','valid users':data.get('validUsers',''),'write list':data.get('writeList','')}
            for key,value in fields.items():
                if not isinstance(value,str) or len(value)>1024 or any(c in value for c in '\r\n\0'):
                    raise ValueError('Champ Samba invalide.')
            for key in ['valid users','write list']:
                if re.search(r'[\[\]#;]',fields[key]): raise ValueError('Liste de comptes invalide.')
            for key in ['readOnly','browseable','createDirectory','applyPermissions']:
                if key in data and type(data[key]) is not bool: raise ValueError('Option invalide.')
            mode=data.get('directoryMode','2770')
            if mode not in ['2770','2775','0770','0750']: raise ValueError('Mode du dossier invalide.')
            fields['force group']=group
            if not located:
                fields.update({'create mask':'0660','directory mask':mode})
            # Preserve unknown Samba options and comments; replace only edited keys.
            aliases={'writable','writeable','read only','browsable','browseable','public','guest ok','group','force group'}
            if span:
                block=old[span[0]:span[1]]
                kept=[]
                for line in block.splitlines():
                    key=line.split('=',1)[0].strip().lower() if '=' in line and not line.lstrip().startswith(('#',';')) else None
                    if key not in fields and key not in aliases: kept.append(line)
                replacement='\n'.join(kept).rstrip()+'\n'+''.join('    '+k+' = '+v+'\n' for k,v in fields.items())+'\n'
                updated=old[:span[0]]+replacement+old[span[1]:]
            else:
                updated=old.rstrip()+'\n\n['+name+']\n'+''.join('    '+k+' = '+v+'\n' for k,v in fields.items())
            created=False;before=None
            if target.exists():
                if not target.is_dir(): raise ValueError('Le chemin doit être un dossier.')
                before=target.stat()
            elif not unchanged or data.get('createDirectory'):
                if not data.get('createDirectory'): raise ValueError('Le dossier n’existe pas. Activez sa création ou choisissez un dossier existant.')
                target=_check_path(path,roots)
                if gid is None: raise ValueError('Choisissez un groupe pour créer le dossier.')
                if target.parent==ROOT and not ROOT.exists(): ROOT.mkdir(mode=0o755)
                if not target.parent.is_dir(): raise ValueError('Le dossier parent doit déjà exister.')
                target.mkdir(mode=int(mode,8));created=True
                os.chown(target,0,gid);os.chmod(target,int(mode,8))
            if data.get('applyPermissions') and (gid is None or not target.is_dir()):
                raise ValueError('Un dossier existant et un groupe sont requis pour appliquer les permissions.')
        backups=STATE/'backups';backups.mkdir(mode=0o700,exist_ok=True)
        stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup=backups/(stamp+'-'+file.name)
        backup.write_text(old);os.chmod(backup,0o600)
        try:
            _atomic_text(file,updated)
            run(['/usr/bin/testparm','-s'])
            if target and data.get('applyPermissions'):
                os.chown(target,-1,gid);os.chmod(target,int(mode,8))
            run(['/usr/bin/systemctl','reload','smbd'])
        except (OSError,subprocess.SubprocessError,ValueError):
            _atomic_text(file,old)
            if before and data.get('applyPermissions'):
                os.chown(target,before.st_uid,before.st_gid);os.chmod(target,before.st_mode & 0o7777)
            if created:
                try: target.rmdir()
                except OSError: pass
            run(['/usr/bin/systemctl','reload','smbd'],check=False)
            raise ValueError('Modification refusée : configuration et permissions précédentes restaurées.')
    return {'saved':True,'backup':backup.name}

def create_group(data):
    name=_safe_account(data.get('name'))
    try: grp.getgrnam(name)
    except KeyError: pass
    else: raise ValueError('Ce groupe existe déjà.')
    run(['/usr/sbin/groupadd',name])
    return {'created':True}

def save_group(data):
    name=_safe_account(data.get('name'))
    try: group=grp.getgrnam(name)
    except KeyError: raise ValueError('Groupe introuvable.')
    if group.gr_gid<1000: raise ValueError('Groupe système protégé.')
    members=data.get('members',[])
    if not isinstance(members,list) or len(members)>128: raise ValueError('Liste de membres invalide.')
    for member in members:
        _safe_account(member)
        try: user=pwd.getpwnam(member)
        except KeyError: raise ValueError('Compte introuvable.')
        if not 1000<=user.pw_uid<65534: raise ValueError('Compte système protégé.')
    backups=STATE/'backups';backups.mkdir(mode=0o700,exist_ok=True)
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup=backups/(stamp+'-group.json')
    backup.write_text(json.dumps({'name':name,'members':group.gr_mem}));os.chmod(backup,0o600)
    run(['/usr/bin/gpasswd','-M',','.join(sorted(set(members))),name])
    return {'saved':True}

def save_user(data):
    name=_safe_account(data.get('name'))
    password=data.get('password','')
    if not isinstance(password,str) or (password and not 12<=len(password)<=256) or any(c in password for c in '\r\n\0'):
        raise ValueError('Le mot de passe doit contenir 12 à 256 caractères, sans retour à la ligne.')
    groups=data.get('groups',[])
    if not isinstance(groups,list) or len(groups)>64: raise ValueError('Liste de groupes invalide.')
    for group in groups:
        _safe_account(group)
        try: entry=grp.getgrnam(group)
        except KeyError: raise ValueError('Groupe introuvable.')
        if entry.gr_gid<1000: raise ValueError('Groupe système protégé.')
    try: account=pwd.getpwnam(name)
    except KeyError: account=None
    if account and not 1000<=account.pw_uid<65534: raise ValueError('Compte système protégé.')
    if not account and not password: raise ValueError('Un mot de passe Samba est requis pour le nouveau compte.')
    created=account is None
    if created:
        run(['/usr/sbin/useradd','--no-create-home','--shell','/usr/sbin/nologin','--user-group',name])
    try:
        if password:
            subprocess.run(['/usr/bin/smbpasswd','-a','-s',name],input=password+'\n'+password+'\n',capture_output=True,text=True,timeout=20,check=True)
        current=[g for g in grp.getgrall() if name in g.gr_mem and g.gr_gid>=1000 and g.gr_name not in PRIVILEGED_GROUPS and g.gr_name!='samba-manager']
        for group in current:
            if group.gr_name not in groups: run(['/usr/bin/gpasswd','-d',name,group.gr_name])
        if groups: run(['/usr/sbin/usermod','-a','-G',','.join(groups),name])
    except (OSError,subprocess.SubprocessError):
        if created:
            run(['/usr/bin/smbpasswd','-x',name],check=False)
            run(['/usr/sbin/userdel',name],check=False)
        raise ValueError('Mise à jour du compte incomplète. Actualisez pour vérifier ses groupes ; le mot de passe peut déjà avoir été changé.')
    return {'saved':True}

def administration(data):
    if data['op'] in ['configure_share','remove_share']: return configure_share(data)
    STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    with open(STATE/'lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if data['op']=='create_group': return create_group(data)
        if data['op']=='save_group': return save_group(data)
        if data['op']=='save_user': return save_user(data)
    raise ValueError('Opération non autorisée.')

def admin_inventory(shares,users,storage):
    for share in shares:
        try:
            _share_name(share['name'])
            located=_share_file(share['name'])
            share.update(editable=bool(located),revision=_revision(located[1]) if located else None)
        except ValueError:
            share.update(editable=False,revision=None)
    try:
        smb={line.split(':',1)[0] for line in run(['/usr/bin/pdbedit','-L']).stdout.splitlines() if ':' in line}
    except (OSError,subprocess.SubprocessError): smb=set()
    for user in users:
        user['sambaEnabled']=user['name'] in smb
        user['editable']=user['name']!='samba-manager'
    return {'configureShares':True,'accounts':True,'dataRoots':_data_roots(storage)}
