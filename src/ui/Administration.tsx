import { useState, type FormEvent } from 'react'
import { Check, LoaderCircle, Trash2 } from 'lucide-react'
import type { Host, Share } from './App'
import { api } from './client-api'

type Account=NonNullable<Host['snapshot']>['users'][number]
type Group=NonNullable<Host['snapshot']>['groups'][number]
const protectedGroups=new Set(['root','sudo','wheel','adm','disk','shadow','docker','lxd','libvirt','kvm','samba-manager'])
const usableGroups=(host:Host|undefined)=>(host?.snapshot?.groups||[]).filter(group=>group.gid>=1000&&!protectedGroups.has(group.name))

export function ShareEditor({servers,editing,initialServerId,onSaved}:{servers:Host[];editing:{serverId:string;share:Share}|null;initialServerId:string;onSaved:()=>Promise<void>}){
  const old=editing?.share
  const [serverId,setServerId]=useState(editing?.serverId||servers.find(server=>server.id===initialServerId)?.id||servers[0]?.id||'')
  const [name,setName]=useState(old?.name||'')
  const [root,setRoot]=useState('/srv/samba')
  const [path,setPath]=useState(old?.path||'')
  const [group,setGroup]=useState(old?old.forceGroup||'':usableGroups(servers.find(server=>server.id===serverId))[0]?.name||'')
  const [validUsers,setValidUsers]=useState(old?old.validUsers:group?'@'+group:'')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const host=servers.find(server=>server.id===serverId)
  const roots=host?.snapshot?.capabilities?.dataRoots||['/srv/samba']
  const suggested=root+'/'+(name.toLowerCase().replace(/[^a-z0-9_-]/g,'-')||'documents')
  const ready=Boolean(host?.snapshot?.capabilities?.configureShares)
  const editable=!old||old.editable===true
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError('')
    const form=new FormData(event.currentTarget)
    try{
      await api(`servers/${serverId}/share-config`,'POST',{name,path:path||suggested,revision:old?.revision||undefined,comment:form.get('comment'),readOnly:form.get('access')==='ro',browseable:form.get('browseable')==='on',group,validUsers,writeList:form.get('writeList'),createDirectory:form.get('createDirectory')==='on',applyPermissions:form.get('applyPermissions')==='on',directoryMode:form.get('directoryMode')})
      await onSaved()
    }catch(e){setError(e instanceof Error?e.message:'Enregistrement impossible.')}
    finally{setBusy(false)}
  }
  return <form className="admin-form" onSubmit={submit}>
    {error&&<div className="alert error" role="alert">{error}</div>}
    {!ready&&<p className="alert error">Le module de gestion de ce serveur doit être mis à jour, puis son inventaire actualisé.</p>}
    {!editable&&<p className="alert error">Cette définition technique ou issue d’un fichier inclus externe ne peut pas être modifiée ici.</p>}
    <label>Serveur<select value={serverId} onChange={event=>{setServerId(event.target.value);setRoot('/srv/samba');setGroup('')}} disabled={Boolean(old)} required>{servers.map(server=><option key={server.id} value={server.id}>{server.name}</option>)}</select></label>
    <label>Nom du partage<input value={name} onChange={event=>setName(event.target.value)} readOnly={Boolean(old)} required maxLength={80} placeholder="Documents"/></label>
    {!old&&<label>Volume du dossier<select value={root} onChange={event=>{setRoot(event.target.value);setPath('')}}>{roots.map(value=><option key={value} value={value}>{value}</option>)}</select></label>}
    <label>Dossier à partager<input value={path||(!old?suggested:'')} onChange={event=>setPath(event.target.value)} required placeholder="/mnt/raid/Documents"/></label>
    <label className="admin-checkbox"><input type="checkbox" name="createDirectory" defaultChecked={!old}/>Créer le dossier s’il n’existe pas</label>
    <label>Accès<select name="access" defaultValue={old?.readOnly?'ro':'rw'}><option value="rw">Lecture et écriture</option><option value="ro">Lecture seule</option></select></label>
    <label>Utilisateurs et groupes autorisés<input value={validUsers} onChange={event=>setValidUsers(event.target.value)} placeholder="alice, @famille"/></label>
    <p className="form-help">Préfixez un groupe par @. Vide : tous les comptes Samba authentifiés. Les droits du dossier restent applicables.</p>
    <label>Groupe des nouveaux fichiers<select value={group} onChange={event=>{const next=event.target.value;setGroup(next);if(!validUsers||validUsers==='@'+group)setValidUsers(next?'@'+next:'')}}><option value="">Conserver les groupes des utilisateurs</option>{usableGroups(host).map(item=><option key={item.gid} value={item.name}>{item.name} · GID {item.gid}</option>)}</select></label>
    <details className="admin-advanced"><summary>Permissions du dossier et options</summary>
      <label>Permissions du dossier<select name="directoryMode" defaultValue="2770"><option value="2770">Propriétaire et groupe : accès complet</option><option value="2775">Groupe : accès complet ; autres : lecture</option><option value="0750">Propriétaire : complet ; groupe : lecture</option><option value="0770">Propriétaire et groupe : complet, sans héritage</option></select></label>
      <label className="admin-checkbox"><input type="checkbox" name="applyPermissions"/>Appliquer ce groupe et ces permissions au dossier actuel</label>
      <p className="form-help">Uniquement ce dossier, sans modification récursive des fichiers. Sans cette option, les droits d’un dossier existant sont conservés.</p>
      <label>Comptes autorisés à écrire<input name="writeList" defaultValue={old?.writeList||''} placeholder="alice, @administrateurs"/></label>
      <label className="admin-checkbox"><input type="checkbox" name="browseable" defaultChecked={old?.browseable!==false}/>Visible dans le voisinage réseau</label>
      <label>Description<input name="comment" defaultValue={old?.comment||''} maxLength={160}/></label>
      {old&&<dl className="details"><div><dt>Propriétaire du dossier</dt><dd>{old.owner||'Non résolu'}</dd></div><div><dt>Groupe et mode actuels</dt><dd>{old.group||'Non résolu'} · {old.mode||'Non résolu'}</dd></div></dl>}
    </details>
    <p className="form-help">La configuration est sauvegardée, vérifiée par Samba, puis rechargée. Une erreur restaure la version précédente.</p>
    <button className="button primary full" disabled={busy||!ready||!editable}>{busy?<LoaderCircle size={17} className="spin"/>:<Check size={17}/>} {old?'Enregistrer les modifications':'Créer le partage'}</button>
    {old&&editable&&<button type="button" className="button danger full" disabled={busy} onClick={async()=>{if(!confirm('Retirer ce partage de Samba ? Le dossier et ses fichiers seront conservés.'))return;setBusy(true);try{await api(`servers/${serverId}/share-config`,'DELETE',{name:old.name,revision:old.revision});await onSaved()}catch(e){setError(e instanceof Error?e.message:'Retrait impossible.')}finally{setBusy(false)}}}><Trash2 size={16}/>Retirer le partage, garder les fichiers</button>}
  </form>
}

