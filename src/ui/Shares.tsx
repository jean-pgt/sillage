import { useState } from 'react'
import { ArrowRight, Folder, LockKeyhole, Search, Settings2 } from 'lucide-react'
import type { Host, Share } from './App'
import { isServiceShare } from './share-paths'
import { clientHost } from './client-host'

export function SharesView({servers,selected,onSelect,onDetails,onConnect}:{servers:Host[];selected:string;onSelect:(value:string)=>void;onDetails:(serverId:string,share:Share)=>void;onConnect:(server:Host,share:Share)=>void}) {
  const [search,setSearch]=useState('')
  const [showTechnical,setShowTechnical]=useState(false)
  const all=servers.filter(server=>selected==='all'||selected===server.id).flatMap(server=>(server.snapshot?.shares||[]).map(share=>({server,share})))
  const technical=all.filter(item=>isServiceShare(item.share)).length
  const visible=all.filter(({server,share})=>(showTechnical||!isServiceShare(share))&&`${share.name} ${share.path} ${server.name}`.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')))
  return <section className="shares-view" aria-label="Liste des partages">
    <div className="share-filters"><label className="search"><Search size={18}/><input type="search" aria-label="Rechercher un partage" placeholder="Rechercher un partage" value={search} onChange={event=>setSearch(event.target.value)}/></label>{servers.length>1&&<select aria-label="Filtrer par serveur" value={selected} onChange={event=>onSelect(event.target.value)}><option value="all">Tous les serveurs</option>{servers.map(server=><option key={server.id} value={server.id}>{server.name}</option>)}</select>}<span className="share-count">{visible.length} partage{visible.length>1?'s':''}</span></div>
    <div className="share-list verre">{visible.map(({server,share})=><article className="share-row" key={server.id+share.name}>
      <span className="share-folder"><Folder size={22} strokeWidth={1.7}/></span>
      <div className="share-identity"><h2>{share.name}</h2><p>{server.name}<span> · {clientHost(server)}</span></p>{share.pathExists===false?<p className="share-warning">Dossier introuvable sur le serveur</p>:server.error?<p className="share-warning">Serveur à vérifier · dernier relevé conservé</p>:null}</div>
      <span className={'share-access'+(share.readOnly||isServiceShare(share)?' share-access-important':'')}>{isServiceShare(share)?'Technique':share.readOnly?<><LockKeyhole size={13}/>Lecture seule</>:'Lecture et écriture'}</span>
      <div className="share-actions"><button className="button secondary" onClick={()=>onDetails(server.id,share)}><Settings2 size={16}/>{share.editable===false?'Configuration':'Modifier'}</button><button className="text-button share-connect" onClick={()=>onConnect(server,share)}>Se connecter<ArrowRight size={15}/></button></div>
    </article>)}{!visible.length&&<div className="empty"><Folder size={28}/><h2>{search?'Aucun partage trouvé':all.length?'Aucun partage pour ce filtre':'Aucun partage relevé'}</h2><p>{search?'Essayez un autre nom ou effacez la recherche.':all.length?'Affichez les partages techniques ci-dessous.':'Ajoutez un serveur ou actualisez son inventaire.'}</p>{search&&<button className="button secondary" onClick={()=>setSearch('')}>Effacer la recherche</button>}</div>}</div>
    {technical>0&&<label className="share-technical-toggle"><input type="checkbox" checked={showTechnical} onChange={event=>setShowTechnical(event.target.checked)}/>Afficher les partages techniques ({technical})<span>Impression et dossiers masqués</span></label>}
  </section>
}
