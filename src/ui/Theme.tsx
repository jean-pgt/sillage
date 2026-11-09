import { useEffect, useState } from 'react'
import { Palette } from 'lucide-react'

const backgrounds = [
  { id: 'minuit', name: 'Minuit' }, { id: 'graphite', name: 'Graphite' },
  { id: 'noir', name: 'Noir' }, { id: 'crepuscule', name: 'Crépuscule' },
] as const

export function ThemeBackdrop() {
  const [background, setBackground] = useState('minuit')
  useEffect(() => {
    const update = () => { const saved = localStorage.getItem('sillage-background'); setBackground(backgrounds.some(item => item.id === saved) ? saved! : 'minuit') }
    update(); window.addEventListener('sillage-background-change', update)
    const fine = matchMedia('(hover: hover) and (pointer: fine)').matches
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    const move = (event: PointerEvent) => {
      if (!fine || reduced || frame) return
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.lueur') : null
      if (!target) return
      const x = event.clientX, y = event.clientY
      frame = requestAnimationFrame(() => { const box = target.getBoundingClientRect(); target.style.setProperty('--mx', `${x-box.left}px`); target.style.setProperty('--my', `${y-box.top}px`); frame = 0 })
    }
    document.addEventListener('pointermove', move, { passive: true })
    return () => { window.removeEventListener('sillage-background-change', update); document.removeEventListener('pointermove', move); cancelAnimationFrame(frame) }
  }, [])
  return <div id="fond" className={'f-'+background} aria-hidden="true" />
}

export function BackgroundButton() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('minuit')
  useEffect(() => { setCurrent(localStorage.getItem('sillage-background') || 'minuit') }, [])
  useEffect(() => {
    if(!open)return
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)}
    document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close)
  },[open])
  return <div className="background-picker"><button className="icon-button" aria-label="Choisir le fond" aria-expanded={open} onClick={()=>setOpen(!open)}><Palette size={19}/></button>{open&&<div className="background-options" role="group" aria-label="Fond de l’application">{backgrounds.map(item=><button key={item.id} aria-pressed={current===item.id} onClick={()=>{localStorage.setItem('sillage-background',item.id);setCurrent(item.id);window.dispatchEvent(new Event('sillage-background-change'));setOpen(false)}}><span className={'background-swatch f-'+item.id}/>{item.name}</button>)}</div>}</div>
}
