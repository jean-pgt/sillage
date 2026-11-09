import { BackgroundButton } from './Theme'
import { dataMounts, type StorageInventory } from './Storage'
import { StorageView } from './Volumes'
import { SharesView } from './Shares'
import { ShareConnection } from './ShareConnection'
import { MountScripts } from './MountScripts'
import { clientHost, CLIENT_HOST } from './client-host'
import { ShareEditor, AccountEditor, GroupEditor, AccountsView } from './Administration'
import { api } from './client-api'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowRight, Check, CheckCheck, ChevronDown, CircleHelp, Copy, Database, Folder, FolderPlus, Globe2, History, KeyRound, Layers3, LayoutDashboard, LoaderCircle, LogOut, Moon, Plus, RefreshCw, Search, Server, Settings2, ShieldCheck, Sun, Users, X, ExternalLink, Trash2, LockKeyhole, HardDrive, WifiOff } from 'lucide-react'

export type Share = { name: string; path: string; comment: string; readOnly: boolean; validUsers: string; writeList: string; managed: boolean; owner: string|null; group: string|null; mode: string|null; mountTarget?:string|null;mountSource?:string|null;pathExists?:boolean;printable?:boolean;editable?:boolean;revision?:string|null;forceGroup?:string;browseable?:boolean }
type Snapshot = { capabilities?:{configureShares:boolean;accounts:boolean;dataRoots:string[]};storage?:StorageInventory; hostname: string; service: string; shares: Share[]; users: {name:string;uid:number;gid:number;groups:string[];sambaEnabled?:boolean;editable?:boolean}[]; groups: {name:string;gid:number;members:string[]}[]; disks: {path:string;total:number;used:number;free:number}[] }
export type Host = { id:string;name:string;host:string;client_host?:string|null;port:number;username:string;fingerprint:string;snapshot:Snapshot|null;checked:string|null;error:string|null }
type Audit = {id:number;at:string;actor:string;action:string;target:string;outcome:string}
type User = {id:string;name:string}
type Overview = { servers:Host[];audit:Audit[];user:User }
type Auth = {user:User|null;setupRequired:boolean;oidc:boolean;localLogin?:boolean;providerName?:string}
type Config = {origin:string;callback:string;issuer:string;providerName?:string;oidc:boolean;publicKey:string;version:string}
type View = 'servers'|'storage'|'shares'|'users'|'groups'|'audit'|'settings'
const primaryNav = [
  {id:'shares',label:'Partages',icon:Folder},
  {id:'users',label:'Comptes',icon:Users},
  {id:'storage',label:'Stockage',icon:HardDrive},
  {id:'servers',label:'Serveurs',icon:Server},
] as const
const names:Record<View,string> = {servers:'Serveurs',storage:'Stockage',shares:'Partages',users:'Comptes et groupes',groups:'Comptes et groupes',audit:'Historique',settings:'Réglages'}

