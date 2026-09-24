/** Decorative, conservative categories. They never add or change the insight's text. */
export function insightPresentation(line:string):{text:string;icon:string} {
  const text=line.replace(/^(?:\s*[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D])+\s*/u,'').trim()
  const normalized=text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  const icon=/\b(?:confirmo|confirmed)\b.{0,60}\b(?:vio|recibio|saw|received|reviewed)\b/.test(normalized)?'✅':
    /\b(?:competidor|competencia|competitor|competition|cheaper|mas barato)\b/.test(normalized)?'⚖️':
    /\b(?:credito|credit|precio|price|pricing|presupuesto|quote|cotizacion|pago|payment|cost|coste|costo)\b/.test(normalized)?'💰':
    /\b(?:problema|problem|riesgo|risk|damage|dano|queja|complaint|retraso|delay|amarillo|yellow|acaros|mites)\b/.test(normalized)?'⚠️':
    /\b(?:pedido|order|stock|inventario|inventory|entrega|delivery|galones|gallons)\b/.test(normalized)?'📦':
    /\b(?:enviar|envie|envio|enviada|enviado|send|sent|reenviar|forward|pase|pasar|mandar|mande|oferta|offer|ficha|programa|program|document|documento|report|informe)\b/.test(normalized)?'📄':
    /\b(?:aplicacion|application|cultivo|crop|fruta|fruit|cuajado|follaje|foliage|dosis|dose|floracion|bloom)\b/.test(normalized)?'🌱':
    /\b(?:confirmo|confirmed|aprobado|approved|acordado|agreed)\b/.test(normalized)?'✅':'📌'
  return {text,icon}
}
