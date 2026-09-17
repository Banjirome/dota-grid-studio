import {useDeferredValue, useEffect, useMemo, useRef, useState} from 'react'
import {DotaCategory} from './model'
import {DOTA_LABEL_STYLE, GlyphOffset, ensureDotaFont, measureGlyphOffsets} from './rendering'
import {PreparedImage, TRACE_SYMBOLS, TraceSettings, TraceSymbol, defaultTraceSettings, prepareImage, traceImage} from './trace'

export type TraceTarget = {name: string; x: number; y: number; width: number; height: number}

type Props = {
  target: TraceTarget
  image: HTMLImageElement
  background: string
  onClose: () => void
  onInsert: (categories: DotaCategory[], options: {deleteReference: boolean}) => void
}

const LARGE_GRID = 6000
const formatNumber = (value: number) => Number.isFinite(value) ? Number(value.toFixed(3)) : 0

export default function TraceModal({target, image, background, onClose, onInsert}: Props) {
  const [settings, setSettings] = useState<TraceSettings>({...defaultTraceSettings})
  const [showReference, setShowReference] = useState(true)
  const [deleteReference, setDeleteReference] = useState(false)
  const [offsets, setOffsets] = useState<Map<string, GlyphOffset> | null>(null)
  const [prepared, setPrepared] = useState<PreparedImage | null>(null)
  const [prepareError, setPrepareError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const deferredSettings = useDeferredValue(settings)

  useEffect(() => {
    let cancelled = false
    ensureDotaFont().catch(() => undefined).then(() => { if (!cancelled) setOffsets(measureGlyphOffsets(TRACE_SYMBOLS)) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setPrepared(null)
    setPrepareError('')
    // The semantic line-art model runs locally and can take a moment on its first invocation.
    const handle = window.setTimeout(() => {
      prepareImage(image)
        .then(value => { if (!cancelled) setPrepared(value) })
        .catch(error => { if (!cancelled) setPrepareError(error instanceof Error ? error.message : String(error)) })
    }, 0)
    return () => { cancelled = true; window.clearTimeout(handle) }
  }, [image])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const categories = useMemo<DotaCategory[]>(() => {
    if (!prepared || !offsets) return []
    const unitsX = target.width / prepared.width
    const unitsY = target.height / prepared.height
    const fallback: GlyphOffset = {dx: DOTA_LABEL_STYLE.paddingLeft, dy: DOTA_LABEL_STYLE.controlHeight / 2}
    return traceImage(prepared, deferredSettings, unitsX).map(item => {
      const offset = offsets.get(item.symbol) ?? fallback
      return {
        category_name: item.symbol,
        x_position: formatNumber(target.x + item.x * unitsX - offset.dx),
        y_position: formatNumber(target.y + item.y * unitsY - offset.dy),
        width: 30,
        height: 30,
        hero_ids: [],
      }
    })
  }, [deferredSettings, offsets, prepared, target])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return
      const dpr = window.devicePixelRatio || 1
      const width = Math.floor(rect.width * dpr), height = Math.floor(rect.height * dpr)
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = background
      ctx.fillRect(0, 0, rect.width, rect.height)
      const margin = 18
      const scale = Math.min((rect.width - margin * 2) / Math.max(1, target.width), (rect.height - margin * 2) / Math.max(1, target.height))
      const originX = (rect.width - target.width * scale) / 2
      const originY = (rect.height - target.height * scale) / 2
      if (showReference) {
        ctx.globalAlpha = .28
        ctx.drawImage(image, originX, originY, target.width * scale, target.height * scale)
        ctx.globalAlpha = 1
      }
      ctx.font = `${DOTA_LABEL_STYLE.weight} ${DOTA_LABEL_STYLE.size * scale}px "${DOTA_LABEL_STYLE.family}", Arial, sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = DOTA_LABEL_STYLE.color
      const padX = DOTA_LABEL_STYLE.paddingLeft, padY = DOTA_LABEL_STYLE.controlHeight / 2
      for (const item of categories) {
        ctx.fillText(item.category_name, originX + (item.x_position - target.x + padX) * scale, originY + (item.y_position - target.y + padY) * scale)
      }
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [background, categories, image, showReference, target])

  const update = <K extends keyof TraceSettings,>(key: K, value: TraceSettings[K]) => setSettings(current => ({...current, [key]: value}))
  const weightOf = (symbol: TraceSymbol) => settings.weights[symbol] ?? 1
  const setWeight = (symbol: TraceSymbol, value: number) => setSettings(current => ({...current, weights: {...current.weights, [symbol]: value}}))
  const busy = !prepared || !offsets
  const pending = settings !== deferredSettings
  const large = categories.length > LARGE_GRID

  return (
    <div className="modal-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="settings-modal trace-modal" role="dialog" aria-modal="true" aria-label="Generate grid from image">
        <header className="settings-title">
          <div><span>GENERATE GRID</span><b title={target.name}>{target.name}</b></div>
          <button onClick={onClose} title="Close">×</button>
        </header>
        <div className="trace-body">
          <div className="trace-preview">
            <canvas ref={canvasRef}/>
            {(busy || pending || prepareError) && <div className="trace-preview-overlay">{prepareError ? `Line-art model failed: ${prepareError}` : busy ? 'Extracting semantic line art…' : 'Updating…'}</div>}
          </div>
          <aside className="trace-controls">
            <div className={`trace-count ${large ? 'warning' : ''}`}>
              <span>ELEMENTS</span>
              <b>{categories.length.toLocaleString()}</b>
              {large
                ? <small>Very large grids make Dota's hero picker sluggish. Increase spacing or lower sensitivity.</small>
                : <small>Output size follows the reference rectangle: resize the reference on the canvas to change it.</small>}
            </div>
            <h3>Contours</h3>
            <label className="field">
              <span>Spacing <b>{settings.spacing} u</b></span>
              <input type="range" min="4" max="40" step="1" value={settings.spacing} onChange={event => update('spacing', Number(event.target.value))}/>
            </label>
            <label className="field">
              <span>Edge sensitivity <b>{settings.sensitivity}</b></span>
              <input type="range" min="0" max="100" step="1" value={settings.sensitivity} onChange={event => update('sensitivity', Number(event.target.value))}/>
            </label>
            <div className="trace-divider"/>
            <h3>Symbols</h3>
            <div className="trace-symbols">
              {TRACE_SYMBOLS.map(symbol => {
                const weight = weightOf(symbol)
                return <div className={`trace-symbol-row ${weight === 0 ? 'off' : ''}`} key={symbol}>
                  <input type="checkbox" checked={weight > 0} title={weight > 0 ? 'Disable symbol' : 'Enable symbol'} onChange={event => setWeight(symbol, event.target.checked ? 1 : 0)}/>
                  <span className="trace-symbol-glyph">{symbol}</span>
                  <input type="range" min="0" max="300" step="10" value={Math.round(weight * 100)} disabled={weight === 0} onChange={event => setWeight(symbol, Number(event.target.value) / 100)}/>
                  <b>{weight === 0 ? 'off' : `${Math.round(weight * 100)}%`}</b>
                </div>
              })}
            </div>
            <div className="keybindings-help">Weights bias which symbol wins on each stroke. Push <code>.</code> above 200% to turn outlines into dotted lines, raise <code>( )</code> to catch gently curved strokes, lower <code>/ \</code> to thin out hatching.</div>
            <div className="trace-divider"/>
            <h3>Shading</h3>
            <label className="field">
              <span>Dot density <b>{settings.shading}</b></span>
              <input type="range" min="0" max="100" step="1" value={settings.shading} onChange={event => update('shading', Number(event.target.value))}/>
            </label>
            <label className="check-row"><input type="checkbox" checked={settings.invertShading} disabled={settings.shading === 0} onChange={event => update('invertShading', event.target.checked)}/><span>Shade light areas instead of dark</span></label>
            <div className="trace-divider"/>
            <h3>Preview &amp; insert</h3>
            <label className="check-row"><input type="checkbox" checked={showReference} onChange={event => setShowReference(event.target.checked)}/><span>Show reference behind symbols</span></label>
            <label className="check-row"><input type="checkbox" checked={deleteReference} onChange={event => setDeleteReference(event.target.checked)}/><span>Remove reference after insert</span></label>
            <div className="keybindings-help">Symbols are placed along detected outlines and picked from <code>. : - | / \ ( )</code> by stroke direction. Elements are appended to the current grid and selected, so a single Undo removes them again.</div>
          </aside>
        </div>
        <footer className="settings-actions">
          <button className="secondary-button" onClick={() => setSettings({...defaultTraceSettings})}>Reset</button>
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={busy || pending || categories.length === 0} onClick={() => onInsert(categories, {deleteReference})}>
            Insert {categories.length.toLocaleString()} element{categories.length === 1 ? '' : 's'}
          </button>
        </footer>
      </section>
    </div>
  )
}
