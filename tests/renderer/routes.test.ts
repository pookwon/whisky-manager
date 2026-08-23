import { describe, expect, it } from 'vitest'
import { DEFAULT_ROUTE, automationOf, routeKey, type Route } from '../../src/renderer/routes.js'

describe('routes', () => {
  it('starts on the dashboard', () => {
    expect(DEFAULT_ROUTE).toEqual({ kind: 'dashboard' })
  })

  it('gives each route a stable key', () => {
    const route: Route = { kind: 'automation', id: 'welcome-comment', panel: 'templates' }
    expect(routeKey(route)).toBe('automation:welcome-comment:templates')
    expect(routeKey({ kind: 'dashboard' })).toBe('dashboard')
    expect(routeKey({ kind: 'commonSettings' })).toBe('commonSettings')
  })

  it('distinguishes panels of the same automation', () => {
    const approvals = routeKey({ kind: 'automation', id: 'a', panel: 'approvals' })
    const templates = routeKey({ kind: 'automation', id: 'a', panel: 'templates' })
    expect(approvals).not.toBe(templates)
  })

  it('distinguishes the same panel of different automations', () => {
    const first = routeKey({ kind: 'automation', id: 'a', panel: 'settings' })
    const second = routeKey({ kind: 'automation', id: 'b', panel: 'settings' })
    expect(first).not.toBe(second)
  })

  it('names the automation a route belongs to', () => {
    expect(automationOf({ kind: 'automation', id: 'welcome-comment', panel: 'approvals' })).toBe(
      'welcome-comment',
    )
  })

  it('returns null for app-wide routes', () => {
    expect(automationOf({ kind: 'dashboard' })).toBeNull()
    expect(automationOf({ kind: 'commonSettings' })).toBeNull()
  })
})
