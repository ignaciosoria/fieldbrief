import { franc } from 'franc'

/** Distinct Spanish letters/markers rarely used in English CRM notes. */
const SPANISH_MARK_CHARS_RE = /[áéíóúüñ¿¡]/i

/**
 * Spanish-only vocabulary (not normal English). Unicode-aware boundaries so
 * accented tokens match reliably.
 */
const SPANISH_ONLY_WORDS_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${[
    'que',
    'qué',
    'para',
    'esta',
    'están',
    'también',
    'mañana',
    'reunión',
    'llamar',
    'enviar',
    'hoy',
    'semana',
    'cliente',
    'precio',
    'cómo',
    'cuál',
    'lunes',
    'martes',
    'miércoles',
    'jueves',
    'viernes',
    'próximo',
    'siguiente',
    'visité',
    'dejé',
  ].join('|')})(?![\\p{L}\\p{N}])`,
  'giu',
)

function countSpanishOnlyWordHits(text: string): number {
  return [...text.matchAll(SPANISH_ONLY_WORDS_PATTERN)].length
}

export function detectNoteLanguage(note: string): string {
  const trimmed = note.trim()
  if (!trimmed) return 'English'

  if (SPANISH_MARK_CHARS_RE.test(trimmed)) return 'Spanish'

  if (countSpanishOnlyWordHits(trimmed) >= 2) return 'Spanish'

  const code = franc(trimmed, { minLength: 3 })
  if (code === 'spa') return 'Spanish'
  if (code === 'eng') return 'English'

  return 'English'
}
