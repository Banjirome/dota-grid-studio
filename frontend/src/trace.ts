import * as ort from 'onnxruntime-web'
import wasmUrl from './assets/ort-wasm-simd-threaded.wasm?url'
import wasmModuleUrl from './assets/ort-wasm-simd-threaded.mjs?url'
import modelUrl from './assets/anime-lineart.onnx?url'

/**
 * Image → symbol tracing.
 *
 * Turns a raster image into a sparse set of symbols (`.`, `:`, `-`, `|`, `/`, `\`, `(`, `)`)
 * placed along the detected contours, mimicking hand-made Dota hero-grid ASCII art.
 *
 * Pipeline: grayscale → gaussian blur → Sobel → non-maximum suppression → hysteresis threshold
 * → strength-ranked spatial sampling → pick a glyph from the local contour direction
 * → optional dot shading of dark (or light) areas.
 *
 * All coordinates returned by `traceImage` are in pixels of the prepared (downscaled) image.
 */

export type TraceSettings = {
  /** Distance between neighbouring symbols, in Dota units. */
  spacing: number
  /** 0..100 — how faint an edge may be to still be traced. */
  sensitivity: number
  /** 0..100 — how many dots to sprinkle over dark (or light) areas without edges. */
  shading: number
  /** Shade light areas instead of dark ones. */
  invertShading: boolean
  /** Per-symbol multiplier, 1 = neutral, 0 = never use. Missing symbols count as 1. */
  weights: Partial<Record<TraceSymbol, number>>
}

export const TRACE_SYMBOLS = ['.', ':', '-', '|', '/', '\\', '(', ')'] as const
export type TraceSymbol = typeof TRACE_SYMBOLS[number]

export const defaultTraceSettings: TraceSettings = {
  spacing: 8,
  sensitivity: 38,
  shading: 0,
  invertShading: false,
  weights: {},
}

export type TracedSymbol = {x: number; y: number; symbol: string}

export type PreparedImage = {
  width: number
  height: number
  /** Blurred luminance, 0..255. */
  gray: Float32Array
  /** Thinned edge strength, normalised so that the 98th percentile of edge pixels is 1. */
  edges: Float32Array
  /** Tangent direction of the detected contour, in radians. */
  tangent: Float32Array
}


const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

let lineArtSession: Promise<ort.InferenceSession> | null = null

async function extractSemanticLineArt(image: HTMLImageElement, width: number, height: number) {
  if (!lineArtSession) {
    ort.env.wasm.numThreads = 1
    ort.env.wasm.wasmPaths = {wasm: wasmUrl, mjs: wasmModuleUrl}
    lineArtSession = ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
  }
  const session = await lineArtSession
  const inputSize = 512
  const canvas = window.document.createElement('canvas')
  canvas.width = inputSize
  canvas.height = inputSize
  const ctx = canvas.getContext('2d', {willReadFrequently: true})!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, inputSize, inputSize)
  const pixels = ctx.getImageData(0, 0, inputSize, inputSize).data
  const plane = inputSize * inputSize
  const input = new Float32Array(plane * 3)
  for (let index = 0; index < plane; index++) {
    input[index] = pixels[index * 4]
    input[plane + index] = pixels[index * 4 + 1]
    input[plane * 2 + index] = pixels[index * 4 + 2]
  }
  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]
  const result = await session.run({[inputName]: new ort.Tensor('float32', input, [1, 3, inputSize, inputSize])})
  const output = result[outputName].data as Float32Array
  const linePixels = ctx.createImageData(inputSize, inputSize)
  for (let index = 0; index < plane; index++) {
    const value = Math.round(clamp(output[index] * 255, 0, 255))
    const offset = index * 4
    linePixels.data[offset] = value
    linePixels.data[offset + 1] = value
    linePixels.data[offset + 2] = value
    linePixels.data[offset + 3] = 255
  }
  ctx.putImageData(linePixels, 0, 0)
  const resized = window.document.createElement('canvas')
  resized.width = width
  resized.height = height
  const resizedCtx = resized.getContext('2d', {willReadFrequently: true})!
  resizedCtx.imageSmoothingEnabled = true
  resizedCtx.imageSmoothingQuality = 'high'
  resizedCtx.drawImage(canvas, 0, 0, width, height)
  const data = resizedCtx.getImageData(0, 0, width, height).data
  const gray = new Float32Array(width * height)
  for (let index = 0; index < gray.length; index++) gray[index] = data[index * 4]
  return gray
}

