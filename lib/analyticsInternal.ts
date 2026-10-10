/** Server only. Account addresses are compared here, never included in telemetry. */
export function isInternalAnalyticsAccount(email:unknown,configured=process.env.FOLUP_ANALYTICS_INTERNAL_EMAILS||'ignacio.isk@gmail.com'){
  return typeof email==='string'&&configured.split(',').map(v=>v.trim().toLowerCase()).includes(email.trim().toLowerCase())
}
