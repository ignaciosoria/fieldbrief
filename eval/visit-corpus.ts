/** Human-readable product expectations, NOT fabricated model responses.
 * All names and visits are synthetic. No API/audio evaluation has run on this corpus.
 */
export type ExpectedAction = {
  type: 'call' | 'send' | 'meeting' | 'other'
  contact: string | null
  company: string | null
  object: string | null
  date: string | null
  evidence: string
}
export type VisitCase = {
  id: string
  language: 'Spanish' | 'English'
  tags: string[]
  note: string
  actions: ExpectedAction[]
  crmFacts: string[]
  forbiddenClaims: string[]
  clarification: string[]
}
// Fixed reference: Thursday Sep 10, 2026, 11:00 in Los Angeles.
export const VISIT_NOW = '2026-09-10T18:00:00.000Z'
export const VISIT_ZONE = 'America/Los_Angeles'
const action = (type: ExpectedAction['type'], contact: string | null, company: string | null,
  object: string | null, date: string | null, evidence: string): ExpectedAction =>
  ({ type, contact, company, object, date, evidence })

export const VISIT_CORPUS: VisitCase[] = [
  {
    id: 'es-self-correction', language: 'Spanish', tags: ['self-correction', 'multiple-actions'],
    note: 'Eh, salí de Clínica Norte. Hablé con Juan, perdón, José. Le interesa el kit Q7. Quedé en mandarle los precios y llamarlo mañana.',
    actions: [action('send','José','Clínica Norte','los precios',null,'Quedé en mandarle los precios'), action('call','José','Clínica Norte',null,'2026-09-11','llamarlo mañana')],
    crmFacts: ['Visita a Clínica Norte con José.', 'Interés en el kit Q7.'],
    forbiddenClaims: ['Juan es el contacto confirmado.', 'El envío tiene fecha acordada.', 'Compra confirmada.'], clarification: [],
  },
  {
    id: 'en-accented-name', language: 'English', tags: ['language', 'proper-name'],
    note: 'I met José at Acme. He likes the Q7 kit. I will call José tomorrow.',
    actions: [action('call','José','Acme',null,'2026-09-11','I will call José tomorrow')],
    crmFacts: ['Met José at Acme.', 'José likes the Q7 kit.'], forbiddenClaims: ['The output language is Spanish.', 'An order was placed.'], clarification: [],
  },
  {
    id: 'es-negation', language: 'Spanish', tags: ['negation'],
    note: 'Vi a Ana en Acme. No enviar el presupuesto todavía. Quedé en llamar a Ana mañana.',
    actions: [action('call','Ana','Acme',null,'2026-09-11','Quedé en llamar a Ana mañana')],
    crmFacts: ['Visita con Ana en Acme.', 'El presupuesto no debe enviarse todavía.'], forbiddenClaims: ['Enviar el presupuesto ahora.'], clarification: [],
  },
  {
    id: 'en-negation', language: 'English', tags: ['negation'],
    note: 'Met Ana at Acme. Do not send the quote. I will call Ana tomorrow.',
    actions: [action('call','Ana','Acme',null,'2026-09-11','I will call Ana tomorrow')],
    crmFacts: ['Met Ana at Acme.', 'Do not send the quote.'], forbiddenClaims: ['Send the quote.'], clarification: [],
  },
  {
    id: 'es-two-companies', language: 'Spanish', tags: ['multiple-contacts', 'multiple-companies'],
    note: 'En la feria hablé con Ana de Acme y Luis de Beta. Le enviaré el catálogo a Ana mañana y llamaré a Luis el lunes.',
    actions: [action('send','Ana','Acme','el catálogo','2026-09-11','Le enviaré el catálogo a Ana mañana'), action('call','Luis','Beta',null,'2026-09-14','llamaré a Luis el lunes')],
    crmFacts: ['Conversaciones en la feria con Ana de Acme y Luis de Beta.'], forbiddenClaims: ['Luis pertenece a Acme.'], clarification: [],
  },
  {
    id: 'en-two-companies', language: 'English', tags: ['multiple-contacts', 'multiple-companies'],
    note: 'At the fair I met Ana from Acme and Bob from Beta. I will send Ana the catalog tomorrow and call Bob on Monday.',
    actions: [action('send','Ana','Acme','the catalog','2026-09-11','I will send Ana the catalog tomorrow'), action('call','Bob','Beta',null,'2026-09-14','call Bob on Monday')],
    crmFacts: ['Met Ana from Acme and Bob from Beta at the fair.'], forbiddenClaims: ['Bob works at Acme.'], clarification: [],
  },
  {
    id: 'es-secondary-meeting', language: 'Spanish', tags: ['secondary-meeting', 'multiple-actions'],
    note: 'Estuve con Ana de Acme. Le enviaré el catálogo hoy y quedamos en reunirnos mañana a las diez.',
    actions: [action('send','Ana','Acme','el catálogo','2026-09-10','Le enviaré el catálogo hoy'), action('meeting','Ana','Acme',null,'2026-09-11','quedamos en reunirnos mañana a las diez')],
    crmFacts: ['Visita con Ana de Acme.', 'Reunión acordada mañana a las 10:00.'], forbiddenClaims: ['La reunión ya ocurrió.'], clarification: [],
  },
  {
    id: 'en-long-product', language: 'English', tags: ['long-object', 'proper-name'],
    note: 'Met Ana at Acme. I will send Ana the complete clinical trial results from the intensive care unit in Baja California.',
    actions: [action('send','Ana','Acme','the complete clinical trial results from the intensive care unit in Baja California',null,'I will send Ana the complete clinical trial results from the intensive care unit in Baja California')],
    crmFacts: ['Met Ana at Acme.', 'Agreed to send the specified clinical trial results.'], forbiddenClaims: ['The delivery date is tomorrow.', 'A truncated document name is complete.'], clarification: [],
  },
  {
    id: 'es-no-followup', language: 'Spanish', tags: ['no-action', 'interest-only'],
    note: 'Pasé por Acme, saludé a Ana. Le gustó el kit Q7, pero no acordamos nada más.',
    actions: [], crmFacts: ['Visita con Ana en Acme.', 'Interés en el kit Q7; sin acuerdos adicionales.'], forbiddenClaims: ['Llamar la semana próxima.', 'Enviar muestras.'], clarification: [],
  },
  {
    id: 'en-customer-action', language: 'English', tags: ['no-action', 'third-party', 'past-action'],
    note: 'Met Ana at Acme. I already gave her the samples. She will send me the results on Monday. I made no further commitment.',
    actions: [], crmFacts: ['Samples already delivered to Ana at Acme.', 'Ana will send results Monday.'], forbiddenClaims: ['Rep must send samples.', 'Rep must call before Monday.'], clarification: [],
  },
  {
    id: 'es-ambiguous-date', language: 'Spanish', tags: ['ambiguous-date'],
    note: 'Hablé con Ana de Acme. Tengo que llamarla el martes o el jueves, no recuerdo cuál acordamos.',
    actions: [action('call','Ana','Acme',null,null,'Tengo que llamarla el martes o el jueves, no recuerdo cuál acordamos')],
    crmFacts: ['Conversación con Ana de Acme.', 'Llamada acordada; día pendiente de confirmar.'], forbiddenClaims: ['Martes confirmado.', 'Jueves confirmado.'], clarification: ['Confirmar el día de la llamada: martes o jueves.'],
  },
  {
    id: 'en-missing-date', language: 'English', tags: ['missing-date'],
    note: 'Met Ana at Acme. I promised to call her. We did not set a date.',
    actions: [action('call','Ana','Acme',null,null,'I promised to call her')],
    crmFacts: ['Met Ana at Acme; promised a call without an agreed date.'], forbiddenClaims: ['The call is tomorrow at 09:00.'], clarification: [],
  },
  {
    id: 'es-uncertain-person', language: 'Spanish', tags: ['ambiguous-contact'],
    note: 'Salí de Acme. Hablé con Marta o María, no entendí bien el nombre. Le prometí enviar el catálogo.',
    actions: [action('send',null,'Acme','el catálogo',null,'Le prometí enviar el catálogo')],
    crmFacts: ['Visita en Acme; nombre del contacto pendiente de confirmar.', 'Compromiso de enviar el catálogo.'], forbiddenClaims: ['Marta es el nombre confirmado.', 'María es el nombre confirmado.'], clarification: ['Confirmar el nombre del contacto.'],
  },
  {
    id: 'en-uncertain-company', language: 'English', tags: ['ambiguous-company'],
    note: 'I met Ana. Her company was Acme or Apex, I could not hear it clearly. I promised to send her the catalog.',
    actions: [action('send','Ana',null,'the catalog',null,'I promised to send her the catalog')],
    crmFacts: ['Met Ana; company name is uncertain.', 'Promised to send the catalog.'], forbiddenClaims: ['Acme is confirmed.', 'Apex is confirmed.'], clarification: ['Confirm the company name.'],
  },
  {
    id: 'es-mixed-product', language: 'Spanish', tags: ['mixed-language', 'proper-name'],
    note: 'Vi a Ana en Acme. Le interesa Quantum Flower. Quedé en enviarle el pricing sheet mañana, eso sí.',
    actions: [action('send','Ana','Acme','pricing sheet','2026-09-11','Quedé en enviarle el pricing sheet mañana')],
    crmFacts: ['Visita con Ana en Acme.', 'Interés en Quantum Flower.'], forbiddenClaims: ['Traducir la marca Quantum Flower.', 'Venta confirmada.'], clarification: [],
  },
  {
    id: 'en-date-correction', language: 'English', tags: ['self-correction', 'date-correction'],
    note: 'Met Ana at Acme. I will call her Tuesday, sorry, Thursday September 17 instead.',
    actions: [action('call','Ana','Acme',null,'2026-09-17','I will call her Tuesday, sorry, Thursday September 17 instead')],
    crmFacts: ['Met Ana at Acme; call agreed for September 17.'], forbiddenClaims: ['A separate call is scheduled Tuesday.'], clarification: [],
  },
]
