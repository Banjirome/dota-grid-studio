import {RenderSettings, defaultRenderSettings} from './rendering'

export type CommandId =
  | 'undo' | 'redo' | 'duplicate' | 'copy' | 'paste' | 'delete'
  | 'tool.select' | 'tool.symbol' | 'tool.pan'
  | `symbol.${number}`

export type Keybindings = Record<CommandId, string>

export type AppPreferences = {
  version: number
  render: RenderSettings
  keybindings: Keybindings
  palette: string[]
  recentFiles: string[]
  lastFile: string
  lastConfig: number
}

export const symbolBindings = [
  ['.', '1'], [':', '2'], ['-', '3'], ['|', '4'], ['/', '5'], ['\\', '6'], ['(', '7'], [')', '8'], ['[', '9'], [']', '0'],
  ['{', 'Shift+1'], ['}', 'Shift+2'], ['<', 'Shift+3'], ['>', 'Shift+4'], ["'", 'Shift+5'], ['"', 'Shift+6'], ['`', 'Shift+7'], ['~', 'Shift+8'],
] as const

export const defaultPalette: string[] = symbolBindings.map(([symbol]) => symbol)
export const maxPaletteItems = 256

export const editorCommandLabels: Array<{id: CommandId; label: string; group: 'Editor' | 'Tools'}> = [
  {id: 'undo', label: 'Undo', group: 'Editor'},
  {id: 'redo', label: 'Redo', group: 'Editor'},
  {id: 'duplicate', label: 'Duplicate', group: 'Editor'},
  {id: 'copy', label: 'Copy', group: 'Editor'},
  {id: 'paste', label: 'Paste', group: 'Editor'},
  {id: 'delete', label: 'Delete selection', group: 'Editor'},
  {id: 'tool.select', label: 'Select tool', group: 'Tools'},
  {id: 'tool.symbol', label: 'Symbol tool', group: 'Tools'},
  {id: 'tool.pan', label: 'Pan tool', group: 'Tools'},
]

export const defaultKeybindings: Keybindings = {
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z',
  duplicate: 'Ctrl+D',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  delete: 'Delete',
  'tool.select': 'V',
  'tool.symbol': 'T',
  'tool.pan': 'H',
  ...Object.fromEntries(symbolBindings.map(([, shortcut], index) => [`symbol.${index}`, shortcut])),
} as Keybindings

export function keybindingsForPalette(palette: readonly string[], saved: Partial<Keybindings> = {}): Keybindings {
  const result: Partial<Keybindings> = {}
  editorCommandLabels.forEach(({id}) => { result[id] = saved[id] ?? defaultKeybindings[id] })
  palette.forEach((_, index) => {
    const id = `symbol.${index}` as CommandId
    result[id] = saved[id] ?? symbolBindings[index]?.[1] ?? ''
  })
  return result as Keybindings
}

export function commandLabelsForPalette(palette: readonly string[]) {
  return [
    ...editorCommandLabels,
    ...palette.map((symbol, index) => ({id: `symbol.${index}` as CommandId, label: `Symbol  ${symbol}`, group: 'Symbols' as const})),
  ]
}

export const defaultPreferences = (): AppPreferences => ({
  version: 2,
  render: {...defaultRenderSettings},
  keybindings: {...defaultKeybindings},
  palette: [...defaultPalette],
  recentFiles: [],
  lastFile: '',
  lastConfig: 0,
})

function mainKey(event: KeyboardEvent) {
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  const names: Record<string, string> = {
    Delete: 'Delete', Backspace: 'Backspace', Escape: 'Escape', Space: 'Space',
    ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
    Enter: 'Enter', Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  }
  if (names[event.code]) return names[event.code]
  if (/^F([1-9]|1[0-2])$/.test(event.code)) return event.code
  return ''
}

export function shortcutFromEvent(event: KeyboardEvent) {
  const key = mainKey(event)
  if (!key) return ''
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string) {
  return shortcut !== '' && shortcutFromEvent(event).toLowerCase() === shortcut.toLowerCase()
}

export function mergePreferences(value: Partial<AppPreferences>): AppPreferences {
  const defaults = defaultPreferences()
  const palette = Array.isArray(value.palette)
    ? value.palette.filter(item => typeof item === 'string').map(item => item.trim()).filter((item, index, all) => item.length > 0 && all.indexOf(item) === index).slice(0, maxPaletteItems)
    : [...defaultPalette]
  const savedBindings: Partial<Keybindings> = {...(value.keybindings ?? {})}
  if ((value.version ?? 1) < 2 && savedBindings.redo === 'Ctrl+Alt+Z') savedBindings.redo = 'Ctrl+Shift+Z'
  const keybindings = keybindingsForPalette(palette, savedBindings)
  return {
    ...defaults,
    ...value,
    version: 2,
    render: {...defaults.render, ...(value.render ?? {})},
    keybindings,
    palette,
    recentFiles: Array.isArray(value.recentFiles) ? value.recentFiles.filter(item => typeof item === 'string').slice(0, 12) : [],
  }
}
