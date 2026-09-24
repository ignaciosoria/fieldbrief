/** Extractive compaction only: keep original sentences, never generate new claims. */
const normalize = (text:string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,'')
const filler = new Set(('a an the they them their he she his her it its that this those these something some ' +
  'is are was were be been being has have had do does did of from at in on with for to and but about approximately ' +
  'said says discussed mentioned indicated product producto ' +
  'el la los las un una unos unas de del al en con para por y pero que se su sus ' +
  'es son era eran esta estan ha han tiene tienen dijo dice comento menciono hablo aproximadamente').split(' '))

function terms(text:string, context:string[]):Set<string> {
  let value=normalize(text)
  for(const name of context) {
    const escaped=normalize(name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
    value=value.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,'gu'),' ')
  }
  // Limited surface equivalents, not a similarity score or general synonym model.
  value=value.replace(/\b(?:could|possible|potential)\b/g,'possible')
    .replace(/\bfirst\b/g,'before').replace(/\bacres\b/g,'acre')
  return new Set((value.match(/[\p{L}\p{N}]+/gu)||[]).filter(word=>!filler.has(word)))
}

function safeguards(text:string):string {
  const value=normalize(text)
  const guards=[
    /\b(?:not|no|never|neither|without|sin|nunca|tampoco)\b/,
    /\b(?:could|possible|potential|may|might|perhaps|posible|podria|quizas|quiza)\b/,
    /\b(?:before|first|antes|primero)\b/,
    /\b(?:after|despues|tras)\b/,
    /\b(?:if|unless|si|salvo)\b/,
    /\b(?:will|would|tomorrow|manana|futuro|future)\b/,
  ]
  return guards.map(guard=>guard.test(value)?'1':'0').join('')
}

function owner(text:string, contacts:string[], companies:string[]):string {
  const value=normalize(text)
  if (/^(?:the rep\b|the representative\b|i\b|we\b|yo\b|el representante\b)/.test(value)) return 'rep'
  // Do not merge sentences whose named subjects differ. Organizations and their
  // sole confirmed contact can share context, but never multiple clients.
  for(const name of [...contacts,...companies]) {
    if(value.startsWith(`${normalize(name)} `)) return contacts.length===1 && companies.length<=1 ? 'customer' : normalize(name)
  }
  const initial=text.match(/^([\p{Lu}][\p{L}\p{N}'’-]*)\b/u)?.[1]
  if(initial && !filler.has(normalize(initial))) return normalize(initial)
  return ''
}

/** Prefer retaining a repeat over deleting wording that might add a fact. */
export function compactCrmNarrative(summary:string, insights:string[], language:string, contacts:string[], companies:string[]):string {
  const segmenter=new Intl.Segmenter(language==='Spanish'?'es':'en',{granularity:'sentence'})
  const sentences=(text:string)=>[...segmenter.segment(text.trim())].map(part=>part.segment.trim()).filter(Boolean)
  const result=sentences(summary)
  const context=contacts.length===1 && companies.length<=1 ? [...contacts,...companies] : []
  const covers=(candidate:string, detail:string)=>{
    if(normalize(candidate)===normalize(detail)) return true
    if(safeguards(candidate)!==safeguards(detail)) return false
    // Negation scope is not inferable from keyword coverage. Retain both.
    if(/\b(?:not|no|never|neither|without|sin|nunca|tampoco)\b/.test(normalize(detail))) return false
    const quantity=/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|uno|dos|tres|cuatro|cinco)\b/
    const approximate=/\b(?:about|approximately|around|roughly|aproximadamente|unos|unas)\b/
    if(quantity.test(normalize(detail)) && approximate.test(normalize(candidate))!==approximate.test(normalize(detail))) return false
    const a=owner(candidate,contacts,companies), b=owner(detail,contacts,companies)
    if(a && b && a!==b) return false
    const available=terms(candidate,context), needed=terms(detail,context)
    // Different ordering of the same terms can reverse a relationship.
    if(available.size===needed.size && [...available].join('|')!==[...needed].join('|')) return false
    const identifiers=(text:string)=>(normalize(text).match(/\b\p{L}*\d+[\p{L}\p{N}]*\b/gu)||[]).join('|')
    if(identifiers(detail) && identifiers(candidate)!==identifiers(detail)) return false
    return needed.size>=3 && [...needed].every(term=>available.has(term))
  }
  for(const line of insights) for(const detail of sentences(line)) {
    if(result.some(sentence=>covers(sentence,detail))) continue
    // A fuller original insight can replace a shorter sentence, in place. This
    // retains insight-only conditions instead of blindly hiding all insights.
    const index=result.findIndex(sentence=>covers(detail,sentence))
    if(index>=0) result[index]=detail
    else result.push(detail)
  }
  return result.map((sentence,index)=>index<result.length-1 && !/[.!?…]$/.test(sentence)?`${sentence}.`:sentence).join(' ')
}
