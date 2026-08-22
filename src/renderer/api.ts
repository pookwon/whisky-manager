import type { RendererApi } from '../desktop/ipc.js'

declare global {
  interface Window {
    readonly wm: RendererApi
  }
}

export const api: RendererApi = window.wm
