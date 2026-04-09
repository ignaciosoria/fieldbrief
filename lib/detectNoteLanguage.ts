import { franc } from 'franc'

/** ISO 639-3 → English name for LLM system prompts (values must match this language). */
const ISO_639_3_ENGLISH_NAME: Record<string, string> = {
  eng: 'English',
  spa: 'Spanish',
  cat: 'Catalan',
  por: 'Portuguese',
  fra: 'French',
  deu: 'German',
  ita: 'Italian',
  nld: 'Dutch',
  pol: 'Polish',
  rus: 'Russian',
  ukr: 'Ukrainian',
  ron: 'Romanian',
  bul: 'Bulgarian',
  ell: 'Greek',
  hun: 'Hungarian',
  ces: 'Czech',
  slk: 'Slovak',
  swe: 'Swedish',
  nor: 'Norwegian',
  dan: 'Danish',
  fin: 'Finnish',
  tur: 'Turkish',
  ara: 'Arabic',
  heb: 'Hebrew',
  hin: 'Hindi',
  urd: 'Urdu',
  ben: 'Bengali',
  tam: 'Tamil',
  tel: 'Telugu',
  jpn: 'Japanese',
  kor: 'Korean',
  zho: 'Chinese',
  cmn: 'Chinese (Mandarin)',
  yue: 'Chinese (Cantonese)',
  vie: 'Vietnamese',
  tha: 'Thai',
  ind: 'Indonesian',
  msa: 'Malay',
  fil: 'Filipino',
  swa: 'Swahili',
}

/** When franc cannot decide (short text), use light heuristics before defaulting. */
function languageFromHeuristics(text: string): string | null {
  const t = text.trim()
  if (!t) return 'English'

  if (/[áéíóúüñ¿¡]/i.test(t)) return 'Spanish'

  const lower = t.toLowerCase()
  const spanishHits = (
    lower.match(
      /\b(el|la|los|las|que|qué|cual|cuál|para|por|con|está|están|como|cómo|muy|también|hoy|mañana|semana|reunión|cliente|llamar|enviar|mandar|precio)\b/g,
    ) ?? []
  ).length
  const englishHits = (
    lower.match(
      /\b(the|and|with|was|were|meeting|call|send|follow|client|price|week|today|tomorrow|about|their|they|this|that|going|need)\b/g,
    ) ?? []
  ).length

  if (spanishHits >= 2 && spanishHits > englishHits) return 'Spanish'
  if (englishHits >= 2 && englishHits > spanishHits) return 'English'
  if (spanishHits >= 1 && englishHits === 0) return 'Spanish'
  if (englishHits >= 1 && spanishHits === 0) return 'English'

  return null
}

/**
 * Best-effort spoken-language label for prompts. Uses franc, then heuristics for short/ambiguous text.
 */
export function detectNoteLanguage(note: string): string {
  const trimmed = note.trim()
  if (!trimmed) return 'English'

  const code = franc(trimmed, { minLength: 3 })
  if (code !== 'und') {
    const name = ISO_639_3_ENGLISH_NAME[code]
    if (name) return name
    return code.toUpperCase()
  }

  const fromSignals = languageFromHeuristics(trimmed)
  if (fromSignals) return fromSignals

  return 'English'
}
