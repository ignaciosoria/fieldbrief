'use client'
import {useSyncExternalStore} from 'react'
import {analyticsDisabled,setAnalyticsDisabled} from '../../lib/posthog'

function subscribe(notify:()=>void){window.addEventListener('storage',notify);window.addEventListener('folup-analytics-change',notify);return ()=>{window.removeEventListener('storage',notify);window.removeEventListener('folup-analytics-change',notify)}}
export default function AnalyticsPreference(){
  const disabled=useSyncExternalStore(subscribe,analyticsDisabled,()=>true)
  return <details className="text-xs leading-6 text-gray-600"><summary className="cursor-pointer">Analytics privacy</summary>
    <p className="mt-2 max-w-lg">We measure visits and product actions using a random browser ID for up to 30 days. This helps us understand which campaigns are useful. We do not send your notes, audio, client details or account email to analytics. Browser privacy signals are respected.</p>
    <button type="button" aria-pressed={!disabled} onClick={()=>setAnalyticsDisabled(!disabled)} className="my-2 rounded-lg border border-gray-300 px-3 py-2 text-gray-800">{disabled?'Enable usage analytics':'Disable usage analytics'}</button>
  </details>
}