export async function prepareImage(image: HTMLImageElement, maxSize = 1200): Promise<PreparedImage> {
  const naturalWidth = Math.max(1, image.naturalWidth || image.width)
  const naturalHeight = Math.max(1, image.naturalHeight || image.height)
  const downscale = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight))
  const width = Math.max(1, Math.round(naturalWidth * downscale))
  const height = Math.max(1, Math.round(naturalHeight * downscale))

  const rawLineArt = await extractSemanticLineArt(image, width, height)
  const gray = blur5(rawLineArt, width, height)
  // The model already outputs semantic ink. Edge detection here would outline both banks of that
  // ink again, so reduce it to a one-pixel centreline instead.
  const skeleton = skeletoniseLineArt(gray, width, height)
  const edges = skeleton.edges
  const tangent = skeleton.tangent
  const borderMargin = Math.max(4, Math.round(Math.min(width, height) * .025))
  for (let index = 0; index < edges.length; index++) {
    const x = index % width
    const y = (index - x) / width
    // A frame around a reference is almost never part of the artwork and otherwise becomes
    // four extremely prominent generated lines.
    if (x < borderMargin || y < borderMargin || x >= width - borderMargin || y >= height - borderMargin) edges[index] = 0
  }
  return {width, height, gray, edges, tangent}
}

function skeletoniseLineArt(gray: Float32Array, width: number, height: number) {
  const binary = new Uint8Array(gray.length)
  const strength = new Float32Array(gray.length)
  for (let index = 0; index < gray.length; index++) {
    const darkness = 1 - gray[index] / 255
    strength[index] = darkness
    if (darkness >= .1) binary[index] = 1
  }
  const remove = new Uint8Array(binary.length)
  const neighbours = (index: number) => [
    binary[index - width], binary[index - width + 1], binary[index + 1], binary[index + width + 1],
    binary[index + width], binary[index + width - 1], binary[index - 1], binary[index - width - 1],
  ]
  // Zhang-Suen thinning preserves topology while reducing soft model strokes to their centreline.
  for (let iteration = 0; iteration < 80; iteration++) {
    let changed = false
    for (let pass = 0; pass < 2; pass++) {
      remove.fill(0)
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const index = y * width + x
        if (!binary[index]) continue
        const p = neighbours(index)
        const count = p.reduce((sum, value) => sum + value, 0)
        if (count < 2 || count > 6) continue
        let transitions = 0
        for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) & 7]) transitions++
        if (transitions !== 1) continue
        const first = pass === 0 ? p[0] * p[2] * p[4] : p[0] * p[2] * p[6]
        const second = pass === 0 ? p[2] * p[4] * p[6] : p[0] * p[4] * p[6]
        if (!first && !second) remove[index] = 1
      }
      for (let index = 0; index < binary.length; index++) if (remove[index]) { binary[index] = 0; changed = true }
    }
    if (!changed) break
  }

  const edges = new Float32Array(gray.length)
  const tangent = new Float32Array(gray.length)
  for (let y = 4; y < height - 4; y++) for (let x = 4; x < width - 4; x++) {
    const index = y * width + x
    if (!binary[index]) continue
    edges[index] = Math.max(.01, strength[index])
    let xx = 0, xy = 0, yy = 0
    for (let oy = -4; oy <= 4; oy++) for (let ox = -4; ox <= 4; ox++) {
      if (!binary[(y + oy) * width + x + ox] || (!ox && !oy)) continue
      const weight = 1 / Math.max(1, Math.hypot(ox, oy))
      xx += ox * ox * weight; xy += ox * oy * weight; yy += oy * oy * weight
    }
    tangent[index] = .5 * Math.atan2(2 * xy, xx - yy)
  }
  return {edges, tangent}
}

/** Separable [1 4 6 4 1] blur, roughly gaussian with sigma ≈ 1. */
function blur5(source: Float32Array, width: number, height: number) {
  const kernel = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]
  const horizontal = new Float32Array(source.length)
  const result = new Float32Array(source.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let k = -2; k <= 2; k++) sum += source[row + clamp(x + k, 0, width - 1)] * kernel[k + 2]
      horizontal[row + x] = sum
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let k = -2; k <= 2; k++) sum += horizontal[clamp(y + k, 0, height - 1) * width + x] * kernel[k + 2]
      result[y * width + x] = sum
    }
  }
  return result
}

