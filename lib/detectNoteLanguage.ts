import { franc } from 'franc'

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

  // Accented proper names (José, Peña) are not evidence of the note's language.
  if (countSpanishOnlyWordHits(trimmed) >= 2) return 'Spanish'

  const code = franc(trimmed, { minLength: 3 })
  if (code === 'spa') return 'Spanish'
  if (code === 'eng') return 'English'

  return 'English'
}
