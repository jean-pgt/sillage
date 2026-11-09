import { useId } from 'react'
// Sillage mark: a boat (the dot) leaving an S-shaped wake that fades behind it. Inherits the text colour.
export function SillageMark({size=24,strokeWidth=1.9}:{size?:number;strokeWidth?:number}) {
  const id=useId()
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <defs><linearGradient id={id} gradientUnits="userSpaceOnUse" x1="17" y1="5" x2="6" y2="20"><stop offset="0" stopColor="currentColor"/><stop offset="1" stopColor="currentColor" stopOpacity=".3"/></linearGradient></defs>
    <path d="M16.4 7.1C15.1 5.6 13.6 4.6 11.8 4.6c-2.8 0-4.7 1.5-4.7 3.5 0 4.6 9.7 3.4 9.7 8 0 2.2-2.1 3.6-5 3.6-2 0-3.9-.8-5.2-2.3" stroke={`url(#${id})`} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <circle cx="18" cy="5.4" r="1.75" fill="currentColor"/>
  </svg>
}
