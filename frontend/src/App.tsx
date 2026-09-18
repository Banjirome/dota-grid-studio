import {ChangeEvent, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, WheelEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import './App.css'
import TraceModal from './TraceModal'
import {FilePayload, exportPNG, getLaunchOptions, hasNativeBackend, loadAppSettings, openDotaJSON, readDotaJSON, readReferenceImage, saveAppSettings, saveDotaJSON} from './backend'
import {OnFileDrop, OnFileDropOff} from '../wailsjs/runtime/runtime'
import {
  Calibration,
  DotaCategory,
  DotaDocument,
  canvasToDota,
  defaultCalibration,
  dotaToCanvas,
  emptyDocument,
  normaliseDocument,
} from './model'
import {
  RenderSettings,
  DOTA_LABEL_STYLE,
  defaultRenderSettings,
  drawCategoryLabel,
  getCategoryIntrinsicSize,
  getCategoryTextBounds,
  getCategoryVisualBounds,
} from './rendering'
import {
  AppPreferences,
  CommandId,
  Keybindings,
  commandLabelsForPalette,
  defaultKeybindings,
  defaultPalette,
  defaultPreferences,
  keybindingsForPalette,
  matchesShortcut,
  mergePreferences,
  shortcutFromEvent,
} from './preferences'

type Tool = 'select' | 'symbol' | 'pan'
type View = {x: number; y: number; zoom: number}
type SelectionBounds = {index: number; minX: number; minY: number; maxX: number; maxY: number}
type PointerAction = {
  mode: 'pan' | 'drag' | 'resize' | 'image-drag' | 'image-resize' | 'marquee'
  startScreen: {x: number; y: number}
  startView: View
  originals: Map<number, DotaCategory>
  imageId?: string
  imageOriginal?: ReferenceImage
  baseSelection?: number[]
  marqueeBounds?: SelectionBounds[]
}

type ReferenceImage = {
  id: string
  name: string
  src: string
  x: number
  y: number
  width: number
  height: number
  layer: 'back' | 'front'
  locked: boolean
  opacity: number
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const formatNumber = (value: number) => Number.isFinite(value) ? Number(value.toFixed(3)) : 0
const GRID_UNIT = 5

function App() {
  const [document, setDocument] = useState<DotaDocument>(() => emptyDocument())
  const [configIndex, setConfigIndex] = useState(0)
  const [selected, setSelected] = useState<number[]>([])
  const [path, setPath] = useState('')
  const [dirty, setDirty] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [symbol, setSymbol] = useState('.')
  const [view, setView] = useState<View>({x: 90, y: 70, zoom: 1})
  const [calibration] = useState<Calibration>(defaultCalibration)
  const [showGrid, setShowGrid] = useState(true)
  const [renderSettings, setRenderSettings] = useState<RenderSettings>({...defaultRenderSettings})
  const [keybindings, setKeybindings] = useState<Keybindings>({...defaultKeybindings})
  const [palette, setPalette] = useState<string[]>([...defaultPalette])
  const [paletteDraft, setPaletteDraft] = useState('')
  const [recentFiles, setRecentFiles] = useState<string[]>([])
  const [settingsPath, setSettingsPath] = useState('')
  const [settingsReady, setSettingsReady] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPage, setSettingsPage] = useState<'render' | 'palette' | 'keybindings'>('render')
  const [search, setSearch] = useState('')
  const [hidden, setHidden] = useState<Set<number>>(() => new Set())
  const [locked, setLocked] = useState<Set<number>>(() => new Set())
  const [status, setStatus] = useState('Ready — open a Dota JSON or place a symbol')
  const [spaceDown, setSpaceDown] = useState(false)
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [traceReferenceId, setTraceReferenceId] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const traceFileInputRef = useRef<HTMLInputElement>(null)
  const traceOpenRef = useRef(false)
  const pointerRef = useRef<PointerAction | null>(null)
  const historyRef = useRef<{past: DotaDocument[]; future: DotaDocument[]}>({past: [], future: []})
  const clipboardRef = useRef<DotaCategory[]>([])
  const documentRef = useRef(document)
  const selectedRef = useRef(selected)
  const initialisedRef = useRef(false)
  const dragPreviewRef = useRef<Map<number, Partial<DotaCategory>>>(new Map())
  const imagePreviewRef = useRef<Partial<ReferenceImage> | null>(null)
  const marqueeRef = useRef<{start: {x: number; y: number}; current: {x: number; y: number}} | null>(null)
  const selectionPreviewRef = useRef<number[] | null>(null)
  const referenceElementsRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const dropDepthRef = useRef(0)
  const nativeDropHandlerRef = useRef<(x: number, y: number, paths: string[]) => void>(() => {})
  const drawFrameRef = useRef<number | null>(null)
  const cursorReadoutRef = useRef<HTMLSpanElement>(null)

  const config = document.configs[configIndex] ?? document.configs[0]
  const categories = config?.categories ?? []
  const primaryIndex = selected.length ? selected[selected.length - 1] : -1
  const primary = categories[primaryIndex]
  const selectedReference = referenceImages.find(item => item.id === selectedReferenceId)
  const traceReference = referenceImages.find(item => item.id === traceReferenceId)
  const traceImageElement = traceReferenceId ? referenceElementsRef.current.get(traceReferenceId) : undefined
  const commandLabels = useMemo(() => commandLabelsForPalette(palette), [palette])

  useEffect(() => { documentRef.current = document }, [document])
  useEffect(() => { selectedRef.current = selected }, [selected])
  useEffect(() => { traceOpenRef.current = traceReferenceId !== null }, [traceReferenceId])

  const updateRenderSetting = <K extends keyof RenderSettings,>(key: K, value: RenderSettings[K]) => {
    setRenderSettings(current => ({...current, [key]: value}))
  }

  const updateBinding = (command: CommandId, shortcut: string) => {
    setKeybindings(current => ({...current, [command]: shortcut}))
  }

  const clearReferenceImages = useCallback(() => {
    referenceElementsRef.current.forEach(image => URL.revokeObjectURL(image.src))
    referenceElementsRef.current.clear()
    setReferenceImages([])
    setSelectedReferenceId(null)
  }, [])

  const commit = useCallback((update: (current: DotaDocument) => DotaDocument) => {
    setDocument(current => {
      historyRef.current.past.push(clone(current))
      if (historyRef.current.past.length > 100) historyRef.current.past.shift()
      historyRef.current.future = []
      const next = update(current)
      documentRef.current = next
      return next
    })
    setDirty(true)
  }, [])

  const undo = useCallback(() => {
    const previous = historyRef.current.past.pop()
    if (!previous) return
    historyRef.current.future.push(clone(documentRef.current))
    documentRef.current = previous
    setDocument(previous)
    setSelected([])
    setDirty(true)
    setStatus('Undo')
  }, [])

  const redo = useCallback(() => {
    const next = historyRef.current.future.pop()
    if (!next) return
    historyRef.current.past.push(clone(documentRef.current))
    documentRef.current = next
    setDocument(next)
    setSelected([])
    setDirty(true)
    setStatus('Redo')
  }, [])

  const changeCategories = useCallback((changes: Map<number, Partial<DotaCategory>>, withHistory = true) => {
    const updater = (current: DotaDocument) => ({
      ...current,
      configs: current.configs.map((cfg, ci) => ci !== configIndex ? cfg : ({
        ...cfg,
        categories: cfg.categories.map((category, index) => changes.has(index) ? {...category, ...changes.get(index)} : category),
      })),
    })
    if (withHistory) commit(updater)
    else {
      setDocument(current => {
        const next = updater(current)
        documentRef.current = next
        return next
      })
      setDirty(true)
    }
  }, [commit, configIndex])

  const screenPoint = (event: {clientX: number; clientY: number}) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {x: event.clientX - rect.left, y: event.clientY - rect.top}
  }

  const screenToDotaPoint = useCallback((point: {x: number; y: number}) => {
    const worldX = (point.x - view.x) / view.zoom
    const worldY = (point.y - view.y) / view.zoom
    return canvasToDota(worldX, worldY, calibration)
  }, [calibration, view])

  const hitTest = useCallback((point: {x: number; y: number}) => {
    const dota = screenToDotaPoint(point)
    const measureContext = window.document.createElement('canvas').getContext('2d')!
    const toleranceX = 6 / Math.max(.001, view.zoom * Math.abs(calibration.scaleX))
    const toleranceY = 6 / Math.max(.001, view.zoom * Math.abs(calibration.scaleY))
    let closest = -1
    let closestScore = Number.POSITIVE_INFINITY
    for (let index = 0; index < categories.length; index++) {
      if (hidden.has(index)) continue
      const item = categories[index]
      const bounds = getCategoryTextBounds(measureContext, item)
      if (dota.x < bounds.minX - toleranceX || dota.x > bounds.maxX + toleranceX || dota.y < bounds.minY - toleranceY || dota.y > bounds.maxY + toleranceY) continue
      const centreX = (bounds.minX + bounds.maxX) / 2
      const centreY = (bounds.minY + bounds.maxY) / 2
      const dx = (dota.x - centreX) * calibration.scaleX * view.zoom
      const dy = (dota.y - centreY) * calibration.scaleY * view.zoom
      const outsideX = Math.max(bounds.minX - dota.x, 0, dota.x - bounds.maxX) * Math.abs(calibration.scaleX) * view.zoom
      const outsideY = Math.max(bounds.minY - dota.y, 0, dota.y - bounds.maxY) * Math.abs(calibration.scaleY) * view.zoom
      // Prefer actual ink proximity, then the nearest label centre when ink boxes overlap.
      const score = (outsideX * outsideX + outsideY * outsideY) * 100 + dx * dx + dy * dy
      if (score < closestScore) { closestScore = score; closest = index }
    }
    return closest
  }, [calibration, categories, hidden, screenToDotaPoint, view.zoom])

  const fitToContent = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || (categories.length === 0 && referenceImages.length === 0)) {
      setView({x: 90, y: 70, zoom: 1})
      return
    }
    const rect = canvas.getBoundingClientRect()
    const visible = categories.filter((_, index) => !hidden.has(index))
    const measureContext = window.document.createElement('canvas').getContext('2d')!
    const bounds = [
      ...visible.map(item => getCategoryVisualBounds(measureContext, item, renderSettings)),
      ...referenceImages.map(item => ({minX: item.x, minY: item.y, maxX: item.x + item.width, maxY: item.y + item.height})),
    ]
    if (!bounds.length) return
    const minX = Math.min(...bounds.map(item => item.minX))
    const minY = Math.min(...bounds.map(item => item.minY))
    const maxX = Math.max(...bounds.map(item => item.maxX))
    const maxY = Math.max(...bounds.map(item => item.maxY))
    const a = dotaToCanvas(minX, minY, calibration)
    const b = dotaToCanvas(maxX, maxY, calibration)
    const zoom = Math.max(.05, Math.min(8, Math.min((rect.width - 120) / Math.max(1, b.x - a.x), (rect.height - 120) / Math.max(1, b.y - a.y))))
    setView({x: rect.width / 2 - (a.x + b.x) / 2 * zoom, y: rect.height / 2 - (a.y + b.y) / 2 * zoom, zoom})
  }, [calibration, categories, hidden, referenceImages, renderSettings])

  const loadFilePayload = useCallback((result: FilePayload, preferredConfig = 0) => {
    const parsed = normaliseDocument(JSON.parse(result.content))
    const nextConfig = Math.max(0, Math.min(preferredConfig, parsed.configs.length - 1))
    setDocument(parsed)
    documentRef.current = parsed
    setPath(result.path)
    setConfigIndex(nextConfig)
    setSelected([])
    setHidden(new Set())
    setLocked(new Set())
    clearReferenceImages()
    historyRef.current = {past: [], future: []}
    setDirty(false)
    setRecentFiles(current => [result.path, ...current.filter(item => item.toLowerCase() !== result.path.toLowerCase())].slice(0, 12))
    setStatus(`Opened ${result.path}`)
    setView({x: 70, y: 55, zoom: 1})
  }, [clearReferenceImages])

  useEffect(() => {
    if (initialisedRef.current) return
    initialisedRef.current = true
    const initialise = async () => {
      let preferences = defaultPreferences()
      let launchPath = ''
      try {
        if (hasNativeBackend()) {
          const [rawSettings, launch] = await Promise.all([loadAppSettings(), getLaunchOptions()])
          preferences = mergePreferences(JSON.parse(rawSettings) as Partial<AppPreferences>)
          launchPath = launch.openPath
          setSettingsPath(launch.settingsPath)
        } else {
          const stored = window.localStorage.getItem('dgs.preferences.v1')
          if (stored) preferences = mergePreferences(JSON.parse(stored) as Partial<AppPreferences>)
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error))
      }

      setRenderSettings(preferences.render)
      setKeybindings(preferences.keybindings)
      setPalette(preferences.palette)
      setRecentFiles(preferences.recentFiles)
      setSettingsReady(true)

      if (launchPath && hasNativeBackend()) {
        try {
          loadFilePayload(await readDotaJSON(launchPath), preferences.lastFile === launchPath ? preferences.lastConfig : 0)
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error))
        }
      }
    }
    void initialise()
  }, [loadFilePayload])

  useEffect(() => {
    if (!settingsReady) return
    const preferences: AppPreferences = {
      version: 2,
      render: renderSettings,
      keybindings,
      palette,
      recentFiles,
      lastFile: path,
      lastConfig: configIndex,
    }
    const timer = window.setTimeout(() => {
      const content = JSON.stringify(preferences, null, 2)
      if (hasNativeBackend()) {
        saveAppSettings(content).catch(error => setStatus(error instanceof Error ? error.message : String(error)))
      } else {
        window.localStorage.setItem('dgs.preferences.v1', content)
      }
    }, 180)
    return () => window.clearTimeout(timer)
  }, [configIndex, keybindings, palette, path, recentFiles, renderSettings, settingsReady])

  useEffect(() => {
    void window.document.fonts.ready.then(() => drawScene())
  }, [])

  const drawScene = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, Math.floor(rect.width * dpr))
    const height = Math.max(1, Math.floor(rect.height * dpr))
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.fillStyle = renderSettings.backgroundColor
    ctx.fillRect(0, 0, rect.width, rect.height)
    const activeSelection = selectionPreviewRef.current ?? selected
    const activeSelectionSet = new Set(activeSelection)
    const activePrimaryIndex = activeSelection.length ? activeSelection[activeSelection.length - 1] : -1

    const resolvedReference = (item: ReferenceImage) => item.id === selectedReferenceId && imagePreviewRef.current ? {...item, ...imagePreviewRef.current} : item
    const drawReferenceLayer = (layer: ReferenceImage['layer']) => {
      ctx.save()
      referenceImages.forEach(source => {
        const item = resolvedReference(source)
        if (item.layer !== layer) return
        const image = referenceElementsRef.current.get(item.id)
        if (!image) return
        ctx.globalAlpha = Math.max(0, Math.min(1, item.opacity ?? .62))
        const p = dotaToCanvas(item.x, item.y, calibration)
        ctx.drawImage(image, view.x + p.x * view.zoom, view.y + p.y * view.zoom, item.width * calibration.scaleX * view.zoom, item.height * calibration.scaleY * view.zoom)
      })
      ctx.restore()
    }

    drawReferenceLayer('back')

    if (showGrid) {
      const step = GRID_UNIT * view.zoom * Math.abs(calibration.scaleX)
      const gridStep = step < 9 ? step * Math.ceil(9 / Math.max(step, .1)) : step
      ctx.beginPath()
      ctx.strokeStyle = renderSettings.gridColor
      ctx.lineWidth = 1
      let startX = ((view.x + calibration.offsetX * view.zoom) % gridStep + gridStep) % gridStep
      let startY = ((view.y + calibration.offsetY * view.zoom) % gridStep + gridStep) % gridStep
      for (let x = startX; x < rect.width; x += gridStep) { ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, rect.height) }
      for (let y = startY; y < rect.height; y += gridStep) { ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(rect.width, Math.round(y) + .5) }
      ctx.stroke()
    }

    const origin = dotaToCanvas(0, 0, calibration)
    ctx.strokeStyle = '#343a44'
    ctx.beginPath()
    ctx.moveTo(view.x + origin.x * view.zoom + .5, 0); ctx.lineTo(view.x + origin.x * view.zoom + .5, rect.height)
    ctx.moveTo(0, view.y + origin.y * view.zoom + .5); ctx.lineTo(rect.width, view.y + origin.y * view.zoom + .5)
    ctx.stroke()

    categories.forEach((source, index) => {
      if (hidden.has(index)) return
      const preview = dragPreviewRef.current.get(index)
      const item = preview ? {...source, ...preview} : source
      const p = dotaToCanvas(item.x_position, item.y_position, calibration)
      const x = view.x + p.x * view.zoom
      const y = view.y + p.y * view.zoom
      const widthPx = item.width * calibration.scaleX * view.zoom
      const heightPx = item.height * calibration.scaleY * view.zoom
      if (activeSelectionSet.has(index) || renderSettings.showElementBounds) {
        ctx.fillStyle = activeSelectionSet.has(index) ? 'rgba(216, 75, 66, .12)' : 'rgba(255,255,255,.018)'
        ctx.fillRect(x, y, widthPx, heightPx)
      }
      if (view.zoom > .18) {
        drawCategoryLabel(ctx, item, {x, y, width: widthPx, height: heightPx}, renderSettings, locked.has(index) ? '#7d828a' : DOTA_LABEL_STYLE.color)
      }
    })

    drawReferenceLayer('front')

    activeSelection.forEach(index => {
      if (hidden.has(index)) return
      const source = categories[index]
      if (!source) return
      const preview = dragPreviewRef.current.get(index)
      const item = preview ? {...source, ...preview} : source
      const p = dotaToCanvas(item.x_position, item.y_position, calibration)
      const x = view.x + p.x * view.zoom
      const y = view.y + p.y * view.zoom
      const widthPx = item.width * calibration.scaleX * view.zoom
      const heightPx = item.height * calibration.scaleY * view.zoom
      ctx.strokeStyle = '#f05a4f'; ctx.lineWidth = 1.5
      ctx.strokeRect(x + .75, y + .75, widthPx - 1.5, heightPx - 1.5)
      if (index === activePrimaryIndex) {
        ctx.fillStyle = '#f05a4f'; ctx.fillRect(x + widthPx - 4, y + heightPx - 4, 8, 8)
      }
    })

    if (selectedReference) {
      const item = resolvedReference(selectedReference)
      const p = dotaToCanvas(item.x, item.y, calibration)
      const x = view.x + p.x * view.zoom
      const y = view.y + p.y * view.zoom
      const widthPx = item.width * calibration.scaleX * view.zoom
      const heightPx = item.height * calibration.scaleY * view.zoom
      ctx.fillStyle = 'rgba(73, 153, 235, .10)'
      ctx.fillRect(x, y, widthPx, heightPx)
      ctx.strokeStyle = '#4f9dec'; ctx.lineWidth = 1.5
      ctx.strokeRect(x + .75, y + .75, widthPx - 1.5, heightPx - 1.5)
      if (!item.locked) {
        ctx.fillStyle = '#4f9dec'
        ctx.fillRect(x + widthPx - 4, y + heightPx - 4, 8, 8)
      }
    }

    const marquee = marqueeRef.current
    if (marquee) {
      const x = Math.min(marquee.start.x, marquee.current.x)
      const y = Math.min(marquee.start.y, marquee.current.y)
      const width = Math.abs(marquee.current.x - marquee.start.x)
      const height = Math.abs(marquee.current.y - marquee.start.y)
      ctx.save()
      ctx.fillStyle = 'rgba(79, 157, 236, .12)'
      ctx.strokeStyle = '#4f9dec'
      ctx.lineWidth = 1
      ctx.setLineDash([5, 3])
      ctx.fillRect(x, y, width, height)
      ctx.strokeRect(x + .5, y + .5, Math.max(0, width - 1), Math.max(0, height - 1))
      ctx.restore()
    }
  }, [calibration, categories, hidden, locked, primaryIndex, referenceImages, renderSettings, selected, selectedReference, selectedReferenceId, showGrid, view])

  const scheduleDraw = useCallback(() => {
    if (drawFrameRef.current !== null) return
    drawFrameRef.current = window.requestAnimationFrame(() => {
      drawFrameRef.current = null
      drawScene()
    })
  }, [drawScene])

  useEffect(() => () => {
    if (drawFrameRef.current !== null) window.cancelAnimationFrame(drawFrameRef.current)
    referenceElementsRef.current.forEach(image => URL.revokeObjectURL(image.src))
    referenceElementsRef.current.clear()
  }, [])

  useEffect(() => {
    drawScene()
    const observer = new ResizeObserver(drawScene)
    if (canvasRef.current) observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [drawScene])

  const onWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const point = screenPoint(event)
    const oldZoom = view.zoom
    const nextZoom = Math.max(.05, Math.min(16, oldZoom * Math.exp(-event.deltaY * .0012)))
    const worldX = (point.x - view.x) / oldZoom
    const worldY = (point.y - view.y) / oldZoom
    setView({zoom: nextZoom, x: point.x - worldX * nextZoom, y: point.y - worldY * nextZoom})
  }

  const hitReference = useCallback((point: {x: number; y: number}, layer: ReferenceImage['layer']) => {
    const dota = screenToDotaPoint(point)
    for (let index = referenceImages.length - 1; index >= 0; index--) {
      const item = referenceImages[index]
      if (item.layer !== layer) continue
      if (item.locked) continue
      if (dota.x >= item.x && dota.x <= item.x + item.width && dota.y >= item.y && dota.y <= item.y + item.height) return item
    }
    return undefined
  }, [referenceImages, screenToDotaPoint])

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = screenPoint(event)
    dragPreviewRef.current.clear()
    imagePreviewRef.current = null
    marqueeRef.current = null
    selectionPreviewRef.current = null
    canvasRef.current?.setPointerCapture(event.pointerId)
    if (event.button === 1 || tool === 'pan' || spaceDown) {
      pointerRef.current = {mode: 'pan', startScreen: point, startView: view, originals: new Map()}
      return
    }
    if (event.button !== 0) return

    // Placement mode is deliberately write-only: existing elements and references must never
    // steal the click when drawing dense rows of dots or other symbols.
    if (tool === 'symbol') {
      if (!symbol) { setStatus('Add or select a palette item first'); return }
      const p = screenToDotaPoint(point)
      const measureContext = window.document.createElement('canvas').getContext('2d')!
      const intrinsic = getCategoryIntrinsicSize(measureContext, symbol)
      // The Dota label is offset inside its category box. Position the visible glyph centre under
      // the pointer rather than centring the unrelated 30×30 category rectangle.
      const visualCentreOffsetX = (DOTA_LABEL_STYLE.paddingLeft + intrinsic.width) / 2
      const visualCentreOffsetY = DOTA_LABEL_STYLE.controlHeight / 2
      const item: DotaCategory = {
        category_name: symbol,
        x_position: formatNumber(p.x - visualCentreOffsetX),
        y_position: formatNumber(p.y - visualCentreOffsetY),
        width: 30,
        height: 30,
        hero_ids: [],
      }
      const newIndex = categories.length
      commit(current => ({...current, configs: current.configs.map((cfg, ci) => ci === configIndex ? {...cfg, categories: [...cfg.categories, item]} : cfg)}))
      setSelectedReferenceId(null); setSelected([newIndex]); setStatus(`Created “${item.category_name}”`)
      return
    }
    let hit = -1
    let resize = false

    if (tool === 'select' && selectedReference && !selectedReference.locked) {
      const handle = dotaToCanvas(selectedReference.x + selectedReference.width, selectedReference.y + selectedReference.height, calibration)
      const handleX = view.x + handle.x * view.zoom
      const handleY = view.y + handle.y * view.zoom
      if (Math.abs(point.x - handleX) <= 10 && Math.abs(point.y - handleY) <= 10) {
        pointerRef.current = {mode: 'image-resize', startScreen: point, startView: view, originals: new Map(), imageId: selectedReference.id, imageOriginal: clone(selectedReference)}
        return
      }
    }

    if (tool === 'select' && selected.length === 1 && primary && !locked.has(primaryIndex)) {
      const handle = dotaToCanvas(primary.x_position + primary.width, primary.y_position + primary.height, calibration)
      const handleX = view.x + handle.x * view.zoom
      const handleY = view.y + handle.y * view.zoom
      resize = Math.abs(point.x - handleX) <= 10 && Math.abs(point.y - handleY) <= 10
      if (resize) hit = primaryIndex
    }

    if (tool === 'select' && !resize) {
      const frontReference = hitReference(point, 'front')
      if (frontReference) {
        setSelected([]); setSelectedReferenceId(frontReference.id)
        if (!frontReference.locked) pointerRef.current = {mode: 'image-drag', startScreen: point, startView: view, originals: new Map(), imageId: frontReference.id, imageOriginal: clone(frontReference)}
        return
      }
    }
    if (hit < 0) hit = hitTest(point)
    if (tool === 'select' && hit < 0) {
      const backReference = hitReference(point, 'back')
      if (backReference) {
        setSelected([]); setSelectedReferenceId(backReference.id)
        if (!backReference.locked) pointerRef.current = {mode: 'image-drag', startScreen: point, startView: view, originals: new Map(), imageId: backReference.id, imageOriginal: clone(backReference)}
        return
      }
    }
    if (hit < 0) {
      if (tool === 'select') {
        const baseSelection = event.ctrlKey || event.shiftKey ? [...selected] : []
        const measureContext = window.document.createElement('canvas').getContext('2d')!
        const marqueeBounds = categories.flatMap((item, index) => {
          if (hidden.has(index)) return []
          const bounds = getCategoryVisualBounds(measureContext, item, renderSettings)
          return [{index, ...bounds}]
        })
        selectedRef.current = baseSelection
        setSelected(baseSelection)
        setSelectedReferenceId(null)
        marqueeRef.current = {start: point, current: point}
        selectionPreviewRef.current = baseSelection
        pointerRef.current = {mode: 'marquee', startScreen: point, startView: view, originals: new Map(), baseSelection, marqueeBounds}
        scheduleDraw()
        return
      }
      setSelected([]); setSelectedReferenceId(null); return
    }
    const currentSelection = resize ? [hit] : event.ctrlKey || event.shiftKey
      ? (selected.includes(hit) ? selected.filter(index => index !== hit) : [...selected, hit])
      : (selected.includes(hit) ? selected : [hit])
    setSelectedReferenceId(null); setSelected(currentSelection)
    if (locked.has(hit)) return
    const originals = new Map<number, DotaCategory>()
    currentSelection.forEach(index => {
      if (locked.has(index)) return
      originals.set(index, clone(categories[index]))
    })
    pointerRef.current = {mode: resize ? 'resize' : 'drag', startScreen: point, startView: view, originals}
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = screenPoint(event)
    const dota = screenToDotaPoint(point)
    if (cursorReadoutRef.current) cursorReadoutRef.current.textContent = `X ${formatNumber(dota.x)}   Y ${formatNumber(dota.y)}`
    const action = pointerRef.current
    if (!action) return
    if (action.mode === 'pan') {
      setView({...action.startView, x: action.startView.x + point.x - action.startScreen.x, y: action.startView.y + point.y - action.startScreen.y})
      return
    }
    if (action.mode === 'marquee') {
      marqueeRef.current = {start: action.startScreen, current: point}
      const start = screenToDotaPoint(action.startScreen)
      const current = screenToDotaPoint(point)
      const minX = Math.min(start.x, current.x)
      const minY = Math.min(start.y, current.y)
      const maxX = Math.max(start.x, current.x)
      const maxY = Math.max(start.y, current.y)
      const inside = (action.marqueeBounds ?? [])
        .filter(bounds => bounds.maxX >= minX && bounds.minX <= maxX && bounds.maxY >= minY && bounds.minY <= maxY)
        .map(bounds => bounds.index)
      const next = [...new Set([...(action.baseSelection ?? []), ...inside])].sort((a, b) => a - b)
      selectionPreviewRef.current = next
      scheduleDraw()
      return
    }
    const deltaX = (point.x - action.startScreen.x) / action.startView.zoom / calibration.scaleX
    const deltaY = (point.y - action.startScreen.y) / action.startView.zoom / calibration.scaleY
    if ((action.mode === 'image-drag' || action.mode === 'image-resize') && action.imageOriginal) {
      imagePreviewRef.current = action.mode === 'image-resize'
        ? {width: Math.max(10, action.imageOriginal.width + deltaX), height: Math.max(10, action.imageOriginal.height + deltaY)}
        : {x: action.imageOriginal.x + deltaX, y: action.imageOriginal.y + deltaY}
      scheduleDraw()
      return
    }
    const changes = new Map<number, Partial<DotaCategory>>()
    action.originals.forEach((original, index) => {
      if (action.mode === 'resize') changes.set(index, {width: Math.max(5, original.width + deltaX), height: Math.max(5, original.height + deltaY)})
      else changes.set(index, {x_position: original.x_position + deltaX, y_position: original.y_position + deltaY})
    })
    dragPreviewRef.current = changes
    scheduleDraw()
  }

  const finishPointerAction = (commitPreview: boolean) => {
    const action = pointerRef.current
    const changes = dragPreviewRef.current
    const imageChanges = imagePreviewRef.current
    const selectionPreview = selectionPreviewRef.current
    pointerRef.current = null
    dragPreviewRef.current = new Map()
    imagePreviewRef.current = null
    marqueeRef.current = null
    selectionPreviewRef.current = null
    if (action?.mode === 'marquee') {
      if (!commitPreview) {
        const restored = action.baseSelection ?? []
        selectedRef.current = restored
        setSelected(restored)
      } else {
        const next = selectionPreview ?? action.baseSelection ?? []
        selectedRef.current = next
        setSelected(next)
        setStatus(`Selected ${next.length} element${next.length === 1 ? '' : 's'}`)
      }
      scheduleDraw()
      return
    }
    if (commitPreview && action?.imageId && imageChanges) {
      setReferenceImages(current => current.map(item => item.id === action.imageId ? {...item, ...imageChanges} : item))
    } else if (commitPreview && action && action.mode !== 'pan' && changes.size) changeCategories(changes)
    else scheduleDraw()
  }

  const removeReference = useCallback((referenceId: string) => {
    setReferenceImages(current => current.filter(item => {
      if (item.id !== referenceId) return true
      URL.revokeObjectURL(item.src)
      referenceElementsRef.current.delete(item.id)
      return false
    }))
    setSelectedReferenceId(current => current === referenceId ? null : current)
    setTraceReferenceId(current => current === referenceId ? null : current)
  }, [])

  const deleteSelected = useCallback(() => {
    if (selectedReferenceId) {
      removeReference(selectedReferenceId)
      setStatus('Deleted reference image')
      return
    }
    const chosen = new Set(selectedRef.current)
    if (!chosen.size) return
    commit(current => ({...current, configs: current.configs.map((cfg, ci) => ci === configIndex ? {...cfg, categories: cfg.categories.filter((_, index) => !chosen.has(index))} : cfg)}))
    setSelected([]); setHidden(new Set()); setLocked(new Set()); setStatus(`Deleted ${chosen.size} element${chosen.size === 1 ? '' : 's'}`)
  }, [commit, configIndex, removeReference, selectedReferenceId])

  const duplicateSelected = useCallback(() => {
    const items = selectedRef.current.map(index => documentRef.current.configs[configIndex]?.categories[index]).filter(Boolean).map(item => ({...clone(item), x_position: item.x_position + 10, y_position: item.y_position + 10}))
    if (!items.length) return
    const start = documentRef.current.configs[configIndex].categories.length
    commit(current => ({...current, configs: current.configs.map((cfg, ci) => ci === configIndex ? {...cfg, categories: [...cfg.categories, ...items]} : cfg)}))
    setSelected(items.map((_, index) => start + index)); setStatus(`Duplicated ${items.length} element${items.length === 1 ? '' : 's'}`)
  }, [commit, configIndex])

  const moveSelected = useCallback((dx: number, dy: number) => {
    if (selectedReferenceId) {
      setReferenceImages(current => current.map(item => item.id === selectedReferenceId && !item.locked ? {...item, x: item.x + dx, y: item.y + dy} : item))
      return
    }
    const changes = new Map<number, Partial<DotaCategory>>()
    selectedRef.current.forEach(index => {
      if (locked.has(index)) return
      const item = documentRef.current.configs[configIndex]?.categories[index]
      if (item) changes.set(index, {x_position: item.x_position + dx, y_position: item.y_position + dy})
    })
    if (changes.size) changeCategories(changes)
  }, [changeCategories, configIndex, locked, selectedReferenceId])

  const pasteCopiedCategories = useCallback(() => {
    const source = clipboardRef.current
    if (!source.length) return
    const items = source.map(item => ({...clone(item), x_position: item.x_position + 10, y_position: item.y_position + 10}))
    const start = documentRef.current.configs[configIndex].categories.length
    const nextSelection = items.map((_, index) => start + index)
    commit(current => ({...current, configs: current.configs.map((cfg, ci) => ci === configIndex ? {...cfg, categories: [...cfg.categories, ...items]} : cfg)}))
    selectedRef.current = nextSelection
    setSelected(nextSelection)
    setSelectedReferenceId(null)
    setStatus(`Pasted ${items.length} element${items.length === 1 ? '' : 's'}`)
  }, [commit, configIndex])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (traceOpenRef.current) return
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if (event.code === 'Space' && !editing) { event.preventDefault(); setSpaceDown(true) }
      if (editing) return
      if (matchesShortcut(event, keybindings.undo)) { event.preventDefault(); undo() }
      else if (matchesShortcut(event, keybindings.redo)) { event.preventDefault(); redo() }
      else if (matchesShortcut(event, keybindings.duplicate)) { event.preventDefault(); duplicateSelected() }
      else if (matchesShortcut(event, keybindings.copy)) {
        clipboardRef.current = selectedRef.current.map(index => clone(documentRef.current.configs[configIndex].categories[index]))
        const systemCopy = event.code === 'KeyC' && (event.ctrlKey || event.metaKey)
        if (!systemCopy) event.preventDefault()
        if (clipboardRef.current.length) setStatus(`Copied ${clipboardRef.current.length} element${clipboardRef.current.length === 1 ? '' : 's'}`)
      }
      else if (matchesShortcut(event, keybindings.paste)) {
        const systemPaste = event.code === 'KeyV' && (event.ctrlKey || event.metaKey)
        if (!systemPaste && clipboardRef.current.length) {
          event.preventDefault()
          pasteCopiedCategories()
        }
      }
      else if (matchesShortcut(event, keybindings.delete)) { event.preventDefault(); deleteSelected() }
      else if (matchesShortcut(event, keybindings['tool.select'])) { event.preventDefault(); setTool('select') }
      else if (matchesShortcut(event, keybindings['tool.symbol'])) { event.preventDefault(); setTool('symbol') }
      else if (matchesShortcut(event, keybindings['tool.pan'])) { event.preventDefault(); setTool('pan') }
      else if (event.key.startsWith('Arrow')) {
        event.preventDefault(); const step = event.shiftKey ? 10 : 1
        moveSelected(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)
      } else {
        const symbolIndex = palette.findIndex((_, index) => matchesShortcut(event, keybindings[`symbol.${index}` as CommandId]))
        if (symbolIndex >= 0) {
          event.preventDefault()
          setSymbol(palette[symbolIndex])
          setTool('symbol')
          setStatus(`Symbol “${palette[symbolIndex]}” selected`)
        }
      }
    }
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceDown(false) }
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp)
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp) }
  }, [configIndex, deleteSelected, duplicateSelected, keybindings, moveSelected, palette, pasteCopiedCategories, redo, undo])

  const openFile = async () => {
    try {
      const result = await openDotaJSON()
      if (!result) return
      loadFilePayload(result)
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
  }

  const openRecentFile = async (recentPath: string) => {
    try {
      loadFilePayload(await readDotaJSON(recentPath))
    } catch (error) {
      setRecentFiles(current => current.filter(item => item !== recentPath))
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const importDroppedDocument = (incoming: DotaDocument, fileName: string, sourcePath = '') => {
    if (!incoming.configs.length) throw new Error(`${fileName} does not contain any grids.`)
    const current = documentRef.current
    const pristine = !path && !dirty && current.configs.length === 1 && current.configs[0].categories.length === 0 && current.configs[0].config_name === 'Untitled Grid'
    if (pristine) {
      const next = clone(incoming)
      setDocument(next); documentRef.current = next; setConfigIndex(0); setSelected([]); setSelectedReferenceId(null)
      setHidden(new Set()); setLocked(new Set()); setPath(sourcePath); setDirty(!sourcePath); historyRef.current = {past: [], future: []}
      if (sourcePath) {
        setRecentFiles(current => [sourcePath, ...current.filter(item => item.toLowerCase() !== sourcePath.toLowerCase())].slice(0, 12))
      }
      setStatus(sourcePath ? `Opened ${sourcePath}` : `Loaded ${fileName} · Save will ask for a destination`)
      setView({x: 70, y: 55, zoom: 1})
      return
    }
    historyRef.current.past.push(clone(current))
    if (historyRef.current.past.length > 100) historyRef.current.past.shift()
    historyRef.current.future = []
    const firstImported = current.configs.length
    const next = {...current, configs: [...current.configs, ...clone(incoming.configs)]}
    documentRef.current = next
    setDocument(next); setConfigIndex(firstImported); setSelected([]); setSelectedReferenceId(null)
    setHidden(new Set()); setLocked(new Set()); setDirty(true)
    setStatus(`Imported ${incoming.configs.length} grid${incoming.configs.length === 1 ? '' : 's'} from ${fileName}`)
  }

  const addReferenceSource = async (name: string, src: string, point: {x: number; y: number}, offset: number) => {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error(`Could not decode ${name}`))
      image.src = src
    })
    const maxDimension = 600
    const scale = Math.min(1, maxDimension / Math.max(1, image.naturalWidth), maxDimension / Math.max(1, image.naturalHeight))
    const width = Math.max(10, image.naturalWidth * scale)
    const height = Math.max(10, image.naturalHeight * scale)
    const dota = screenToDotaPoint(point)
    const id = window.crypto.randomUUID()
    const reference: ReferenceImage = {
      id, name, src,
      x: dota.x - width / 2 + offset, y: dota.y - height / 2 + offset,
      width: formatNumber(width), height: formatNumber(height), layer: 'back', locked: false, opacity: .62,
    }
    referenceElementsRef.current.set(id, image)
    setReferenceImages(current => [...current, reference])
    setSelected([]); setSelectedReferenceId(id); setTool('select')
    setStatus(`Added reference ${name}`)
    return id
  }

  const addReferenceImage = async (file: File, point: {x: number; y: number}, offset: number) => {
    const src = URL.createObjectURL(file)
    try {
      return await addReferenceSource(file.name, src, point, offset)
    } catch (error) {
      URL.revokeObjectURL(src)
      throw error
    }
  }

  const canvasCenterPoint = () => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return {x: (rect?.width ?? 800) / 2, y: (rect?.height ?? 600) / 2}
  }

  const onTraceFilePicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      setTraceReferenceId(await addReferenceImage(file, canvasCenterPoint(), 0))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const insertTracedCategories = (items: DotaCategory[], options: {deleteReference: boolean}) => {
    const referenceId = traceReferenceId
    const start = documentRef.current.configs[configIndex]?.categories.length ?? 0
    if (items.length) {
      commit(current => ({...current, configs: current.configs.map((cfg, ci) => ci === configIndex ? {...cfg, categories: [...cfg.categories, ...items]} : cfg)}))
      const nextSelection = items.map((_, index) => start + index)
      selectedRef.current = nextSelection
      setSelected(nextSelection)
    }
    if (options.deleteReference && referenceId) removeReference(referenceId)
    setSelectedReferenceId(null)
    setTraceReferenceId(null)
    setTool('select')
    setStatus(`Inserted ${items.length} traced element${items.length === 1 ? '' : 's'}`)
  }

  useEffect(() => {
    const copy = (rawEvent: Event) => {
      const event = rawEvent as ClipboardEvent
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if (editing) return
      const items = selectedRef.current
        .map(index => documentRef.current.configs[configIndex]?.categories[index])
        .filter((item): item is DotaCategory => Boolean(item))
        .map(item => clone(item))
      if (!items.length) return
      clipboardRef.current = items
      event.preventDefault()
      event.clipboardData?.setData('text/plain', `Dota Grid Studio · ${items.length} copied element${items.length === 1 ? '' : 's'}`)
    }
    const paste = (rawEvent: Event) => {
      const event = rawEvent as ClipboardEvent
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if (editing) return
      const clipboard = event.clipboardData
      if (!clipboard) return
      const itemImages = Array.from(clipboard.items)
        .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      const images = itemImages.length
        ? itemImages
        : Array.from(clipboard.files).filter(file => file.type.startsWith('image/'))
      if (images.length) {
        event.preventDefault()
        const rect = canvasRef.current?.getBoundingClientRect()
        const point = {x: (rect?.width ?? 800) / 2, y: (rect?.height ?? 600) / 2}
        void (async () => {
          for (let index = 0; index < images.length; index++) {
            try {
              const source = images[index]
              const extension = source.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
              const file = source.name ? source : new File([source], `Clipboard image ${index + 1}.${extension}`, {type: source.type})
              await addReferenceImage(file, point, index * 20)
            } catch (error) {
              setStatus(error instanceof Error ? error.message : String(error))
            }
          }
        })()
        return
      }
      if (clipboardRef.current.length) {
        event.preventDefault()
        pasteCopiedCategories()
      }
    }
    window.addEventListener('copy', copy)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('copy', copy)
      window.removeEventListener('paste', paste)
    }
  }, [pasteCopiedCategories, view])

  const onFileDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dropDepthRef.current += 1
    setDropActive(true)
  }

  const onFileDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onFileDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1)
    if (dropDepthRef.current === 0) setDropActive(false)
  }

  const onFileDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dropDepthRef.current = 0
    setDropActive(false)
    if (hasNativeBackend()) return
    const files = Array.from(event.dataTransfer.files)
    if (!files.length) return
    const canvas = canvasRef.current
    const rect = canvas?.getBoundingClientRect()
    const point = rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
      ? {x: event.clientX - rect.left, y: event.clientY - rect.top}
      : {x: (rect?.width ?? 800) / 2, y: (rect?.height ?? 600) / 2}
    let imageOffset = 0
    for (const file of files) {
      try {
        if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
          await addReferenceImage(file, point, imageOffset)
          imageOffset += 20
        } else if (/\.json$/i.test(file.name) || file.type === 'application/json') {
          importDroppedDocument(normaliseDocument(JSON.parse(await file.text())), file.name)
        } else {
          setStatus(`Skipped unsupported file ${file.name}`)
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error))
      }
    }
  }

  const updateReference = (change: Partial<ReferenceImage>) => {
    if (!selectedReferenceId) return
    setReferenceImages(current => current.map(item => item.id === selectedReferenceId ? {...item, ...change} : item))
  }

  const moveReferenceLayer = (layer: ReferenceImage['layer']) => {
    if (!selectedReferenceId) return
    setReferenceImages(current => {
      const selectedItem = current.find(item => item.id === selectedReferenceId)
      if (!selectedItem) return current
      const rest = current.filter(item => item.id !== selectedReferenceId)
      const moved = {...selectedItem, layer}
      return layer === 'front' ? [...rest, moved] : [moved, ...rest]
    })
    setStatus(layer === 'front' ? 'Reference moved to top layer' : 'Reference moved to bottom layer')
  }

  nativeDropHandlerRef.current = (x, y, paths) => {
    void (async () => {
      dropDepthRef.current = 0
      setDropActive(false)
      const rect = canvasRef.current?.getBoundingClientRect()
      const point = rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        ? {x: x - rect.left, y: y - rect.top}
        : {x: (rect?.width ?? 800) / 2, y: (rect?.height ?? 600) / 2}
      let imageOffset = 0
      for (const droppedPath of paths) {
        const name = droppedPath.split(/[\\/]/).pop() || droppedPath
        try {
          if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(droppedPath)) {
            const image = await readReferenceImage(droppedPath)
            await addReferenceSource(image.name, image.dataURL, point, imageOffset)
            imageOffset += 20
          } else if (/\.json$/i.test(droppedPath)) {
            const payload = await readDotaJSON(droppedPath)
            importDroppedDocument(normaliseDocument(JSON.parse(payload.content)), name, payload.path)
          } else {
            setStatus(`Skipped unsupported file ${name}`)
          }
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error))
        }
      }
    })()
  }

  useEffect(() => {
    if (!hasNativeBackend()) return
    OnFileDrop((x, y, paths) => nativeDropHandlerRef.current(x, y, paths), false)
    return () => OnFileDropOff()
  }, [])

  const saveFile = async (choosePath = false) => {
    try {
      const savedPath = await saveDotaJSON(JSON.stringify(document, null, 4), path, choosePath)
      if (!savedPath) return
      setPath(savedPath); setRecentFiles(current => [savedPath, ...current.filter(item => item.toLowerCase() !== savedPath.toLowerCase())].slice(0, 12)); setDirty(false); setStatus(`Saved ${savedPath}`)
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
  }

  const exportImage = async () => {
    try {
      if (!categories.length) throw new Error('There is nothing to export in the current grid.')
      const visible = categories.filter((_, index) => !hidden.has(index))
      if (!visible.length) throw new Error('Every element in the current grid is hidden.')
      const measureCanvas = window.document.createElement('canvas')
      const measureContext = measureCanvas.getContext('2d')!
      const bounds = visible.map(item => getCategoryVisualBounds(measureContext, item, renderSettings))
      const minX = Math.min(...bounds.map(item => item.minX))
      const minY = Math.min(...bounds.map(item => item.minY))
      const maxX = Math.max(...bounds.map(item => item.maxX))
      const maxY = Math.max(...bounds.map(item => item.maxY))
      const scale = 2, padding = 32
      const output = window.document.createElement('canvas')
      output.width = Math.max(1, Math.ceil((maxX - minX) * scale + padding * 2))
      output.height = Math.max(1, Math.ceil((maxY - minY) * scale + padding * 2))
      const ctx = output.getContext('2d')!
      if (!renderSettings.transparentExport) {
        ctx.fillStyle = renderSettings.backgroundColor
        ctx.fillRect(0, 0, output.width, output.height)
      }
      categories.forEach((item, index) => {
        if (hidden.has(index)) return
        const x = (item.x_position - minX) * scale + padding, y = (item.y_position - minY) * scale + padding
        const width = item.width * scale, height = item.height * scale
        drawCategoryLabel(ctx, item, {x, y, width, height}, renderSettings)
      })
      const savedPath = await exportPNG(output.toDataURL('image/png'))
      if (savedPath) setStatus(`PNG exported to ${savedPath}`)
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
  }

  const newDocument = () => {
    const next = emptyDocument(); setDocument(next); documentRef.current = next; setConfigIndex(0); setSelected([]); setPath(''); setDirty(false)
    setHidden(new Set()); setLocked(new Set()); clearReferenceImages(); historyRef.current = {past: [], future: []}; setView({x: 90, y: 70, zoom: 1}); setStatus('New document')
  }

  const addConfig = () => {
    const name = `Grid ${document.configs.length + 1}`
    commit(current => ({...current, configs: [...current.configs, {config_name: name, categories: []}]}))
    setConfigIndex(document.configs.length); setSelected([])
  }

  const updatePrimary = (field: keyof DotaCategory, value: string) => {
    if (primaryIndex < 0) return
    const numeric = ['x_position', 'y_position', 'width', 'height'].includes(field as string)
    const parsed = numeric ? Number(value) : field === 'hero_ids' ? value.split(',').map(v => Number(v.trim())).filter(Number.isFinite) : value
    if (numeric && !Number.isFinite(parsed as number)) return
    changeCategories(new Map([[primaryIndex, {[field]: parsed}]]))
  }

  const addPaletteItem = () => {
    const item = paletteDraft.trim()
    if (!item) { setStatus('Palette item cannot be empty'); return }
    if (palette.includes(item)) { setStatus(`“${item}” is already in the palette`); return }
    if (palette.length >= 64) { setStatus('The palette is limited to 64 entries'); return }
    const nextPalette = [...palette, item]
    setPalette(nextPalette)
    setKeybindings(current => ({...keybindingsForPalette(nextPalette, current), [`symbol.${nextPalette.length - 1}`]: ''} as Keybindings))
    setPaletteDraft('')
    setSymbol(item)
    setTool('symbol')
    setStatus(`Added “${item}” to the palette`)
  }

  const removePaletteItem = (removeIndex: number) => {
    const removed = palette[removeIndex]
    const nextPalette = palette.filter((_, index) => index !== removeIndex)
    setKeybindings(current => {
      const next = keybindingsForPalette(nextPalette, current)
      nextPalette.forEach((_, newIndex) => {
        const oldIndex = newIndex < removeIndex ? newIndex : newIndex + 1
        next[`symbol.${newIndex}` as CommandId] = current[`symbol.${oldIndex}` as CommandId] ?? ''
      })
      return next
    })
    setPalette(nextPalette)
    if (symbol === removed) setSymbol(nextPalette[0] ?? '')
    setStatus(`Removed “${removed}” from the palette`)
  }

  const resetPalette = () => {
    setPalette([...defaultPalette])
    setKeybindings(current => {
      const editorBindings = Object.fromEntries(Object.entries(current).filter(([id]) => !id.startsWith('symbol.'))) as Partial<Keybindings>
      return keybindingsForPalette(defaultPalette, editorBindings)
    })
    if (!defaultPalette.includes(symbol)) setSymbol(defaultPalette[0])
    setPaletteDraft('')
    setStatus('Palette reset')
  }

  const filteredElements = useMemo(() => categories.map((item, index) => ({item, index})).filter(({item}) => item.category_name.toLowerCase().includes(search.toLowerCase())), [categories, search])

  return (
    <div className="app-shell" onDragEnter={onFileDragEnter} onDragOver={onFileDragOver} onDragLeave={onFileDragLeave} onDrop={onFileDrop}>
      <header className="titlebar">
        <div className="brand"><span className="brand-mark">D</span><span>DOTA GRID <b>STUDIO</b></span></div>
        <nav className="menu">
          <button onClick={newDocument}>New</button><button onClick={openFile}>Open</button><button onClick={() => saveFile(false)}>Save</button>
          <button onClick={() => saveFile(true)}>Export JSON</button><button onClick={exportImage}>Export PNG</button>
          <span className="menu-divider"/><button onClick={() => traceFileInputRef.current?.click()} title="Generate a symbol grid from an image">Trace image…</button>
          <span className="menu-divider"/><button onClick={undo}>Undo</button><button onClick={redo}>Redo</button><button onClick={() => setSettingsOpen(true)}>Settings</button>
        </nav>
        <input ref={traceFileInputRef} type="file" accept="image/*" hidden onChange={onTraceFilePicked}/>
        <div className="document-name">{dirty ? '● ' : ''}{path ? path.split(/[\\/]/).pop() : 'Untitled'}</div>
      </header>

      <main className="workspace">
        <aside className="left-panel panel">
          {recentFiles.length > 0 && <section className="panel-section recent-section">
            <div className="section-heading"><span>RECENT FILES</span><span className="count">{recentFiles.length}</span></div>
            <div className="recent-list">{recentFiles.slice(0, 5).map(recentPath => <button key={recentPath} onClick={() => openRecentFile(recentPath)} title={recentPath}><span>{recentPath.split(/[\\/]/).pop()}</span><small>{recentPath}</small></button>)}</div>
          </section>}
          <section className="panel-section configs-section">
            <div className="section-heading"><span>CONFIGS</span><button className="icon-button" onClick={addConfig} title="Add config">＋</button></div>
            <div className="config-list">
              {document.configs.map((item, index) => <button key={index} className={`config-item ${index === configIndex ? 'active' : ''}`} onClick={() => {setConfigIndex(index); setSelected([]); setSelectedReferenceId(null); setHidden(new Set()); setLocked(new Set())}}><span className="config-dot"/>{item.config_name}<small>{item.categories.length}</small></button>)}
            </div>
          </section>
          {referenceImages.length > 0 && <section className="panel-section references-section">
            <div className="section-heading"><span>REFERENCE IMAGES</span><span className="count">{referenceImages.length}</span></div>
            <div className="reference-list">{referenceImages.map(item => <button key={item.id} className={item.id === selectedReferenceId ? 'active' : ''} onClick={() => {setSelected([]); setSelectedReferenceId(item.id); setTool('select')}}><span title={item.name}>{item.name}</span><small>{item.locked ? 'LOCKED' : item.layer === 'front' ? 'TOP' : 'BOTTOM'}</small></button>)}</div>
          </section>}
          <section className="panel-section elements-section">
            <div className="section-heading"><span>ELEMENTS</span><span className="count">{categories.length}</span></div>
            <div className="search-wrap"><span>⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search symbols"/></div>
            <div className="element-list">
              {filteredElements.map(({item, index}) => <div key={index} className={`element-row ${selected.includes(index) ? 'selected' : ''}`} onClick={event => {setSelectedReferenceId(null); setSelected(event.ctrlKey || event.shiftKey ? (selected.includes(index) ? selected.filter(i => i !== index) : [...selected, index]) : [index])}}>
                <button className={`mini-toggle ${hidden.has(index) ? 'off' : ''}`} title="Visibility" onClick={event => {event.stopPropagation(); setHidden(current => {const next = new Set(current); next.has(index) ? next.delete(index) : next.add(index); return next})}}>{hidden.has(index) ? '○' : '●'}</button>
                <span className="element-symbol">{item.category_name || '∅'}</span><span className="element-coords">{formatNumber(item.x_position)}, {formatNumber(item.y_position)}</span>
                <button className={`mini-toggle ${locked.has(index) ? 'locked' : ''}`} title="Lock" onClick={event => {event.stopPropagation(); setLocked(current => {const next = new Set(current); next.has(index) ? next.delete(index) : next.add(index); return next})}}>{locked.has(index) ? '◆' : '◇'}</button>
              </div>)}
              {!filteredElements.length && <div className="empty-list">No elements yet.<br/>Choose Symbol and click the canvas.</div>}
            </div>
          </section>
        </aside>

        <section className="stage">
          <div className="toolbar">
            <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Select (V)">↖</button>
            <button className={tool === 'symbol' ? 'active' : ''} onClick={() => setTool('symbol')} title="Symbol tool">T</button>
            <button className={tool === 'pan' ? 'active' : ''} onClick={() => setTool('pan')} title="Pan (Space)">✥</button>
            <span className="toolbar-divider"/><button onClick={fitToContent} title="Fit to content">⌗</button>
          </div>
          <canvas ref={canvasRef} className={`canvas tool-${tool} ${spaceDown ? 'is-panning' : ''}`} onContextMenu={event => event.preventDefault()} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => finishPointerAction(true)} onPointerCancel={() => finishPointerAction(false)}/>
          <div className="canvas-hint">Drag empty space to select · Wheel to zoom · Middle mouse / Space to pan</div>
        </section>

        <aside className="right-panel panel">
          <section className="inspector-header"><span>INSPECTOR</span>{selected.length > 1 && <small>{selected.length} selected</small>}</section>
          {selectedReference ? <div className="inspector-body">
            <div className="reference-name"><span>REFERENCE IMAGE</span><b title={selectedReference.name}>{selectedReference.name}</b></div>
            <button className={`reference-lock-button ${selectedReference.locked ? 'active' : ''}`} onClick={() => {updateReference({locked: !selectedReference.locked}); setStatus(selectedReference.locked ? 'Reference unlocked' : 'Reference locked')}}>{selectedReference.locked ? '◆ Position locked' : '◇ Lock position'}</button>
            <Field label={`Opacity ${Math.round((selectedReference.opacity ?? .62) * 100)}%`}><input type="range" min="5" max="100" value={Math.round((selectedReference.opacity ?? .62) * 100)} onChange={event => updateReference({opacity: Number(event.target.value) / 100})}/></Field>
            <div className="field-grid"><Field label="X"><input disabled={selectedReference.locked} type="number" value={selectedReference.x} onChange={event => updateReference({x: Number(event.target.value) || 0})}/></Field><Field label="Y"><input disabled={selectedReference.locked} type="number" value={selectedReference.y} onChange={event => updateReference({y: Number(event.target.value) || 0})}/></Field></div>
            <div className="field-grid"><Field label="Width"><input disabled={selectedReference.locked} type="number" min="10" value={selectedReference.width} onChange={event => updateReference({width: Math.max(10, Number(event.target.value) || 10)})}/></Field><Field label="Height"><input disabled={selectedReference.locked} type="number" min="10" value={selectedReference.height} onChange={event => updateReference({height: Math.max(10, Number(event.target.value) || 10)})}/></Field></div>
            <div className="layer-actions"><button onClick={() => moveReferenceLayer('front')}>Bring to top</button><button onClick={() => moveReferenceLayer('back')}>Send to bottom</button></div>
            <button className="primary-button trace-button" onClick={() => setTraceReferenceId(selectedReference.id)}>Generate grid from image</button>
            <button className="danger-button" onClick={deleteSelected}>Delete reference</button>
          </div> : primary ? <div className="inspector-body">
            <Field label="Category name"><input value={primary.category_name} onChange={event => updatePrimary('category_name', event.target.value)}/></Field>
            <div className="field-grid"><Field label="X"><input type="number" value={primary.x_position} onChange={event => updatePrimary('x_position', event.target.value)}/></Field><Field label="Y"><input type="number" value={primary.y_position} onChange={event => updatePrimary('y_position', event.target.value)}/></Field></div>
            <div className="field-grid"><Field label="Width"><input type="number" min="1" value={primary.width} onChange={event => updatePrimary('width', event.target.value)}/></Field><Field label="Height"><input type="number" min="1" value={primary.height} onChange={event => updatePrimary('height', event.target.value)}/></Field></div>
            <Field label="Hero IDs"><input value={primary.hero_ids.join(', ')} placeholder="e.g. 1, 2, 3" onChange={event => updatePrimary('hero_ids', event.target.value)}/></Field>
            <button className="danger-button" onClick={deleteSelected}>Delete selection</button>
          </div> : <div className="no-selection"><div className="selection-icon">⌁</div><b>Nothing selected</b><span>Click an element on the canvas<br/>to inspect its properties.</span></div>}

          <section className="properties-section">
            <div className="section-heading"><span>SYMBOL PALETTE</span></div>
            <div className="symbol-palette">{palette.map((item, index) => <button key={`${index}:${item}`} title={keybindings[`symbol.${index}` as CommandId]} className={symbol === item ? 'active' : ''} onClick={() => {setSymbol(item); setTool('symbol')}}><span>{item}</span><kbd>{keybindings[`symbol.${index}` as CommandId]}</kbd></button>)}</div>
          </section>
          <section className="properties-section canvas-settings">
            <div className="section-heading"><span>CANVAS</span></div>
            <label className="check-row"><input type="checkbox" checked={showGrid} onChange={event => setShowGrid(event.target.checked)}/><span>Show grid</span></label>
            <label className="check-row"><input type="checkbox" checked={renderSettings.glow} onChange={event => updateRenderSetting('glow', event.target.checked)}/><span>Glow</span></label>
          </section>
        </aside>
      </main>

      {dropActive && <div className="drop-overlay"><div><b>DROP FILES</b><span>JSON adds grids · images become temporary references</span></div></div>}

      {traceReference && traceImageElement && <TraceModal
        target={traceReference}
        image={traceImageElement}
        background={renderSettings.backgroundColor}
        onClose={() => setTraceReferenceId(null)}
        onInsert={insertTracedCategories}
      />}

      {settingsOpen && <div className="modal-backdrop" onPointerDown={event => {if (event.target === event.currentTarget) setSettingsOpen(false)}}>
        <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Application settings">
          <header className="settings-title"><div><span>SETTINGS</span><b>Dota Grid Studio preferences</b></div><button onClick={() => setSettingsOpen(false)}>×</button></header>
          <nav className="settings-tabs"><button className={settingsPage === 'render' ? 'active' : ''} onClick={() => setSettingsPage('render')}>Renderer</button><button className={settingsPage === 'palette' ? 'active' : ''} onClick={() => setSettingsPage('palette')}>Palette</button><button className={settingsPage === 'keybindings' ? 'active' : ''} onClick={() => setSettingsPage('keybindings')}>Key bindings</button></nav>
          {settingsPage === 'render' ? <div className="settings-content">
            <div className="settings-group">
              <h3>Dota renderer</h3>
              <div className="locked-renderer"><span className="font-sample">Aa Бб :=/\|</span><div><b>Radiance SemiBold</b><small>Exact Hero Grid style · 16px · 2px tracking · uppercase</small></div><em>LOCKED</em></div>
              <p className="settings-note">Typography is fixed to the values from Dota's <code>#HeroCategoryName</code>. This keeps the editor, PNG export and headless renderer consistent with the game.</p>
              <label className="check-row settings-check important-toggle"><input type="checkbox" checked={renderSettings.glow} onChange={event => updateRenderSetting('glow', event.target.checked)}/><span><b>Enable additional glow</b><small>Off is the accurate Dota-style default</small></span></label>
              <Field label={`Glow strength · ${renderSettings.glowStrength}px`}><input type="range" min="0" max="24" step="1" disabled={!renderSettings.glow} value={renderSettings.glowStrength} onChange={event => updateRenderSetting('glowStrength', Number(event.target.value))}/></Field>
            </div>
            <div className="settings-group">
              <h3>Editor &amp; export</h3>
              <div className="color-grid two"><ColorField label="Background" value={renderSettings.backgroundColor} onChange={value => updateRenderSetting('backgroundColor', value)}/><ColorField label="Grid" value={renderSettings.gridColor} onChange={value => updateRenderSetting('gridColor', value)}/></div>
              <label className="check-row settings-check"><input type="checkbox" checked={renderSettings.showElementBounds} onChange={event => updateRenderSetting('showElementBounds', event.target.checked)}/><span>Show category rectangles</span></label>
              <label className="check-row settings-check"><input type="checkbox" checked={renderSettings.transparentExport} onChange={event => updateRenderSetting('transparentExport', event.target.checked)}/><span>Transparent PNG background</span></label>
              <div className="settings-location"><span>Settings file</span><code>{settingsPath || 'Browser preview storage'}</code></div>
            </div>
          </div> : settingsPage === 'palette' ? <div className="palette-settings-page">
            <div className="keybindings-help">Add any symbol or complete string. New entries are saved beside the executable and can receive a shortcut on the Key bindings tab.</div>
            <div className="palette-add-row"><input autoFocus value={paletteDraft} maxLength={80} placeholder="Symbol or string" onChange={event => setPaletteDraft(event.target.value)} onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault(); addPaletteItem()}}}/><button className="primary-button" onClick={addPaletteItem}>Add to palette</button></div>
            <div className="palette-settings-list">{palette.map((item, index) => <div className="palette-settings-row" key={`${index}:${item}`}><span className="palette-preview">{item}</span><code>{keybindings[`symbol.${index}` as CommandId] || 'Unassigned'}</code><button title={`Remove ${item}`} onClick={() => removePaletteItem(index)}>×</button></div>)}</div>
            {!palette.length && <div className="empty-list">The palette is empty. Add a symbol or string above.</div>}
          </div> : <div className="keybindings-page">
            <div className="keybindings-help">Click a shortcut and press a new combination. Backspace clears it. Duplicate shortcuts are highlighted.</div>
            {(['Editor', 'Tools', 'Symbols'] as const).map(group => <section className="binding-group" key={group}><h3>{group}</h3><div className="binding-grid">{commandLabels.filter(command => command.group === group).map(command => {
              const shortcut = keybindings[command.id]
              const conflict = shortcut !== '' && Object.values(keybindings).filter(value => value.toLowerCase() === shortcut.toLowerCase()).length > 1
              return <label className={`binding-row ${conflict ? 'conflict' : ''}`} key={command.id}><span>{command.label}</span><input readOnly value={shortcut || 'Unassigned'} onKeyDown={event => {
                event.preventDefault(); event.stopPropagation()
                if (event.code === 'Backspace' || event.code === 'Delete') updateBinding(command.id, '')
                else { const next = shortcutFromEvent(event.nativeEvent); if (next) updateBinding(command.id, next) }
              }}/></label>
            })}</div></section>)}
          </div>}
          <footer className="settings-actions"><button className="secondary-button" onClick={() => settingsPage === 'render' ? setRenderSettings({...defaultRenderSettings}) : settingsPage === 'palette' ? resetPalette() : setKeybindings(keybindingsForPalette(palette))}>Reset {settingsPage === 'render' ? 'renderer' : settingsPage === 'palette' ? 'palette' : 'bindings'}</button><button className="primary-button" onClick={() => setSettingsOpen(false)}>Done</button></footer>
        </section>
      </div>}

      <footer className="statusbar"><span className="status-message">{status}</span><span>Tool: {tool}</span><span ref={cursorReadoutRef}>X 0 &nbsp; Y 0</span><span>{Math.round(view.zoom * 100)}%</span><span>v{document.version}</span></footer>
    </div>
  )
}

function Field({label, children}: {label: string; children: React.ReactNode}) {
  return <label className="field"><span>{label}</span>{children}</label>
}

function ColorField({label, value, onChange}: {label: string; value: string; onChange: (value: string) => void}) {
  return <label className="color-field"><span>{label}</span><div><input type="color" value={value} onChange={event => onChange(event.target.value)}/><code>{value}</code></div></label>
}

export default App
