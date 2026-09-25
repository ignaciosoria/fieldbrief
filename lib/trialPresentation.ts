export type TrialStatus={startedAt:string|null;endsAt:string|null;ended:boolean}
export function trialMessage(trial:TrialStatus|null,now=Date.now()):string|null {
  if(!trial) return null
  if(trial.ended) return 'Your free trial has ended. Upgrade to Pro for new notes. Your saved notes and exports are still available.'
  if(!trial.startedAt) return '14 days free. No card needed. Your trial starts with your first processed note.'
  const end=Date.parse(trial.endsAt||'')
  if(!Number.isFinite(end)) return null
  const left=end-now
  if(left<=0) return 'Your free trial has ended. Your saved notes and exports are still available.'
  if(left<=3*86400000) return `Your free trial ends in ${Math.ceil(left/86400000)} ${Math.ceil(left/86400000)===1?'day':'days'}. Keep creating notes with Pro; your saved notes stay available.`
  return null
}