export function AccountEditor({servers,serverId:initialServer,user,onSaved}:{servers:Host[];serverId:string;user?:Account;onSaved:()=>Promise<void>}){
  const [serverId,setServerId]=useState(initialServer||servers[0]?.id||'')
  const [name,setName]=useState(user?.name||'')
  const [groups,setGroups]=useState(user?.groups||[])
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const host=servers.find(server=>server.id===serverId)
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError('')
    try{const form=new FormData(event.currentTarget);await api(`servers/${serverId}/users`,'POST',{name,password:form.get('password'),groups:groups.filter(name=>usableGroups(host).some(g=>g.name===name))});await onSaved()}
    catch(e){setError(e instanceof Error?e.message:'Mise à jour impossible.')}
    finally{setBusy(false)}
  }
  return <form className="admin-form" onSubmit={submit}>{error&&<div className="alert error" role="alert">{error}</div>}<label>Serveur<select value={serverId} onChange={event=>{setServerId(event.target.value);setGroups([])}} disabled={Boolean(user)}>{servers.map(server=><option key={server.id} value={server.id}>{server.name}</option>)}</select></label><label>Nom du compte<input value={name} onChange={event=>setName(event.target.value)} readOnly={Boolean(user)} required pattern="[a-z_][a-z0-9_-]*" maxLength={32}/></label><label>{user?'Nouveau mot de passe Samba (facultatif)':'Mot de passe Samba'}<input type="password" name="password" minLength={12} maxLength={256} required={!user||!user.sambaEnabled} autoComplete="new-password"/></label><p className="form-help">{user?'Laissez vide pour conserver le mot de passe Samba actuel.':'Compte dédié aux fichiers, sans terminal SSH ni mot de passe Linux.'}</p><fieldset className="account-groups"><legend>Groupes d’accès aux partages</legend>{usableGroups(host).map(group=><label className="admin-checkbox" key={group.name}><input type="checkbox" checked={groups.includes(group.name)} disabled={group.gid===user?.gid} onChange={event=>setGroups(current=>event.target.checked?[...current,group.name]:current.filter(value=>value!==group.name))}/>{group.name}{group.gid===user?.gid&&<small>Groupe principal</small>}</label>)}</fieldset><button className="button primary full" disabled={busy||!host?.snapshot?.capabilities?.accounts}>{busy?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>} {user?'Enregistrer le compte':'Créer le compte Samba'}</button></form>
}

