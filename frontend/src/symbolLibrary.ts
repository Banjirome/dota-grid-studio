// Every character below has a non-zero glyph in the bundled Radiance SemiBold
// font (the same file shipped with Dota 2). Keep this list conservative: a
// browser fallback font can make an unsupported character look deceptively OK.
export const symbolLibrary: Array<{group: string; symbols: string[]}> = [
  {group: 'Dots & marks', symbols: ['•', '…', '.', ':', ';', ',', '!', '?', '¡', '¿', '‰']},
  {group: 'Lines & brackets', symbols: ['-', '−', '_', '—', '–', '―', '|', '/', '\\', '(', ')', '[', ']', '{', '}', '<', '>', '«', '»', '‹', '›']},
  {group: 'Ornaments', symbols: ['◊', '*', '+', '×', '÷', '~', '^', '†', '‡', '§', '¶', '¤', '©', '®', '™', '℗', '№']},
  {group: 'Math & currency', symbols: ['=', '±', '≈', '≠', '≤', '≥', '∞', '√', '∂', '∆', '∏', '∑', '∫', '$', '€', '£', '¥', '¢']},
  {group: 'Decorative letterforms', symbols: ['Ω', 'Ψ', 'Φ', 'Δ', 'Λ', 'Σ', 'Θ', 'Ξ', 'Π', 'Γ', 'Ж', 'Ю', 'Я', 'Ф', 'Э']},
]

export const unverifiedLibrarySymbols = [
  {symbol: '♥', description: 'Filled heart'},
  {symbol: '♡', description: 'Outline heart'},
  {symbol: '❤', description: 'Heavy heart'},
  {symbol: '★', description: 'Star'},
  {symbol: '☆', description: 'Outline star'},
  {symbol: '♪', description: 'Music note'},
  {symbol: 'あ', description: 'Japanese hiragana'},
  {symbol: 'ア', description: 'Japanese katakana'},
] as const
