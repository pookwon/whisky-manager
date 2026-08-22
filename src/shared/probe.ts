/**
 * Diagnostic fetch through the extension's session. It exists because naver's
 * cafe endpoints are private and undocumented: the markup and responses have to
 * be observed from a logged-in session, both to build the parsers and to
 * diagnose the breakage 5.7 anticipates when naver changes them.
 *
 * It is deliberately narrow. The extension holds a live login, so an unbounded
 * probe would be a general-purpose session-borrowing tool; these two hosts are
 * exactly the ones the manifest already grants.
 */
const PROBE_HOSTS = new Set(['cafe.naver.com', 'apis.naver.com'])

export function isProbeTarget(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && PROBE_HOSTS.has(parsed.hostname)
}

/**
 * The cafe's legacy pages are served as MS949, a label TextDecoder rejects.
 * `euc-kr` is the standard label for the same windows-949 decoder, so the
 * mapping is a rename, not a substitution.
 */
const KOREAN_LEGACY_LABELS = new Set(['ms949', 'cp949', 'x-windows-949'])

export function charsetFromContentType(contentType: string | null): string {
  const match = /charset=([^;\s]+)/i.exec(contentType ?? '')
  const label = (match?.[1] ?? 'utf-8').toLowerCase().replace(/^["']|["']$/g, '')
  return KOREAN_LEGACY_LABELS.has(label) ? 'euc-kr' : label
}