export function GroupEditor({servers,serverId:initialServer,group,onSaved}:{servers:Host[];serverId:string;group?:Group;onSaved:()=>Promise<void>}){
  const [serverId,setServerId]=useState(initialServer||servers[0]?.id||'')
  const [name,setName]=useState(group?.name||'')
  const [members,setMembers]=useState(group?.members||[])
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const host=servers.find(server=>server.id===serverId)
  return <form className="admin-form" onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{await api(`servers/${serverId}/groups`,group?'PUT':'POST',group?{name,members:members.filter(value=>host?.snapshot?.users.some(user=>user.name===value&&user.gid!==group.gid))}:{name});await onSaved()}catch(e){setError(e instanceof Error?e.message:'Mise à jour impossible.')}finally{setBusy(false)}}}>{error&&<div className="alert error" role="alert">{error}</div>}<label>Serveur<select value={serverId} onChange={event=>setServerId(event.target.value)} disabled={Boolean(group)}>{servers.map(server=><option key={server.id} value={server.id}>{server.name}</option>)}</select></label><label>Nom du groupe<input value={name} onChange={event=>setName(event.target.value)} readOnly={Boolean(group)} pattern="[a-z_][a-z0-9_-]*" maxLength={32} required placeholder="famille"/></label>{group&&<fieldset className="account-groups"><legend>Membres</legend>{host?.snapshot?.users.filter(user=>user.name!=='samba-manager').map(user=><label className="admin-checkbox" key={user.name}><input type="checkbox" checked={members.includes(user.name)} disabled={user.gid===group.gid} onChange={event=>setMembers(current=>event.target.checked?[...current,user.name]:current.filter(value=>value!==user.name))}/>{user.name}{user.gid===group.gid&&<small>Groupe principal</small>}</label>)}</fieldset>}<button className="button primary full" disabled={busy||!host?.snapshot?.capabilities?.accounts}>{busy?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>} {group?'Enregistrer les membres':'Créer le groupe'}</button></form>
}

export function AccountsView({servers,selected,onSelect,view,onView,onUser,onGroup}:{servers:Host[];selected:string;onSelect:(id:string)=>void;view:'users'|'groups';onView:(view:'users'|'groups')=>void;onUser:(host:Host,user:Account)=>void;onGroup:(host:Host,group:Group)=>void}){
  const hosts=servers.filter(host=>selected==='all'||host.id===selected)
  return <section className="identity-view"><div className="identity-toolbar"><div className="identity-tabs"><button aria-pressed={view==='users'} onClick={()=>onView('users')}>Utilisateurs</button><button aria-pressed={view==='groups'} onClick={()=>onView('groups')}>Groupes</button></div>{servers.length>1&&<select aria-label="Serveur des comptes" value={selected} onChange={event=>onSelect(event.target.value)}><option value="all">Tous les serveurs</option>{servers.map(host=><option key={host.id} value={host.id}>{host.name}</option>)}</select>}</div><p className="simple-note">{view==='users'?'Créez les accès Samba et attribuez les groupes de vos partages.':'Gérez les groupes et les comptes autorisés sur vos dossiers.'}</p><div className="table-panel verre"><div className="table-scroll"><table><thead><tr><th>Nom</th><th>Serveur</th><th>{view==='users'?'Accès Samba':'Membres'}</th><th>{view==='users'?'Groupes':'GID'}</th><th>Configuration</th></tr></thead><tbody>{hosts.flatMap(host=>view==='users'?(host.snapshot?.users||[]).map(user=><tr key={host.id+user.name}><td><strong>{user.name}</strong><small className="storage-source">UID {user.uid}</small></td><td>{host.name}</td><td>{user.sambaEnabled?'Compte Samba':user.name==='samba-manager'?'Gestion SSH':'À activer'}</td><td>{user.groups.join(', ')||'—'}</td><td>{user.editable!==false&&user.name!=='samba-manager'?<button className="button secondary" onClick={()=>onUser(host,user)}>Modifier</button>:<small>Compte de gestion</small>}</td></tr>):(host.snapshot?.groups||[]).map(group=><tr key={host.id+group.name}><td><strong>{group.name}</strong></td><td>{host.name}</td><td>{group.members.join(', ')||'Aucun membre'}</td><td>{group.gid}</td><td>{group.gid>=1000&&!protectedGroups.has(group.name)?<button className="button secondary" onClick={()=>onGroup(host,group)}>Modifier les membres</button>:<small>Groupe système</small>}</td></tr>))}</tbody></table></div></div></section>
}
