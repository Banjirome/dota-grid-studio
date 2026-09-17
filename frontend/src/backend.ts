export type FilePayload = {path: string; content: string}
export type LaunchOptions = {openPath: string; settingsPath: string}
export type ReferenceImagePayload = {name: string; dataURL: string}
type Backend = {
  OpenDotaJSON(): Promise<FilePayload | null>
  ReadDotaJSON(path: string): Promise<FilePayload>
  ReadReferenceImage(path: string): Promise<ReferenceImagePayload>
  SaveDotaJSON(content: string, currentPath: string, choosePath: boolean): Promise<string>
  ExportPNG(dataURL: string): Promise<string>
  GetLaunchOptions(): Promise<LaunchOptions>
  LoadAppSettings(): Promise<string>
  SaveAppSettings(content: string): Promise<void>
}

declare global { interface Window { go?: {main?: {App?: Backend}} } }

function api(): Backend {
  const backend = window.go?.main?.App
  if (!backend) throw new Error('Native file dialogs are available when launched through Wails.')
  return backend
}

export const openDotaJSON = () => api().OpenDotaJSON()
export const readDotaJSON = (path: string) => api().ReadDotaJSON(path)
export const readReferenceImage = (path: string) => api().ReadReferenceImage(path)
export const saveDotaJSON = (content: string, currentPath: string, choosePath: boolean) => api().SaveDotaJSON(content, currentPath, choosePath)
export const exportPNG = (dataURL: string) => api().ExportPNG(dataURL)
export const getLaunchOptions = () => api().GetLaunchOptions()
export const loadAppSettings = () => api().LoadAppSettings()
export const saveAppSettings = (content: string) => api().SaveAppSettings(content)
export const hasNativeBackend = () => Boolean(window.go?.main?.App)
