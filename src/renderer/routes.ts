import type { AutomationPanel } from '../shared/automations/catalog.js'

/** The board collection's own screens, the way an automation has panels. */
export type CollectionPanel = 'status' | 'settings'

export type Route =
  | { readonly kind: 'dashboard' }
  | { readonly kind: 'automation'; readonly id: string; readonly panel: AutomationPanel }
  | { readonly kind: 'collection'; readonly panel: CollectionPanel }
  | { readonly kind: 'commonSettings' }

export const DEFAULT_ROUTE: Route = { kind: 'dashboard' }

/** Stable identity for React keys and for deciding whether a route changed. */
export function routeKey(route: Route): string {
  if (route.kind === 'automation') return `automation:${route.id}:${route.panel}`
  if (route.kind === 'collection') return `collection:${route.panel}`
  return route.kind
}

/** The automation a route's data belongs to, or null for app-wide screens. */
export function automationOf(route: Route): string | null {
  return route.kind === 'automation' ? route.id : null
}
