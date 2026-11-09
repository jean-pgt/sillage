import { useId, useState } from 'react'
import { Check, Copy, Monitor, Terminal } from 'lucide-react'
import { sharePaths } from './share-paths'

const systems = [{id:'windows',label:'Windows'}, {id:'mac',label:'macOS'}, {id:'linux',label:'Linux'}] as const

export function ShareConnection({host,name,pathExists,printable}:{host:string;name:string;pathExists?:boolean;printable?:boolean}) {
  const [system,setSystem] = useState<typeof systems[number]['id']>('windows')
  const [username,setUsername] = useState('')
  const [copied,setCopied] = useState('')
  const [error,setError] = useState('')
  const id=useId()
  const paths=sharePaths(host,name,username || 'VOTRE_COMPTE_SAMBA')
  async function copy(value:string,key:string) {
    try { await navigator.clipboard.writeText(value); setCopied(key);setError('') }
    catch { setError('Sélectionnez le chemin ci-dessous pour le copier manuellement.') }
  }
  const address=system==='windows'?paths.windows:paths.smb
  return <div className="share-connection">
    {pathExists===false&&<div className="alert error" role="alert">Le dossier de ce partage est introuvable sur le serveur. La connexion peut échouer.</div>}
    {printable&&<p className="connection-hint">Ce partage sert à l’impression. Les chemins ci-dessous sont des adresses réseau, pas un volume de fichiers à monter.</p>}
    <div className="connection-systems" role="tablist" aria-label="Votre système" onKeyDown={event=>{
      if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return
      const index=systems.findIndex(item=>item.id===system)
      const next=event.key==='Home'?0:event.key==='End'?systems.length-1:(index+(event.key==='ArrowRight'?1:-1)+systems.length)%systems.length
      event.preventDefault();setSystem(systems[next].id);document.getElementById(id+'-'+systems[next].id)?.focus()
    }}>
      {systems.map(item=><button key={item.id} id={id+'-'+item.id} role="tab" aria-selected={system===item.id} aria-controls={id+'-panel'} tabIndex={system===item.id?0:-1} onClick={()=>{setSystem(item.id);setCopied('');setError('')}}>{item.label}</button>)}
    </div>
    <div role="tabpanel" id={id+'-panel'} aria-labelledby={id+'-'+system}>
      <p className="connection-instructions">{system==='windows'?'Dans l’Explorateur de fichiers, collez ce chemin dans la barre d’adresse.':system==='mac'?'Dans le Finder, choisissez Aller → Se connecter au serveur (⌘ K), puis collez cette adresse.':'Dans Fichiers ou Dolphin, ouvrez la barre d’adresse (Ctrl + L) et collez cette adresse.'}</p>
      <div className="connection-address"><Monitor size={18}/><code>{address}</code></div>
      <button className="button primary full" onClick={()=>copy(address,'path')}>{copied==='path'?<Check size={16}/>:<Copy size={16}/>} {copied==='path'?'Chemin copié':'Copier le chemin'}</button>
      <p className="connection-hint">Connectez-vous avec un compte autorisé sur ce serveur Samba. Le compte de connexion à l’application ne donne pas automatiquement accès aux fichiers.</p>
      {system==='windows'&&<details className="connection-advanced"><summary>Garder ce partage dans « Ce PC »</summary><p>Dans l’Explorateur, ouvrez « Ce PC », puis « Connecter un lecteur réseau ». Choisissez une lettre, collez le même chemin et cochez « Se reconnecter lors de la connexion ».</p></details>}
      {system==='linux'&&!printable&&<details className="connection-advanced"><summary><Terminal size={16}/>Monter dans un dossier local</summary><p>Sur Debian ou Ubuntu, installez <code>cifs-utils</code> si nécessaire : <code>sudo apt install cifs-utils</code>.</p><label>Votre compte Samba<input value={username} autoComplete="off" placeholder="VOTRE_COMPTE_SAMBA" onChange={event=>{setUsername(event.target.value);setCopied('')}}/></label>{paths.command?<><pre><code>{paths.command}</code></pre><button className="button secondary" onClick={()=>copy(paths.command!,'command')}>{copied==='command'?<Check size={15}/>:<Copy size={15}/>} {copied==='command'?'Commandes copiées':'Copier les commandes'}</button><p>Remplacez VOTRE_COMPTE_SAMBA par votre compte si le champ est vide. Le mot de passe sera demandé dans le terminal. Le montage dure jusqu’au démontage ou au redémarrage.</p></>:<p role="alert">Le compte ne doit pas contenir de virgule ni de retour à la ligne.</p>}</details>}
    </div>
    <p className="copy-feedback" role="status">{error || (copied?'Copié dans le presse-papiers.':'')}</p>
  </div>
}
