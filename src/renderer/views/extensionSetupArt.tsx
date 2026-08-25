import type { ExtensionSetupStepKey } from '../../shared/text.js'

/**
 * A drawing of Chrome for each step of the walkthrough.
 *
 * Drawn rather than photographed on purpose. A screenshot of Chrome is a
 * screenshot of one Chrome — one language, one theme, one version — and it ages
 * into a picture that no longer matches what the operator is looking at. These
 * carry only what the step asks them to find: where the control is, and what it
 * says. They also follow the app's own palette, so they read in either theme.
 *
 * Everything is in one 520×160 frame so the dialog does not jump in height as
 * the operator steps through it.
 */

const FRAME = { fill: 'var(--surface-sunken)', stroke: 'var(--line)' } as const
const RAISED = { fill: 'var(--surface-raised)', stroke: 'var(--line)' } as const
const SUNKEN = { fill: 'var(--surface-sunken)', stroke: 'var(--line)' } as const
const HIGHLIGHT = { fill: 'var(--accent-soft)', stroke: 'var(--accent)' } as const
const OUTLINE = { fill: 'none', stroke: 'var(--line)' } as const
const INK = { fill: 'var(--ink)' } as const
const MUTED = { fill: 'var(--ink-muted)' } as const
const ACCENT = { fill: 'var(--accent)' } as const
const ON_ACCENT = { fill: 'var(--surface-raised)' } as const

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const CHEVRON = { fill: 'none', stroke: 'var(--ink-muted)' } as const

/** One baseline for all three chips, so the row does not read as ragged. */
const CHIP_LABEL_Y = 100

function Frame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg viewBox="0 0 520 160" className="w-full" aria-hidden="true">
      <rect x="0.75" y="0.75" width="518.5" height="158.5" rx="11" style={FRAME} strokeWidth="1.5" />
      {children}
    </svg>
  )
}

/** A folder with the one file Chrome insists on seeing inside it. */
function FolderArt(): React.JSX.Element {
  return (
    <Frame>
      <path
        d="M176 30 h44 l10 12 h114 a8 8 0 0 1 8 8 v68 a8 8 0 0 1 -8 8 H176 a8 8 0 0 1 -8 -8 V38 a8 8 0 0 1 8 -8 z"
        style={HIGHLIGHT}
        strokeWidth="1.5"
      />
      <rect x="204" y="62" width="112" height="40" rx="6" style={RAISED} strokeWidth="1.5" />
      <text x="260" y="87" textAnchor="middle" fontSize="13" fontFamily={MONO} style={INK}>
        manifest.json
      </text>
    </Frame>
  )
}

/** The address to type, and the switch to find once it is open. */
function DevModeArt(): React.JSX.Element {
  return (
    <Frame>
      <rect x="40" y="30" width="440" height="34" rx="17" style={RAISED} strokeWidth="1.5" />
      <circle cx="62" cy="47" r="6" style={MUTED} />
      <text x="80" y="52" fontSize="13" fontFamily={MONO} style={INK}>
        chrome://extensions
      </text>

      <rect x="40" y="82" width="440" height="48" rx="10" style={RAISED} strokeWidth="1.5" />
      <text x="62" y="112" fontSize="13" fontWeight="600" style={INK}>
        확장 프로그램
      </text>
      <text x="386" y="112" textAnchor="end" fontSize="12" style={MUTED}>
        개발자 모드
      </text>
      <rect x="398" y="95" width="44" height="22" rx="11" style={ACCENT} />
      <circle cx="431" cy="106" r="8" style={ON_ACCENT} />
    </Frame>
  )
}