/** Sobel magnitude followed by non-maximum suppression along the gradient direction. */
function thinnedEdges(gray: Float32Array, width: number, height: number) {
  const size = width * height
  const gx = new Float32Array(size)
  const gy = new Float32Array(size)
  const magnitude = new Float32Array(size)
  const at = (x: number, y: number) => gray[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)]
  let maxMagnitude = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1)
      const l = at(x - 1, y), r = at(x + 1, y)
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1)
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl)
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr)
      const index = y * width + x
      gx[index] = dx
      gy[index] = dy
      const m = Math.hypot(dx, dy)
      magnitude[index] = m
      if (m > maxMagnitude) maxMagnitude = m
    }
  }

  const thinned = new Float32Array(size)
  const tangent = new Float32Array(size)
  if (maxMagnitude <= 0) return {edges: thinned, tangent}
  const histogram = new Uint32Array(256)
  let edgePixels = 0
  const tan22 = Math.tan(Math.PI / 8)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x
      const m = magnitude[index]
      if (m <= 0) continue
      const dx = gx[index], dy = gy[index]
      const ax = Math.abs(dx), ay = Math.abs(dy)
      let m1: number, m2: number
      if (ay <= tan22 * ax) { m1 = magnitude[index - 1]; m2 = magnitude[index + 1] }
      else if (ax <= tan22 * ay) { m1 = magnitude[index - width]; m2 = magnitude[index + width] }
      else if (dx * dy > 0) { m1 = magnitude[index - width - 1]; m2 = magnitude[index + width + 1] }
      else { m1 = magnitude[index - width + 1]; m2 = magnitude[index + width - 1] }
      if (m >= m1 && m >= m2) {
        thinned[index] = m
        tangent[index] = Math.atan2(dy, dx) + Math.PI / 2
        histogram[Math.min(255, Math.floor(m / maxMagnitude * 255))]++
        edgePixels++
      }
    }
  }

  // Normalise so that the strongest ~2% of edge pixels map to >= 1. This makes the sensitivity
  // slider behave the same for low-contrast sketches and saturated illustrations.
  let accumulated = 0
  let percentileBin = 255
  const target = edgePixels * .98
  for (let bin = 0; bin < 256; bin++) {
    accumulated += histogram[bin]
    if (accumulated >= target) { percentileBin = bin; break }
  }
  const reference = Math.max(1e-6, (percentileBin + 1) / 256 * maxMagnitude)
  for (let index = 0; index < size; index++) thinned[index] /= reference
  return {edges: thinned, tangent}
}

type Chain = number[] // pixel indices, ordered along the contour

function hysteresis(edges: Float32Array, width: number, height: number, high: number, low: number) {
  const size = width * height
  const mask = new Uint8Array(size)
  const stack: number[] = []
  for (let index = 0; index < size; index++) {
    if (edges[index] >= high && !mask[index]) {
      mask[index] = 1
      stack.push(index)
      while (stack.length) {
        const current = stack.pop()!
        const cx = current % width, cy = (current - cx) / width
        for (let oy = -1; oy <= 1; oy++) {
          const ny = cy + oy
          if (ny < 0 || ny >= height) continue
          for (let ox = -1; ox <= 1; ox++) {
            const nx = cx + ox
            if (nx < 0 || nx >= width) continue
            const neighbour = ny * width + nx
            if (!mask[neighbour] && edges[neighbour] >= low) { mask[neighbour] = 1; stack.push(neighbour) }
          }
        }
      }
    }
  }
  return mask
}

const NEIGHBOURS_8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]