const date = (value:string|null) => value ? new Date(value).toLocaleString('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Jamais synchronisé'
export function App() {
  const [auth,setAuth] = useState<Auth|null>(null)
  const [data,setData] = useState<Overview|null>(null)
  const [view,setView] = useState<View>('shares')
  const [selected,setSelected] = useState('all')
  const [drawer,setDrawer] = useState<'server'|'share'|null>(null)
  const [editing,setEditing] = useState<{serverId:string;share:Share}|null>(null)
  const [accountForm,setAccountForm]=useState<{kind:'user'|'group';serverId:string;user?:Snapshot['users'][number];group?:Snapshot['groups'][number]}|null>(null)
  const [connection,setConnection] = useState<{server:Host;share:Share}|null>(null)
  const [scripts,setScripts] = useState(false)
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  const [error,setError] = useState('')
  const [config,setConfig] = useState<Config|null>(null)

  async function load() {
    const next=await api<Overview>('overview');setData(next)
    setSelected(current=>current==='all'||next.servers.some(server=>server.id===current)?current:'all')
  }
  useEffect(()=>{
    api<Auth>('auth/status').then(async status=>{setAuth(status);if(status.user)await load()}).catch(e=>setError(e.message))
  },[])
  useEffect(()=>{
    if(auth?.user)api<Config>('settings').then(setConfig).catch(e=>setError(e.message))
  },[auth?.user])
  useEffect(()=>{
    if(!message)return
    const timer=setTimeout(()=>setMessage(''),4000)
    return()=>clearTimeout(timer)
  },[message])
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{const menu=document.querySelector<HTMLDetailsElement>('.admin-menu[open]');if(menu&&event.target instanceof Node&&!menu.contains(event.target))menu.open=false}
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')document.querySelector('.admin-menu[open]')?.removeAttribute('open')}
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
  },[])
  async function action(task:()=>Promise<unknown>,success?:string) {
    setBusy(true);setError('')
    try { await task();await load();if(success)setMessage(success) }
    catch(e){setError(e instanceof Error?e.message:'Erreur inconnue')}
    finally{setBusy(false)}
  }
  async function refresh() {
    await action(async()=>{
      for(const server of data?.servers||[])if(selected==='all'||server.id===selected)await api(`servers/${server.id}/refresh`,'POST',{})
    },'Inventaire mis à jour.')
  }
  function navigate(next:View) {setView(next);setError('')}
  function details(serverId:string,share:Share){setEditing({serverId,share});setDrawer('share')}
  async function copy(text:string){
    try{await navigator.clipboard.writeText(text);setMessage('Copié.')}
    catch{setError('Copie indisponible. Sélectionnez le texte pour le copier.')}
  }
  if(!auth)return <div className="loading-screen"><Brand/><LoaderCircle className="spin"/><p>{error||'Ouverture de votre espace…'}</p></div>
  if(!auth.user)return <Login auth={auth} onLogin={async()=>{setAuth(await api<Auth>('auth/status'));await load()}}/>

  const servers=data?.servers||[]
  const hosts=servers.filter(server=>selected==='all'||server.id===selected)
  const secondary=['audit','settings'].includes(view)
  return <div className="app-shell simplified-app">
    <header className="app-bar verre">
      <Brand/>
      <nav aria-label="Navigation principale">{primaryNav.map(item=><button key={item.id} aria-current={view===item.id||(item.id==='users'&&view==='groups')?'page':undefined} className={view===item.id||(item.id==='users'&&view==='groups')?'nav active':'nav'} onClick={()=>navigate(item.id)}><item.icon size={17}/><span>{item.label}</span></button>)}</nav>
      <div className="app-tools"><BackgroundButton/><details className="admin-menu"><summary className={secondary?'icon-button selected':'icon-button'} aria-label="Administration" title="Administration"><Settings2 size={19}/></summary><div className="admin-options verre-fort">{[{id:'audit',label:'Historique',icon:History},{id:'settings',label:'Réglages',icon:Settings2}].map(item=><button key={item.id} onClick={event=>{navigate(item.id as View);event.currentTarget.closest('details')?.removeAttribute('open')}}><item.icon size={17}/>{item.label}</button>)}<button onClick={()=>api('auth/logout','POST',{}).then(()=>location.reload()).catch(e=>setError(e.message))}><LogOut size={17}/>Se déconnecter</button></div></details></div>
    </header>
    <main className="simple-main">
      <div className="page-heading"><div><h1>{names[view]}</h1>{view==='shares'&&<p>Vos dossiers en réseau, au même endroit.</p>}</div><div className="heading-actions">{view==='shares'&&<button className="button secondary" disabled={!servers.length} onClick={()=>setScripts(true)}><ArrowDownToLine size={16}/>Script de montage</button>}{!['settings','audit'].includes(view)&&<button className="button secondary" disabled={busy||!servers.length} onClick={refresh}><RefreshCw size={16} className={busy?'spin':''}/>Actualiser</button>}{['shares','servers','users','groups'].includes(view)&&<button className="button primary" disabled={!data} onClick={()=>{if(view==='users'||view==='groups'){setAccountForm({kind:view==='users'?'user':'group',serverId:selected==='all'?servers[0]?.id||'':selected})}else{setEditing(null);setDrawer(view==='shares'&&servers.length?'share':'server')}}}><Plus size={17}/>{view==='users'?'Créer un compte':view==='groups'?'Créer un groupe':view==='shares'&&servers.length?'Créer un partage':'Ajouter un serveur'}</button>}</div></div>
      {error&&<div className="alert error" role="alert"><CircleHelp size={18}/><span>{error}</span><button className="icon-button" aria-label="Fermer l’erreur" onClick={()=>setError('')}><X size={16}/></button></div>}
      {message&&<div className="toast" role="status"><CheckCheck size={18}/>{message}</div>}
      {!data?<div className="empty"><LoaderCircle className="spin"/>Chargement de l’infrastructure…</div>:<>
        {view==='shares'&&<SharesView servers={servers} selected={selected} onSelect={setSelected} onDetails={details} onConnect={(server,share)=>setConnection({server,share})}/>}
        {view==='servers'&&<div className="server-grid">{servers.map(server=><HostCard key={server.id} server={server} onStorage={()=>{setSelected(server.id);navigate('storage')}} onOpen={()=>{setSelected(server.id);navigate('shares')}} onClientHost={value=>action(()=>api(`servers/${server.id}/client-host`,'PUT',{clientHost:value}),'Adresse pour les postes enregistrée.')} onRemove={()=>{if(confirm(`Retirer ${server.name} de l’application ? Sa configuration Samba et ses fichiers seront conservés.`))action(()=>api(`servers/${server.id}`,'DELETE',{}),'Serveur retiré.')}}/>)}{!servers.length&&<Empty icon={<Server/>} title="Connectez votre premier serveur" text="L’assistant prépare un accès dédié sur votre NAS ou serveur Samba."/>}</div>}
        {view==='storage'&&<StorageView hosts={hosts} servers={servers} selected={selected} onSelect={setSelected}/>}
        {(view==='users'||view==='groups')&&<AccountsView servers={servers} selected={selected} onSelect={setSelected} view={view} onView={navigate} onUser={(host,user)=>setAccountForm({kind:'user',serverId:host.id,user})} onGroup={(host,group)=>setAccountForm({kind:'group',serverId:host.id,group})}/>}
        {view==='audit'&&<div className="table-panel verre"><div className="table-scroll"><table><thead><tr><th>Date</th><th>Action</th><th>Cible</th><th>Administrateur</th></tr></thead><tbody>{data.audit.map(entry=><tr key={entry.id}><td>{date(entry.at)}</td><td>{entry.action}</td><td>{entry.target}</td><td>{entry.actor}</td></tr>)}</tbody></table></div>{!data.audit.length&&<Empty icon={<History/>} title="Aucune action enregistrée" text="Les prochaines actions apparaîtront ici."/>}</div>}
        {view==='settings'&&<><Settings config={config} onCopy={copy}/>{auth.localLogin!==false&&<PasswordForm/>}</>}
      </>}
      <footer className="simple-footer"><span>Sillage SMB</span><span><ShieldCheck size={13}/>Accès administrateur</span></footer>
    </main>
    {accountForm&&<Drawer title={accountForm.kind==='user'?(accountForm.user?'Modifier '+accountForm.user.name:'Créer un compte Samba'):(accountForm.group?'Groupe '+accountForm.group.name:'Créer un groupe')} subtitle="Gestion des accès sur le serveur Samba." onClose={()=>setAccountForm(null)}>{accountForm.kind==='user'?<AccountEditor servers={servers} serverId={accountForm.serverId} user={accountForm.user} onSaved={async()=>{await load();setAccountForm(null);setMessage('Compte Samba enregistré.')}}/>:<GroupEditor servers={servers} serverId={accountForm.serverId} group={accountForm.group} onSaved={async()=>{await load();setAccountForm(null);setMessage('Groupe enregistré.')}}/>}</Drawer>}
    {scripts&&<Drawer title="Script de montage" subtitle="Vos partages comme des lecteurs, à la maison ou par le VPN." onClose={()=>setScripts(false)}><MountScripts servers={servers}/></Drawer>}
    {connection&&<Drawer title={'Se connecter à '+connection.share.name} subtitle={connection.server.name+' · '+clientHost(connection.server)} onClose={()=>setConnection(null)}><ShareConnection host={clientHost(connection.server)} name={connection.share.name} pathExists={connection.share.pathExists} printable={connection.share.printable||connection.share.name.toLowerCase()==='printers'}/></Drawer>}
    {drawer&&<Drawer title={drawer==='server'?'Connecter un serveur':editing?'Modifier '+editing.share.name:'Créer un partage'} subtitle={drawer==='server'?'Un accès dédié pour administrer Samba.':editing?'Configuration et droits du partage.':'Choisissez un serveur, un dossier et son groupe.'} onClose={()=>{setDrawer(null);setEditing(null)}}>{drawer==='server'?<ServerForm onSaved={async()=>{await load();setDrawer(null);setMessage('Serveur ajouté. Actualisez pour relever ses partages.')}}/>:<ShareEditor servers={servers} initialServerId={selected} editing={editing} onSaved={async()=>{await load();setDrawer(null);setEditing(null);setMessage('Configuration Samba mise à jour.')}}/>}</Drawer>}
  </div>
}

