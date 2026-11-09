import { useMemo, useState } from 'react'
import { ArrowDownToLine, Check, Folder } from 'lucide-react'
import type { Host } from './App'
import { isServiceShare } from './share-paths'
import { clientHost } from './client-host'
import { mountScript, slug, type MountSystem } from './mount-script'

const systems = [{id:'windows',label:'Windows'},{id:'mac',label:'macOS'},{id:'linux',label:'Linux'}] as const
const LETTERS = 'ZYXWVUTSRQPONMLKJIHGFED'.split('')

function guessSystem(): MountSystem {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return /Mac OS X|Macintosh/.test(agent) && !/iPhone|iPad/.test(agent) ? 'mac' : /Linux/.test(agent) && !/Android/.test(agent) ? 'linux' : 'windows'
}

export function MountScripts({servers}:{servers:Host[]}) {
  const [system,setSystem] = useState<MountSystem>(guessSystem)
  const [username,setUsername] = useState('')
  const [chosen,setChosen] = useState<Record<string,string>>({})
  const [error,setError] = useState('')
  const [done,setDone] = useState('')
  const shares = useMemo(()=>servers.flatMap(server=>(server.snapshot?.shares||[]).filter(share=>!isServiceShare(share)).map(share=>({key:server.id+'/'+share.name,server,share}))),[servers])
  const used = new Set(Object.values(chosen))
  function toggle(key:string) {
    setDone('');setError('')
    setChosen(current=>{const next={...current};if(key in next)delete next[key];else next[key]=LETTERS.find(letter=>!Object.values(current).includes(letter))||'';return next})
  }
  function download() {
    try {
      const items = shares.filter(item=>item.key in chosen).map(item=>({host:clientHost(item.server),share:item.share.name,letter:chosen[item.key],folder:'/mnt/'+slug(item.share.name)}))
      const script = mountScript(system,items,username)
      // PowerShell 5.1 a besoin du BOM UTF-8 pour lire correctement les accents.
      const blob = new Blob([system==='windows'?'﻿':'',script.content],{type:'text/plain;charset=utf-8'})
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = script.filename
      document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(link.href),1000)
      setError(''); setDone(script.filename)
    } catch (e) { setDone(''); setError(e instanceof Error?e.message:'Script impossible à préparer.') }
  }
  const count = Object.keys(chosen).length
  return <div className="mount-scripts">
    <p className="connection-hint">Cochez les partages à retrouver sur votre ordinateur. Le script les monte seulement quand le serveur répond (réseau local ou VPN) et les retire sinon : l’explorateur de fichiers ne se fige plus hors de la maison.</p>
    <div className="connection-systems" role="tablist" aria-label="Système de l’ordinateur">
      {systems.map(item=><button key={item.id} role="tab" aria-selected={system===item.id} onClick={()=>{setSystem(item.id);setDone('');setError('')}}>{item.label}</button>)}
    </div>
    <div className="mount-list" role="group" aria-label="Partages à monter">
      {shares.map(({key,server,share})=><div className={'mount-item'+(key in chosen?' selected':'')} key={key}>
        <label className="mount-check"><input type="checkbox" checked={key in chosen} onChange={()=>toggle(key)}/><Folder size={18} strokeWidth={1.7}/><span><strong>{share.name}</strong><small>{server.name} · {clientHost(server)}</small></span></label>
        {key in chosen&&(system==='windows'
          ?<select aria-label={'Lettre de lecteur pour '+share.name} value={chosen[key]} onChange={event=>{setDone('');setChosen(current=>({...current,[key]:event.target.value}))}}>{LETTERS.slice().reverse().map(letter=><option key={letter} value={letter} disabled={used.has(letter)&&chosen[key]!==letter}>{letter}:</option>)}</select>
          :<code className="mount-target">{system==='mac'?'/Volumes/'+share.name:'/mnt/'+slug(share.name)}</code>)}
      </div>)}
      {!shares.length&&<p className="connection-hint">Aucun partage relevé. Actualisez l’inventaire d’un serveur.</p>}
    </div>
    <label className="mount-account">Votre compte Samba <small>facultatif, demandé sinon</small><input value={username} autoComplete="off" placeholder="ex. marie" onChange={event=>{setUsername(event.target.value);setDone('')}}/></label>
    <button className="button primary full" disabled={!count} onClick={download}>{done?<Check size={16}/>:<ArrowDownToLine size={16}/>}{done?'Script téléchargé':count?`Télécharger le script (${count} partage${count>1?'s':''})`:'Cochez au moins un partage'}</button>
    {error&&<p className="alert error" role="alert">{error}</p>}
    <details className="connection-advanced" open={Boolean(done)}><summary>Lancer le script</summary>
      {system==='windows'&&<p>Clic droit sur <code>sillage-partages.ps1</code> → « Exécuter avec PowerShell ». Le mot de passe est demandé une fois puis gardé par Windows. Pour tout retirer : <code>powershell -ExecutionPolicy Bypass -File .\sillage-partages.ps1 -Desinstaller</code>.</p>}
      {system==='mac'&&<p>Dans Terminal : <code>bash ~/Downloads/sillage-partages-mac.sh</code>. Au premier montage, cochez « Mémoriser ce mot de passe dans mon trousseau ». Pour tout retirer : ajoutez <code>--desinstaller</code>.</p>}
      {system==='linux'&&<p>Dans un terminal : <code>sudo bash ~/Téléchargements/sillage-partages-linux.sh</code>. Le mot de passe est rangé dans <code>/etc/sillage</code>, lisible par root seulement. Pour tout retirer : ajoutez <code>--desinstaller</code>.</p>}
      <p>Le script ne contient aucun mot de passe. L’adresse utilisée pour chaque serveur se règle dans Serveurs → « Adresse pour les postes ».</p>
    </details>
  </div>
}
