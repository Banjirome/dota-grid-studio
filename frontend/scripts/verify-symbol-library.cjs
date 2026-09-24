const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/symbolLibrary.ts'), 'utf8')
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText
const moduleExports = {}
vm.runInNewContext(compiled, {exports: moduleExports})

const font = fs.readFileSync(path.join(root, 'src/assets/fonts/radiance-semibold.otf'))
let cmapOffset = -1
for (let index = 0, count = font.readUInt16BE(4); index < count; index++) {
  const record = 12 + index * 16
  if (font.toString('ascii', record, record + 4) === 'cmap') cmapOffset = font.readUInt32BE(record + 8)
}
assert.ok(cmapOffset >= 0, 'The bundled font has no cmap table')

const tables = []
for (let index = 0, count = font.readUInt16BE(cmapOffset + 2); index < count; index++) {
  const record = cmapOffset + 4 + index * 8
  const table = cmapOffset + font.readUInt32BE(record + 4)
  if (font.readUInt16BE(table) === 4) tables.push(table)
}
assert.ok(tables.length, 'The bundled font has no Unicode BMP cmap')

function glyphId(character) {
  const codepoint = character.codePointAt(0)
  for (const table of tables) {
    const count = font.readUInt16BE(table + 6) / 2
    const ends = table + 14
    const starts = ends + count * 2 + 2
    const deltas = starts + count * 2
    const offsets = deltas + count * 2
    for (let index = 0; index < count; index++) {
      const start = font.readUInt16BE(starts + index * 2)
      const end = font.readUInt16BE(ends + index * 2)
      if (codepoint < start || codepoint > end) continue
      const delta = font.readInt16BE(deltas + index * 2)
      const rangeOffset = font.readUInt16BE(offsets + index * 2)
      if (rangeOffset === 0) return (codepoint + delta) & 0xffff
      const raw = font.readUInt16BE(offsets + index * 2 + rangeOffset + (codepoint - start) * 2)
      return raw === 0 ? 0 : (raw + delta) & 0xffff
    }
  }
  return 0
}

const symbols = moduleExports.symbolLibrary.flatMap(group => group.symbols)
assert.equal(new Set(symbols).size, symbols.length, 'The library contains duplicate symbols')
for (const symbol of symbols) {
  assert.equal([...symbol].length, 1, `Library entry ${symbol} is not one character`)
  assert.notEqual(glyphId(symbol), 0, `No Radiance glyph for ${symbol} U+${symbol.codePointAt(0).toString(16)}`)
}
for (const {symbol} of moduleExports.unverifiedLibrarySymbols) {
  assert.equal(glyphId(symbol), 0, `Excluded symbol ${symbol} now has a Radiance glyph; review it`)
}
console.log(`${symbols.length} library symbols have Radiance glyphs; excluded symbols are absent.`)