function extractChains(mask: Uint8Array, width: number, height: number): Chain[] {
  // Trace graph *segments*, not pixels. Marking a junction pixel as visited (the old approach)
  // destroys every other line that meets it and is the main source of short, scattered dashes.
  const usedEdges = new Set<number>()
  const chains: Chain[] = []
  const neighbours = (index: number) => {
    const result: number[] = []
    const x = index % width, y = (index - x) / width
    for (const [ox, oy] of NEIGHBOURS_8) {
      const nx = x + ox, ny = y + oy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const next = ny * width + nx
      if (!mask[next]) continue
      // Do not add a diagonal shortcut across two already connected orthogonal pixels. It creates
      // artificial three-way junctions on every staircase-shaped diagonal.
      if (ox && oy && mask[y * width + nx] && mask[ny * width + x]) continue
      result.push(next)
    }
    return result
  }
  const edgeKey = (a: number, b: number) => a < b ? a * mask.length + b : b * mask.length + a
  const degree = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) if (mask[i]) degree[i] = neighbours(i).length

  const walk = (start: number, first: number) => {
    const chain = [start, first]
    usedEdges.add(edgeKey(start, first))
    let previous = start
    let current = first
    while (degree[current] === 2) {
      const next = neighbours(current).find(candidate => candidate !== previous && !usedEdges.has(edgeKey(current, candidate)))
      if (next === undefined) break
      chain.push(next)
      usedEdges.add(edgeKey(current, next))
      previous = current
      current = next
    }
    if (chain.length > 1) chains.push(chain)
  }

  // Endpoints and true junctions first, then closed loops which have no endpoint.
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || degree[start] === 2) continue
    for (const next of neighbours(start)) if (!usedEdges.has(edgeKey(start, next))) walk(start, next)
  }
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue
    for (const next of neighbours(start)) if (!usedEdges.has(edgeKey(start, next))) walk(start, next)
  }
  return chains
}

const angleFactor = (angle: number, centre: number, halfWidth: number) => {
  let delta = Math.abs(angle - centre) % 180
  if (delta > 90) delta = 180 - delta
  return Math.max(0, 1 - delta / halfWidth)
}

/**
 * Scores every symbol for a stroke window and returns the best weighted candidate.
 * Scores are 0..1 from geometry alone; user weights then bias the choice, so a heavy weight on `.`
 * turns strokes into dotted lines and a heavy weight on `(` `)` grabs any noticeably curved stroke.
 */
function pickSymbol(points: Array<{x: number; y: number}>, arc: Float32Array, index: number, half: number, spacing: number, weights: TraceSettings['weights'], tangent?: number): TraceSymbol | null {
  let a = index
  while (a > 0 && arc[index] - arc[a - 1] <= half) a--
  let b = index
  while (b < points.length - 1 && arc[b + 1] - arc[index] <= half) b++
  const dx = points[b].x - points[a].x
  const dy = points[b].y - points[a].y
  const chord = Math.hypot(dx, dy)
  const arcLength = arc[b] - arc[a]
  const relative = chord / spacing
  const wiggly = arcLength > 0 && chord / arcLength < .6

  // The raster contour graph contains staircase steps and junction fragments. Its chord is useful
  // for curvature, but the Sobel tangent is the reliable source for glyph orientation.
  let angle = tangent === undefined ? Math.atan2(dy, dx) * 180 / Math.PI : tangent * 180 / Math.PI
  if (angle < 0) angle += 180
  const midX = (points[a].x + points[b].x) / 2
  const midY = (points[a].y + points[b].y) / 2
  const deviation = chord > 0 ? ((points[index].x - midX) * dy - (points[index].y - midY) * dx) / chord : 0
  const bulge = chord > 0 ? Math.abs(deviation) / chord : 0
  const bulgeLeft = points[index].x < midX

  const stroke = wiggly ? 0 : Math.min(1, relative / .5)
  const vertical = angleFactor(angle, 90, 45)
  const curve = Math.min(1, bulge / .18) * angleFactor(angle, 90, 65) * stroke
  const scores: Record<TraceSymbol, number> = {
    '.': wiggly ? 1 : Math.max(.35, 1 - relative / .75),
    ':': vertical * Math.max(.55, 1 - Math.abs(relative - .5) / .4),
    '-': angleFactor(angle, 0, 45) * stroke,
    '|': vertical * stroke * (1 - curve * .5),
    '/': angleFactor(angle, 135, 45) * stroke,
    '\\': angleFactor(angle, 45, 45) * stroke,
    '(': bulgeLeft ? curve : 0,
    ')': bulgeLeft ? 0 : curve,
  }

  let best: TraceSymbol | null = null
  let bestScore = 0
  for (const symbol of TRACE_SYMBOLS) {
    const weight = weights[symbol] ?? 1
    if (weight <= 0) continue
    const score = scores[symbol] * weight
    if (score > bestScore) { bestScore = score; best = symbol }
  }
  return best
}

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

