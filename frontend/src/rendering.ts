import {DotaCategory} from './model'

export type RenderSettings = {
  glow: boolean
  glowStrength: number
  backgroundColor: string
  gridColor: string
  showElementBounds: boolean
  transparentExport: boolean
}

export const defaultRenderSettings: RenderSettings = {
  glow: false,
  glowStrength: 6,
  backgroundColor: '#0d0f13',
  gridColor: '#20242b',
  showElementBounds: false,
  transparentExport: true,
}

export const DOTA_LABEL_STYLE = {
  family: 'DotaRadiance',
  size: 16,
  weight: 600,
  letterSpacing: 2,
  paddingLeft: 4,
  controlHeight: 20,
  color: '#808fa6',
  shadowBlur: 4,
  shadowX: 2,
  shadowY: 2,
} as const

export type RenderBox = {x: number; y: number; width: number; height: number}

export function renderedLabel(category: DotaCategory) {
  return category.category_name.toLocaleUpperCase()
}

function boxScale(category: DotaCategory, box: RenderBox) {
  return Math.abs(category.height) > .0001 ? Math.abs(box.height / category.height) : 1
}

function setDotaFont(ctx: CanvasRenderingContext2D, scale: number) {
  ctx.font = `${DOTA_LABEL_STYLE.weight} ${DOTA_LABEL_STYLE.size * scale}px "${DOTA_LABEL_STYLE.family}", Arial, sans-serif`
}

function measureLetterspaced(ctx: CanvasRenderingContext2D, text: string, spacing: number) {
  const characters = Array.from(text)
  return characters.reduce((width, character) => width + ctx.measureText(character).width, 0) + Math.max(0, characters.length - 1) * spacing
}

function fillLetterspaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  let cursor = x
  for (const character of Array.from(text)) {
    ctx.fillText(character, cursor, y)
    cursor += ctx.measureText(character).width + spacing
  }
}

export function drawCategoryLabel(
  ctx: CanvasRenderingContext2D,
  category: DotaCategory,
  box: RenderBox,
  settings: RenderSettings,
  color: string = DOTA_LABEL_STYLE.color,
) {
  const scale = boxScale(category, box)
  const x = box.x + DOTA_LABEL_STYLE.paddingLeft * scale
  const y = box.y + DOTA_LABEL_STYLE.controlHeight * scale / 2
  const spacing = DOTA_LABEL_STYLE.letterSpacing * scale
  const label = renderedLabel(category)

  ctx.save()
  setDotaFont(ctx, scale)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  if (settings.glow) {
    ctx.fillStyle = color
    ctx.globalAlpha = .7
    ctx.shadowColor = color
    ctx.shadowBlur = settings.glowStrength * scale
    fillLetterspaced(ctx, label, x, y, spacing)
    ctx.globalAlpha = 1
  }

  ctx.fillStyle = color
  ctx.shadowColor = 'rgba(0, 0, 0, .27)'
  ctx.shadowBlur = DOTA_LABEL_STYLE.shadowBlur * scale
  ctx.shadowOffsetX = DOTA_LABEL_STYLE.shadowX * scale
  ctx.shadowOffsetY = DOTA_LABEL_STYLE.shadowY * scale
  fillLetterspaced(ctx, label, x, y, spacing)
  ctx.restore()
}

export function getCategoryVisualBounds(ctx: CanvasRenderingContext2D, category: DotaCategory, settings: RenderSettings) {
  const layout = getCategoryLayoutBounds(ctx, category)
  const glow = settings.glow ? settings.glowStrength : 0
  const shadow = DOTA_LABEL_STYLE.shadowBlur + Math.max(DOTA_LABEL_STYLE.shadowX, DOTA_LABEL_STYLE.shadowY)
  const effect = Math.max(glow, shadow)
  return {
    minX: layout.minX - effect,
    minY: layout.minY - effect,
    maxX: layout.maxX + effect,
    maxY: layout.maxY + effect,
  }
}

export function getCategoryIntrinsicSize(ctx: CanvasRenderingContext2D, label: string) {
  setDotaFont(ctx, 1)
  const labelWidth = measureLetterspaced(ctx, label.toLocaleUpperCase(), DOTA_LABEL_STYLE.letterSpacing)
  return {width: DOTA_LABEL_STYLE.paddingLeft + labelWidth, height: DOTA_LABEL_STYLE.controlHeight}
}

export function getCategoryLayoutBounds(ctx: CanvasRenderingContext2D, category: DotaCategory) {
  const intrinsic = getCategoryIntrinsicSize(ctx, renderedLabel(category))
  const textLeft = category.x_position + DOTA_LABEL_STYLE.paddingLeft
  const textTop = category.y_position + (DOTA_LABEL_STYLE.controlHeight - DOTA_LABEL_STYLE.size) / 2
  return {
    minX: Math.min(category.x_position, textLeft),
    minY: Math.min(category.y_position, textTop),
    maxX: Math.max(category.x_position + category.width, category.x_position + intrinsic.width),
    maxY: Math.max(category.y_position + category.height, textTop + DOTA_LABEL_STYLE.size),
  }
}
