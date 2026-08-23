import type { AutomationPanel } from '../shared/automations/catalog.js'

export type Route =
  | { readonly kind: 'dashboard' }
  | { readonly kind: 'automation'; readonly id: string; readonly panel: AutomationPanel }
  | { readonly kind: 'commonSettings' }

export const DEFAULT_ROUTE: Route = { kind: 'dashboard' }

/** Stable identity for React keys and for deciding whether a route changed. */
export function routeKey(route: Route): string {
  return route.kind === 'automation' ? `automation:${route.id}:${route.panel}` : route.kind
}

/** The automation a route's data belongs to, or null for app-wide screens. */
export function automationOf(route: Route): string | null {
  return route.kind === 'automation' ? route.id : null
}
