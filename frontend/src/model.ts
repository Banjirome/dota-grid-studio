export type DotaCategory = {
  category_name: string
  x_position: number
  y_position: number
  width: number
  height: number
  hero_ids: unknown[]
  [key: string]: unknown
}

export type DotaConfig = {
  config_name: string
  categories: DotaCategory[]
  [key: string]: unknown
}

export type DotaDocument = {
  version: number
  configs: DotaConfig[]
  [key: string]: unknown
}

export type Calibration = {scaleX: number; scaleY: number; offsetX: number; offsetY: number}
export const defaultCalibration: Calibration = {scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0}

export function dotaToCanvas(x: number, y: number, calibration: Calibration) {
  return {x: x * calibration.scaleX + calibration.offsetX, y: y * calibration.scaleY + calibration.offsetY}
}

export function canvasToDota(x: number, y: number, calibration: Calibration) {
  return {x: (x - calibration.offsetX) / calibration.scaleX, y: (y - calibration.offsetY) / calibration.scaleY}
}

export const emptyDocument = (): DotaDocument => ({version: 3, configs: [{config_name: 'Untitled Grid', categories: []}]})

export function normaliseDocument(value: unknown): DotaDocument {
  if (!value || typeof value !== 'object') throw new Error('The JSON root must be an object.')
  const root = value as Record<string, unknown>
  if (typeof root.version !== 'number') throw new Error('version must be a number.')
  if (!Array.isArray(root.configs)) throw new Error('configs must be an array.')
  root.configs.forEach((candidate, ci) => {
    if (!candidate || typeof candidate !== 'object') throw new Error(`configs[${ci}] must be an object.`)
    const config = candidate as Record<string, unknown>
    if (typeof config.config_name !== 'string') throw new Error(`configs[${ci}].config_name must be a string.`)
    if (!Array.isArray(config.categories)) throw new Error(`configs[${ci}].categories must be an array.`)
    config.categories.forEach((item, ei) => {
      const category = item as Record<string, unknown>
      if (!category || typeof category !== 'object') throw new Error(`Category ${ei + 1} must be an object.`)
      if (typeof category.category_name !== 'string') throw new Error(`Category ${ei + 1}: category_name must be a string.`)
      for (const field of ['x_position', 'y_position', 'width', 'height']) {
        if (typeof category[field] !== 'number') throw new Error(`Category ${ei + 1}: ${field} must be a number.`)
      }
      if (!Array.isArray(category.hero_ids)) throw new Error(`Category ${ei + 1}: hero_ids must be an array.`)
    })
  })
  return value as DotaDocument
}