/** The button that takes the folder, and the drop that does the same thing. */
function LoadArt(): React.JSX.Element {
  return (
    <Frame>
      <rect x="40" y="26" width="440" height="44" rx="10" style={RAISED} strokeWidth="1.5" />
      <rect x="54" y="36" width="208" height="24" rx="6" style={HIGHLIGHT} strokeWidth="1.5" />
      <text x="158" y="52" textAnchor="middle" fontSize="11" style={{ fill: 'var(--accent)' }}>
        압축해제된 확장 프로그램을 로드
      </text>
      <rect x="272" y="36" width="112" height="24" rx="6" style={OUTLINE} strokeWidth="1.5" />
      <text x="328" y="52" textAnchor="middle" fontSize="11" style={MUTED}>
        확장 프로그램 압축
      </text>
      <rect x="394" y="36" width="72" height="24" rx="6" style={OUTLINE} strokeWidth="1.5" />
      <text x="430" y="52" textAnchor="middle" fontSize="11" style={MUTED}>
        업데이트
      </text>

      <rect
        x="40"
        y="84"
        width="440"
        height="48"
        rx="10"
        style={OUTLINE}
        strokeWidth="1.5"
        strokeDasharray="6 5"
      />
      <rect x="104" y="95" width="14" height="6" rx="2" style={HIGHLIGHT} strokeWidth="1.5" />
      <rect x="104" y="99" width="32" height="22" rx="4" style={HIGHLIGHT} strokeWidth="1.5" />
      <text x="150" y="114" fontSize="12" style={MUTED}>
        폴더를 끌어다 놓아도 됩니다
      </text>
    </Frame>
  )
}

/** The extension's own options page, which is where the token goes. */
function TokenArt(): React.JSX.Element {
  return (
    <Frame>
      <rect x="60" y="22" width="400" height="116" rx="10" style={RAISED} strokeWidth="1.5" />
      <text x="84" y="50" fontSize="13" fontWeight="600" style={INK}>
        페어링 토큰
      </text>
      <rect x="84" y="62" width="352" height="30" rx="6" style={SUNKEN} strokeWidth="1.5" />
      <text x="98" y="83" fontSize="12" fontFamily={MONO} style={MUTED}>
        ••••••••••••••••••••••••
      </text>
      <rect x="84" y="102" width="60" height="24" rx="6" style={ACCENT} />
      <text x="114" y="118" textAnchor="middle" fontSize="11" style={ON_ACCENT}>
        저장
      </text>
    </Frame>
  )
}

/** The three things the confirmation opens, in the order it opens them. */
function LaunchArt(): React.JSX.Element {
  return (
    <Frame>
      <rect x="40" y="46" width="124" height="68" rx="10" style={RAISED} strokeWidth="1.5" />
      <rect x="88" y="56" width="12" height="6" rx="2" style={HIGHLIGHT} strokeWidth="1.5" />
      <rect x="88" y="60" width="28" height="22" rx="4" style={HIGHLIGHT} strokeWidth="1.5" />
      <text x="102" y={CHIP_LABEL_Y} textAnchor="middle" fontSize="12" style={INK}>
        확장 폴더
      </text>

      <path d="M177 74 l8 6 l-8 6" style={CHEVRON} strokeWidth="2" />

      <rect x="198" y="46" width="124" height="68" rx="10" style={RAISED} strokeWidth="1.5" />
      <rect x="246" y="56" width="18" height="22" rx="3" style={HIGHLIGHT} strokeWidth="1.5" />
      <rect x="254" y="60" width="18" height="22" rx="3" style={RAISED} strokeWidth="1.5" />
      <text x="260" y={CHIP_LABEL_Y} textAnchor="middle" fontSize="12" style={INK}>
        주소 복사
      </text>

      <path d="M335 74 l8 6 l-8 6" style={CHEVRON} strokeWidth="2" />

      <rect x="356" y="46" width="124" height="68" rx="10" style={RAISED} strokeWidth="1.5" />
      <circle cx="418" cy="69" r="12" style={HIGHLIGHT} strokeWidth="1.5" />
      <circle cx="418" cy="69" r="5" style={RAISED} strokeWidth="1.5" />
      <text x="418" y={CHIP_LABEL_Y} textAnchor="middle" fontSize="12" style={INK}>
        Chrome
      </text>
    </Frame>
  )
}

/**
 * Indexed by step key rather than by position: a step added to the wording with
 * no drawing here is a compile error, not a blank panel on the screen.
 */
export const EXTENSION_SETUP_ART: Record<ExtensionSetupStepKey, () => React.JSX.Element> = {
  folder: FolderArt,
  devMode: DevModeArt,
  load: LoadArt,
  token: TokenArt,
  launch: LaunchArt,
}