function hash2(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = ((h ^ (h >>> 13)) * 1274126177) | 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * @param unitsPerPixel how many Dota units one prepared-image pixel covers (referenceWidth / prepared.width)
 */
export function traceImage(prepared: PreparedImage, settings: TraceSettings, unitsPerPixel: number): TracedSymbol[] {
  const {width, height, edges, gray, tangent} = prepared
  const spacing = Math.max(2, settings.spacing / Math.max(1e-6, unitsPerPixel))
  const sensitivity = clamp(settings.sensitivity, 0, 100)
  const high = .03 + Math.pow((100 - sensitivity) / 100, 1.6) * .8
  const low = high * .4

  const mask = hysteresis(edges, width, height, high, low)
  type PlacedSymbol = TracedSymbol & {tangent?: number}
  const symbols: PlacedSymbol[] = []
  const bucketSize = spacing
  const buckets = new Map<number, PlacedSymbol[]>()
  const bucketKey = (bx: number, by: number) => by * 65536 + bx
  const tooClose = (x: number, y: number, direction?: number, coverage = false) => {
    const bx = Math.floor(x / bucketSize), by = Math.floor(y / bucketSize)
    const limit = spacing * (coverage ? .72 : .62)
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const list = buckets.get(bucketKey(bx + ox, by + oy))
      if (!list) continue
      for (const item of list) {
        const dx = item.x - x, dy = item.y - y
        if (direction !== undefined && item.tangent !== undefined) {
          const alignment = Math.abs(Math.cos(direction - item.tangent))
          if (alignment > .82) {
            const along = Math.abs(dx * Math.cos(direction) + dy * Math.sin(direction))
            const normal = Math.abs(-dx * Math.sin(direction) + dy * Math.cos(direction))
            // Wide suppression across similarly-directed strokes merges the two detected banks of
            // one ink line, while narrow along-stroke suppression keeps the contour continuous.
            if (!coverage && along < spacing * .84 && normal < spacing * 1.38) return true
          }
        }
        if (Math.hypot(dx, dy) < limit) return true
      }
    }
    return false
  }
  const place = (x: number, y: number, symbol: string, direction?: number, coverage = false) => {
    if (tooClose(x, y, direction, coverage)) return false
    const item: PlacedSymbol = {x, y, symbol, tangent: direction}
    symbols.push(item)
    const key = bucketKey(Math.floor(x / bucketSize), Math.floor(y / bucketSize))
    const list = buckets.get(key)
    if (list) list.push(item); else buckets.set(key, [item])
    return true
  }

  const symbolForTangent = (radians: number, strength: number): TraceSymbol | null => {
    let angle = radians * 180 / Math.PI
    angle = ((angle % 180) + 180) % 180
    const stroke = .75 + clamp(strength, 0, 1) * .25
    const scores: Record<TraceSymbol, number> = {
      '.': .08,
      ':': angleFactor(angle, 90, 32) * .2,
      '-': angleFactor(angle, 0, 45) * stroke,
      '|': angleFactor(angle, 90, 45) * stroke,
      '/': angleFactor(angle, 135, 45) * stroke,
      '\\': angleFactor(angle, 45, 45) * stroke,
      '(': 0,
      ')': 0,
    }
    let best: TraceSymbol | null = null
    let bestScore = 0
    for (const symbol of TRACE_SYMBOLS) {
      const score = scores[symbol] * (settings.weights[symbol] ?? 1)
      if (score > bestScore) { best = symbol; bestScore = score }
    }
    return best
  }

  const chains = extractChains(mask, width, height)

  // Walk each contour by travelled distance. This is deliberately independent of darkness:
  // dark hair must not consume all available positions before eyes and facial contours are seen.
  // Long contours go first, while the coverage pass below restores short branches and junctions.
  chains.sort((a, b) => b.length - a.length)
  for (let chainNumber = 0; chainNumber < chains.length; chainNumber++) {
    const chain = chains[chainNumber]
    if (chain.length < 2) continue
    const points = chain.map(index => ({x: index % width + .5, y: Math.floor(index / width) + .5}))
    const arc = new Float32Array(points.length)
    for (let i = 1; i < points.length; i++) arc[i] = arc[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    const length = arc[arc.length - 1]
    if (length < spacing * .28) continue

    // Centre the samples on a chain instead of always pinning one to every endpoint. This avoids
    // dense starbursts where several graph segments meet at the same skeleton pixel.
    const count = Math.max(1, Math.round(length / spacing))
    const step = length / count
    for (let sample = 0; sample < count; sample++) {
      const target = (sample + .5) * step
      let i = 1
      while (i < arc.length - 1 && arc[i] < target) i++
      const previous = i - 1
      const segment = Math.max(1e-6, arc[i] - arc[previous])
      const mix = clamp((target - arc[previous]) / segment, 0, 1)
      const x = points[previous].x + (points[i].x - points[previous].x) * mix
      const y = points[previous].y + (points[i].y - points[previous].y) * mix
      const sourceIndex = chain[mix < .5 ? previous : i]
      let symbol = pickSymbol(points, arc, mix < .5 ? previous : i, spacing * .72, spacing, settings.weights, tangent[sourceIndex])
        ?? symbolForTangent(tangent[sourceIndex], edges[sourceIndex])

      // Hand-made grids rarely draw an entire contour with uninterrupted slashes. Sprinkle
      // punctuation deterministically along longer strokes: dots give the eye breathing room,
      // while colons retain direction on near-vertical pieces. Endpoints also become dots when
      // the contour is long enough. User weights still control whether either glyph is available.
      const dotWeight = settings.weights['.'] ?? 1
      const colonWeight = settings.weights[':'] ?? 1
      const angle = ((tangent[sourceIndex] * 180 / Math.PI) % 180 + 180) % 180
      const vertical = angleFactor(angle, 90, 32)
      const phase = (sample + chainNumber * 3) % 7
      const endpoint = count >= 4 && (sample === 0 || sample === count - 1)
      if (dotWeight > 0 && (endpoint || phase === 3 || (edges[sourceIndex] < .22 && phase === 5))) {
        symbol = '.'
      } else if (colonWeight > 0 && vertical > .72 && (sample + chainNumber) % 5 === 2) {
        symbol = ':'
      }
      if (symbol) place(x, y, symbol, tangent[sourceIndex])
    }
  }

  // Repair genuinely uncovered pieces. The old strength-sorted sampler used this as its main
  // pass, which created clumps; here it only fills holes left by chain segmentation/suppression.
  const uncovered: number[] = []
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue
    const x = index % width, y = Math.floor(index / width)
    if (!tooClose(x + .5, y + .5, tangent[index], true)) uncovered.push(index)
  }
  uncovered.sort((a, b) => edges[b] - edges[a])
  for (const index of uncovered) {
    const x = index % width, y = Math.floor(index / width)
    if (tooClose(x + .5, y + .5, tangent[index], true)) continue
    const symbol = symbolForTangent(tangent[index], edges[index])
    if (symbol) place(x + .5, y + .5, symbol, tangent[index], true)
  }

  if (settings.shading > 0 && (settings.weights['.'] ?? 1) > 0) {
    const strength = clamp(settings.shading, 0, 100) / 100
    const occupied = new Set<number>()
    for (const item of symbols) occupied.add(bucketKey(Math.floor(item.x / spacing), Math.floor(item.y / spacing)))
    const columns = Math.ceil(width / spacing), rows = Math.ceil(height / spacing)
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        if (occupied.has(bucketKey(column, row))) continue
        const cx = Math.min(width - 1, Math.floor((column + .5) * spacing))
        const cy = Math.min(height - 1, Math.floor((row + .5) * spacing))
        let sum = 0, samples = 0
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const sx = clamp(cx + ox, 0, width - 1), sy = clamp(cy + oy, 0, height - 1)
          sum += gray[sy * width + sx]; samples++
        }
        let darkness = 1 - sum / samples / 255
        if (settings.invertShading) darkness = 1 - darkness
        const threshold = (BAYER_4[row & 3][column & 3] + .5) / 16
        if (darkness * strength * 1.15 <= threshold) continue
        const jitterX = (hash2(column, row) - .5) * spacing * .45
        const jitterY = (hash2(row + 7919, column) - .5) * spacing * .45
        place(cx + .5 + jitterX, cy + .5 + jitterY, '.')
      }
    }
  }

  return symbols
}
