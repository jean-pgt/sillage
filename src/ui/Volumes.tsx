import { useState, type ReactNode } from 'react'
import { Folder, HardDrive, Layers3, Server, Settings2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { formatBytes, type Mount, type StorageInventory } from './Storage'
import { groupMounts, mountCategory } from './mount-groups'

type Share={name:string;mountTarget?:string|null}
type Host={id:string;name:string;host:string;checked:string|null;error:string|null;snapshot:{storage?:StorageInventory;shares?:Share[]}|null}
type Device=StorageInventory['devices'][number]
const tabs=[{id:'volumes',label:'Mes volumes',icon:Layers3},{id:'devices',label:'Disques physiques',icon:HardDrive}] as const
const healthLabel=(health:string)=>({ONLINE:'En ligne',DEGRADED:'Dégradé',FAULTED:'En panne',OFFLINE:'Hors ligne',UNAVAIL:'Indisponible'}[health]||health)

export function StorageView({hosts,servers,selected,onSelect}:{hosts:Host[];servers:Host[];selected:string;onSelect:(value:string)=>void}){
  const [tab,setTab]=useState<'volumes'|'devices'>('volumes')
  return <section className="storage-view"><div className="storage-toolbar"><div className="storage-tabs menus" role="tablist" aria-label="Vue du stockage" onKeyDown={event=>{
    if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return
    const index=tabs.findIndex(item=>item.id===tab);const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length
    event.preventDefault();setTab(tabs[next].id);document.getElementById('storage-tab-'+tabs[next].id)?.focus()
  }}>{tabs.map(item=><button key={item.id} role="tab" tabIndex={tab===item.id?0:-1} aria-selected={tab===item.id} aria-controls="storage-content" id={'storage-tab-'+item.id} onClick={()=>setTab(item.id)}><item.icon size={17}/>{item.label}</button>)}</div>{servers.length>1&&<select aria-label="Filtrer le stockage par serveur" value={selected} onChange={event=>onSelect(event.target.value)}><option value="all">Tous les serveurs</option>{servers.map(server=><option key={server.id} value={server.id}>{server.name}</option>)}</select>}</div>
  <div id="storage-content" role="tabpanel" aria-labelledby={'storage-tab-'+tab}>{!hosts.length&&<div className="empty verre"><HardDrive/><h3>Aucun serveur ajouté</h3><p>Connectez un serveur pour découvrir son stockage.</p></div>}{hosts.map(host=>{
    const storage=host.snapshot?.storage
    return <section key={host.id} className="storage-host"><div className="section-heading storage-server-heading"><h2><Server size={18}/>{host.name}<span className="storage-host-ip">{host.host}</span></h2><small>{host.checked?'Relevé le '+new Date(host.checked).toLocaleString('fr-FR'):'Inventaire à actualiser'}</small></div>{host.error&&<div className="alert error" role="alert"><TriangleAlert size={17}/>Serveur injoignable. Les valeurs affichées datent du dernier relevé.</div>}{!storage?<div className="empty verre"><HardDrive/><h3>Le stockage n’a pas encore été relevé.</h3><p>Actualisez le serveur pour afficher ses volumes.</p></div>:<>{storage.warnings.map(warning=><div key={warning} className="alert error" role="alert"><TriangleAlert size={17}/>{warning}</div>)}{tab==='volumes'?<><VolumeCards storage={storage}/><p className="storage-footnote"><ShieldCheck size={15}/>Chaque volume est présenté séparément. L’espace partagé entre dossiers ZFS n’est jamais additionné.</p><AdvancedMounts storage={storage} shares={host.snapshot?.shares||[]}/></>:<PhysicalDisks storage={storage}/>}</>}</section>
  })}</div></section>
}

function VolumeCard({name,kind,status,healthy,total,used,available,path,children}:{name:string;kind:string;status:string;healthy:boolean;total:number|null;used:number|null;available:number|null;path?:string;children?:ReactNode}){
  const ratio=used!==null&&total!==null&&total>0?Math.min(100,Math.max(0,Math.round(used/total*100))):null
  return <article className="volume-card verre lueur"><div className="volume-heading"><span className="volume-icon ic"><HardDrive size={23}/></span><div><h3>{name}</h3><p>{kind}</p></div><span className={healthy?'badge green':'badge neutral'}><span className={healthy?'dot ok':'dot attente'}/>{status}</span></div><dl className="volume-numbers"><div><dt>Capacité totale</dt><dd>{formatBytes(total)}</dd></div><div><dt>Utilisé</dt><dd>{formatBytes(used)}</dd></div><div className="volume-available"><dt>Disponible</dt><dd>{formatBytes(available)}</dd></div></dl>{ratio!==null&&<div className="volume-usage"><div className="piste"><i className={ratio>=90?'critique':ratio>=80?'haut':''} style={{width:ratio+'%'}}/></div><span>{ratio} % utilisé</span></div>}{path&&<p className="volume-path"><Folder size={14}/>{path}</p>}{children}</article>
}

function VolumeCards({storage}:{storage:StorageInventory}){
  const other=storage.mounts.filter(mount=>['local','network'].includes(mountCategory(mount,storage.arrays)))
  return <div className="volume-grid">{storage.arrays.map(array=>{
    const mount=storage.mounts.find(item=>item.source.split('[')[0]===array.path);const healthy=array.degraded==='0'
    return <VolumeCard key={array.path} name={mount?.target.split('/').filter(Boolean).at(-1)||array.path} kind={array.level.toUpperCase()+' · '+array.members.length+' disques'} status={!mount?'Non monté':healthy?'En ligne':array.degraded===null?'État à vérifier':'Dégradé'} healthy={healthy&&Boolean(mount)} total={mount?.total??array.size} used={mount?.used??null} available={mount?.available??null} path={mount?.target}><details className="volume-details"><summary>Détails du RAID</summary><div className="volume-detail-content"><p><strong>Périphérique :</strong> {array.path}</p><p><strong>Disques :</strong> {array.members.join(', ')||'Non identifiés'}</p><p><strong>État :</strong> {array.state||'Non communiqué'}</p>{mount?.reserved?<p><strong>Espace réservé :</strong> {formatBytes(mount.reserved)}</p>:null}</div></details></VolumeCard>
  })}{storage.pools.map(pool=>{
    const mount=storage.mounts.find(item=>item.source===pool.name&&item.fstype==='zfs')
    const folders=storage.mounts.filter(item=>item.pool===pool.name&&item.source!==pool.name&&!['system','technical'].includes(mountCategory(item)))
    return <VolumeCard key={pool.name} name={pool.name} kind="Pool ZFS" status={healthLabel(pool.health)} healthy={pool.health==='ONLINE'} total={pool.size} used={pool.allocated} available={pool.available} path={mount?.target}><details className="volume-details"><summary>{folders.length?'Dossiers de ce volume ('+folders.length+')':'Détails du volume'}</summary><div className="volume-detail-content"><p>Ces dossiers utilisent le même pool. Leur espace disponible est partagé.</p>{folders.map(folder=><div className="volume-folder" key={folder.target}><Folder size={15}/><div><strong>{folder.source.split('/').slice(1).join('/')}</strong><small>{folder.target}</small></div><span>{formatBytes(storage.datasets.find(dataset=>dataset.name===folder.source)?.used??folder.used)} utilisés</span></div>)}<p className="volume-reserve">Libre brut : {formatBytes(pool.freeRaw)}. Les réserves et contraintes ZFS expliquent l’écart avec le disponible.</p></div></details></VolumeCard>
  })}{other.map(mount=><VolumeCard key={mount.target+mount.source} name={mount.target.split('/').filter(Boolean).at(-1)||mount.target} kind={mountCategory(mount)==='network'?'Volume réseau':'Volume de données'} status={mount.readOnly?'Lecture seule':'Monté'} healthy total={mount.total} used={mount.used} available={mount.available} path={mount.target}><details className="volume-details"><summary>Détails du volume</summary><div className="volume-detail-content"><p>Source : {mount.source}</p><p>Système de fichiers : {mount.fstype}</p></div></details></VolumeCard>)}{!storage.arrays.length&&!storage.pools.length&&!other.length&&<div className="empty verre"><HardDrive/><h3>Aucun volume de données détecté.</h3><p>Les montages système restent accessibles dans les informations avancées.</p></div>}</div>
}

function AdvancedMounts({storage,shares}:{storage:StorageInventory;shares:Share[]}){
  const [showLinux,setShowLinux]=useState(false)
  const linuxCount=storage.mounts.filter(mount=>['system','technical'].includes(mountCategory(mount,storage.arrays))).length
  const mounts=storage.mounts.filter(mount=>showLinux||!['system','technical'].includes(mountCategory(mount,storage.arrays)))
  return <details className="advanced-storage"><summary><Settings2 size={18}/><span>Informations avancées<small>Points de montage, sources et détails Linux</small></span></summary><div className="advanced-content"><label className="technical-toggle"><input type="checkbox" checked={showLinux} onChange={event=>setShowLinux(event.target.checked)}/>Afficher les montages Linux et techniques ({linuxCount})</label><p className="advanced-note">Les capacités d’un dataset décrivent ce dossier, pas le disque entier. Pour la capacité totale, utilisez les volumes ci-dessus. Unités décimales : 1 To = 1 000 Go.</p>{groupMounts(mounts,storage.arrays).map(group=><details className="mount-group" key={group.id} open={group.id!=='system'&&group.id!=='technical'} data-category={group.id}><summary><span><strong>{group.title}</strong><small>{group.description}</small></span><span className="mount-group-count">{group.mounts.length}</span></summary><MountTable mounts={group.mounts} shares={shares}/></details>)}{!mounts.length&&<p className="form-help">Aucun montage pour ce filtre.</p>}</div></details>
}

function MountTable({mounts,shares}:{mounts:Mount[];shares:Share[]}){
  return <div className="table-panel verre"><div className="table-scroll"><table className="mount-table"><thead><tr><th>Point de montage</th><th>Type</th><th>Capacité vue du dossier</th><th>Utilisé</th><th>Disponible</th><th>Partages</th></tr></thead><tbody>{mounts.map((mount,index)=>{
    const linked=shares.filter(share=>share.mountTarget===mount.target)
    return <tr key={mount.target+mount.source+index}><td><strong>{mount.target}</strong><small className="storage-source">{mount.source}</small></td><td>{mount.fstype}{mount.readOnly&&<small className="storage-source">Lecture seule</small>}</td><td>{formatBytes(mount.total)}</td><td>{formatBytes(mount.used)}</td><td>{formatBytes(mount.available)}{mount.pool&&<small className="storage-source">Partagé · {mount.pool}</small>}</td><td>{linked.length?linked.map(share=>share.name).join(', '):'—'}</td></tr>
  })}</tbody></table></div></div>
}

function PhysicalDisks({storage}:{storage:StorageInventory}){
  function descendants(path:string,seen=new Set<string>()):Device[]{if(seen.has(path))return [];seen.add(path);const device=storage.devices.find(item=>item.path===path);return device?[device,...device.children.flatMap(child=>descendants(child,seen))]:[]}
  const disks=storage.devices.filter(device=>device.type==='disk')
  return <><p className="storage-device-note">Chaque disque apparaît une seule fois. Les membres d’un RAID ou d’un pool ne sont pas montés individuellement.</p><div className="table-panel verre"><div className="table-scroll"><table><thead><tr><th>Disque</th><th>Modèle</th><th>Capacité brute</th><th>Utilisation</th></tr></thead><tbody>{disks.map(device=>{
    const tree=descendants(device.path);const raids=tree.filter(item=>item.type.startsWith('raid'));const zfs=tree.some(item=>item.fstype==='zfs_member');const paths=[...new Set(tree.flatMap(item=>item.mountpoints))]
    return <tr key={device.path}><td><span className="group-cell"><HardDrive size={17}/><strong>{device.path}</strong></span></td><td>{device.model||'Non communiqué'}</td><td>{formatBytes(device.size)}</td><td>{raids.length?raids.map(raid=>raid.type.toUpperCase()+' · '+raid.path).join(', '):zfs?'Membre d’un pool ZFS':paths.length?paths.every(path=>path==='/'||path.startsWith('/boot'))?'Système Linux':paths.join(', '):'Usage non identifié'}</td></tr>
  })}</tbody></table></div>{!disks.length&&<div className="empty"><HardDrive/><h3>Aucun disque physique détecté.</h3><p>Certains volumes distants ou conteneurs n’exposent pas les disques du serveur.</p></div>}</div></>
}