function Brand(){return <div className="brand"><span className="brand-mark"><Layers3 size={24} strokeWidth={1.7}/></span><span>sillage<span className="brand-period">.</span></span></div>}
function Empty({icon,title,text,action}:{icon:ReactNode;title:string;text:string;action?:ReactNode}){return <div className="empty"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{text}</p>{action}</div>}
function HostCard({server,onOpen,onStorage,onRemove,onClientHost}:{server:Host;onOpen:()=>void;onStorage:()=>void;onRemove?:()=>void;onClientHost:(value:string)=>void}){
  const connected=Boolean(server.snapshot&&!server.error);const storage=server.snapshot?.storage;const mounts=dataMounts(storage)
  return <article className="host-card verre lueur"><div className="host-top"><span className="host-icon"><Server size={25} strokeWidth={1.5}/></span><span className={connected?'badge green':'badge neutral'}><span className={connected?'dot':'dot offline'}/>{connected?'Samba connecté':server.error?'Injoignable':'À connecter'}</span>{onRemove&&<button className="icon-button" aria-label={'Retirer '+server.name} onClick={onRemove}><Trash2 size={15}/></button>}</div><h3>{server.name}</h3><p className="host-address">{server.host} <span>·</span> {server.snapshot?.hostname||'SSH dédié'}</p><div className="host-detail"><span><Folder size={15}/>{server.snapshot?.shares.length??'—'} définitions Samba</span><span><Users size={15}/>{server.snapshot?.users.length??'—'} comptes Linux</span></div><div className="host-storage-summary"><HardDrive size={19}/><div><strong>{storage?`${storage.devices.filter(d=>d.type==='disk').length} disques physiques · ${mounts.length} montages`:'Stockage à actualiser'}</strong><small>{storage?`${storage.arrays.length} RAID Linux · ${storage.pools.length} pools ZFS`:'Le stockage sera relevé au prochain inventaire.'}</small></div></div><button className="button secondary storage-open" onClick={onStorage}><Database size={16}/>Voir les disques et montages<ArrowRight size={15}/></button>{server.error&&<p className="host-error"><WifiOff size={14}/>Connexion à vérifier · données du dernier inventaire</p>}<ClientHostForm server={server} onSave={onClientHost}/><div className="host-bottom"><small>Inventaire : {date(server.checked)}</small><button className="text-button" onClick={onOpen}>Voir les partages<ArrowRight size={15}/></button></div></article>
}
function ClientHostForm({server,onSave}:{server:Host;onSave:(value:string)=>void}){
  const [value,setValue]=useState(server.client_host||'')
  const valid=!value.trim()||CLIENT_HOST.test(value.trim())
  return <details className="client-host"><summary><Globe2 size={15}/>Adresse pour les postes<span>{clientHost(server)}</span></summary><form onSubmit={event=>{event.preventDefault();if(valid)onSave(value.trim())}}><p>IP locale ou nom DNS local que les ordinateurs utilisent pour ouvrir les partages et dans les scripts de montage. Vide : {server.host}.</p><div className="client-host-row"><input aria-label={'Adresse pour les postes de '+server.name} value={value} placeholder={server.host} autoComplete="off" spellCheck={false} onChange={event=>setValue(event.target.value)}/><button className="button secondary" disabled={!valid||value.trim()===(server.client_host||'')}>Enregistrer</button></div>{!valid&&<p role="alert" className="share-warning">Lettres, chiffres, points, tirets ou deux-points seulement.</p>}</form></details>
}
function Drawer({title,subtitle,onClose,children}:{title:string;subtitle:string;onClose:()=>void;children:ReactNode}){
  useEffect(()=>{const prior=document.activeElement;const listener=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const items=Array.from(document.querySelectorAll<HTMLElement>('.drawer button:not(:disabled), .drawer input, .drawer select, .drawer textarea, .drawer a[href], .drawer summary'));const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};document.addEventListener('keydown',listener);document.body.style.overflow='hidden';document.querySelector<HTMLElement>('.drawer button')?.focus();return()=>{document.removeEventListener('keydown',listener);document.body.style.overflow='';if(prior instanceof HTMLElement)prior.focus()}},[])
  return <div className="drawer-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div className="drawer-header"><button className="icon-button" aria-label="Fermer le panneau" onClick={onClose}><X size={21}/></button></div><h2 id="drawer-title">{title}</h2><p className="drawer-subtitle">{subtitle}</p>{children}</aside></div>
}
function Login({auth,onLogin}:{auth:Auth;onLogin:()=>Promise<void>}){
  const [error,setError]=useState('');const [busy,setBusy]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const form=new FormData(e.currentTarget);try{await api(auth.setupRequired?'auth/setup':'auth/login','POST',Object.fromEntries(form));await onLogin()}catch(e){setError(e instanceof Error?e.message:'Connexion impossible.')}finally{setBusy(false)}}
  return <div className="login-screen"><div className="login-intro"><Brand/><div><h1>Votre réseau.<br/>En toute clarté.</h1><p>Un espace pour administrer vos partages,<br/>avec la sérénité de garder le contrôle.</p></div><span><ShieldCheck size={17}/>Auto-hébergé. Simplement.</span></div><div className="login-panel"><span className="login-icon"><KeyRound size={26}/></span><h2>{auth.setupRequired?'Bienvenue chez vous.':'Heureux de vous retrouver.'}</h2><p>{auth.setupRequired?'Créez votre compte administrateur local.':'Connectez-vous pour accéder à votre infrastructure.'}</p>{auth.oidc&&<><a href="/api/auth/oidc" className="button primary oidc"><ShieldCheck size={17}/>Continuer avec {auth.providerName||'SSO'}<ArrowRight size={16}/></a>{auth.localLogin!==false&&<div className="separator">ou avec votre compte local</div>}</>}{auth.localLogin!==false&&<form onSubmit={submit}>{auth.setupRequired&&<label>Code d’installation<input name="bootstrap" type="password" required autoComplete="off" placeholder="Code fourni lors du déploiement"/></label>}<label>Identifiant<input name="username" required autoComplete="username" placeholder="Votre identifiant"/></label><label>Mot de passe<input name="password" type="password" minLength={auth.setupRequired?12:1} maxLength={256} required autoComplete={auth.setupRequired?'new-password':'current-password'} placeholder={auth.setupRequired?'12 caractères minimum':'Votre mot de passe'}/></label>{error&&<div className="alert error" role="alert">{error}</div>}<button className="button primary full" disabled={busy}>{busy?<LoaderCircle size={17} className="spin"/>:<ArrowRight size={17}/>} {auth.setupRequired?'Créer mon espace':'Se connecter'}</button></form>}<p className="login-footnote"><LockKeyhole size={14}/>Accès réservé aux administrateurs autorisés.</p></div></div>
}
function ServerForm({onSaved}:{onSaved:()=>Promise<void>}){
  const [step,setStep]=useState(0);const [script,setScript]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [copied,setCopied]=useState(false)
  useEffect(()=>{api<{script:string}>('onboarding').then(r=>setScript(r.script)).catch(e=>setError(e.message))},[])
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);const f=new FormData(e.currentTarget);try{await api('servers','POST',{...Object.fromEntries(f),port:Number(f.get('port'))});await onSaved()}catch(e){setError(e instanceof Error?e.message:'Ajout impossible.')}finally{setBusy(false)}}
  return <><div className="steps"><button className={step===0?'selected':''} onClick={()=>setStep(0)}>Préparer le serveur</button><button className={step===1?'selected':''} onClick={()=>setStep(1)}>Connexion SSH</button></div>{error&&<div className="alert error" role="alert">{error}</div>}{step===0?<><h3>Un compte réservé à Sillage.</h3><p className="form-help">Exécutez ce script sur un serveur Debian ou Ubuntu où Samba est installé. Il crée le compte <code>samba-manager</code>, sa clé et l’outil de gestion. La configuration actuelle est sauvegardée avant l’ajout du fichier d’inclusion.</p><div className="command-box"><div><span>Installation sur le serveur Samba</span><button className="icon-button" aria-label="Copier les commandes" onClick={()=>navigator.clipboard.writeText(script).then(()=>setCopied(true)).catch(()=>setError('Copie indisponible en HTTP. Sélectionnez le contenu ci-dessous.'))}>{copied?<Check size={16}/>:<Copy size={16}/>}</button></div><textarea aria-label="Commandes de préparation" readOnly value={'sudo bash <<\'SILLAGE_SETUP\'\n'+script+'\nSILLAGE_SETUP'}/></div><a className="button secondary full" download="sillage-setup.sh" href={'data:text/plain;charset=utf-8,'+encodeURIComponent(script)}><ArrowDownToLine size={16}/>Télécharger le script</a><div className="quiet-note"><ShieldCheck size={17}/><p>Le compte utilise une commande SSH imposée. Il ne dispose pas d’un terminal administrateur libre.</p></div><button className="button primary full" onClick={()=>setStep(1)}>Le serveur est prêt<ArrowRight size={16}/></button></>:<form onSubmit={submit}><label>Nom du serveur<input name="name" placeholder="NAS principal" required maxLength={80}/></label><label>Adresse IP ou nom d’hôte<input name="host" placeholder="192.168.1.10" required/></label><div className="form-row"><label>Port SSH<input name="port" type="number" min={1} max={65535} defaultValue={22} required/></label><label>Compte dédié<input name="username" defaultValue="samba-manager" required/></label></div><label>Empreinte SSH du serveur<input name="fingerprint" placeholder="SHA256:…" required/></label><p className="form-help">L’empreinte est affichée à la fin du script. Elle permet de vérifier que l’application se connecte au bon serveur.</p><button className="button primary full" disabled={busy}>{busy?<LoaderCircle size={16} className="spin"/>:<Plus size={16}/>}Ajouter le serveur</button></form>}</>
}
function Settings({config,onCopy}:{config:Config|null;onCopy:(text:string)=>void}){
  if(!config)return <div className="empty"><LoaderCircle className="spin"/>Chargement des réglages…</div>
  return <div className="simple-settings"><section className="settings-section verre"><div className="settings-status"><ShieldCheck size={23}/><div><h2>{config.providerName||'SSO'}</h2><p>Connexion réservée aux administrateurs autorisés.</p></div><span className={config.oidc?'badge green':'badge neutral'}>{config.oidc?'Actif':'À configurer'}</span></div><details className="settings-advanced"><summary>Paramètres de connexion</summary><dl className="details"><div><dt>Adresse de l’application</dt><dd>{config.origin}</dd></div><div><dt>URL de retour OIDC</dt><dd className="copy-value"><code>{config.callback}</code><button className="icon-button" aria-label="Copier l’URL de retour" onClick={()=>onCopy(config.callback)}><Copy size={15}/></button></dd></div><div><dt>Émetteur</dt><dd>{config.issuer||'Non configuré'}</dd></div></dl></details></section><details className="settings-section verre settings-key"><summary><KeyRound size={21}/><span>Clé de gestion SSH<small>Clé publique utilisée pour vos serveurs</small></span></summary><div className="command-box"><div><span>Clé publique Ed25519</span><button className="icon-button" aria-label="Copier la clé publique" onClick={()=>onCopy(config.publicKey)}><Copy size={15}/></button></div><textarea aria-label="Clé publique SSH" readOnly value={config.publicKey}/></div><p className="form-help">La clé privée reste sur le LXC. Les empreintes des serveurs sont vérifiées à chaque connexion.</p></details></div>
}
function PasswordForm(){
  const [error,setError]=useState('');const [saved,setSaved]=useState(false);const [busy,setBusy]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;const values=new FormData(form);setBusy(true);setError('');setSaved(false);try{await api('auth/password','POST',Object.fromEntries(values));form.reset();setSaved(true)}catch(e){setError(e instanceof Error?e.message:'Modification impossible.')}finally{setBusy(false)}}
  return <section className="settings-section password-section"><h2>Mot de passe du compte local</h2><p>Choisissez votre propre mot de passe. Les autres sessions locales seront fermées.</p><form onSubmit={submit}><div className="form-row"><label>Mot de passe actuel<input type="password" name="current" autoComplete="current-password" required maxLength={256}/></label><label>Nouveau mot de passe<input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={256} placeholder="12 caractères minimum"/></label></div>{error&&<div className="alert error" role="alert">{error}</div>}{saved&&<p className="success-message" role="status"><Check size={16}/>Mot de passe modifié.</p>}<button className="button primary" disabled={busy}>{busy?<LoaderCircle size={16} className="spin"/>:<KeyRound size={16}/>}Enregistrer le mot de passe</button></form></section>
}
