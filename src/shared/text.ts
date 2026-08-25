import type { RiskFlag } from './types.js'

/**
 * Every risk flag has a label, enforced by the compiler rather than by anyone
 * remembering. Adding a flag to `RiskFlag` without naming it here fails the
 * build, instead of reaching the approval queue as a raw enum name.
 */
const RISK_LABEL: Record<RiskFlag, string> = {
  VARIABLE_EXTRACTION_FAILED: '치환 실패',
  STRUCTURE_CHANGED: '구조 변경',
  ENDPOINT_MISMATCH: '엔드포인트 불일치',
  COMMENT_CHECK_FAILED: '댓글 확인 실패',
  AUTHOR_UNKNOWN: '작성자 미상',
}

/**
 * Every word the tool says to its operator, in one place.
 *
 * The app manages one Korean cafe and has never had a second locale, so the
 * strings are simply the strings — no key indirection, no runtime lookup, no
 * translation library. What that buys is the compiler: `TEXT.run.confrim` is a
 * build error, where `t('run.confrim')` used to reach the screen as its own key.
 *
 * Text that takes a value is a function for the same reason. Forgetting the
 * value cannot leave `{{count}}` on screen, because it will not compile — which
 * is the failure the old wording tests existed to catch at runtime.
 *
 * Lives in `shared` because three surfaces speak to the operator: the renderer,
 * the tray menu in the main process, and anything else that has to name the app.
 */
export const TEXT = {
  app: {
    title: '카페 관리',
    actionFailed: (message: string) => `작업이 실패했습니다: ${message}`,
  },
  nav: {
    dashboard: '대시보드',
    approvals: '승인 큐',
    templates: '문구',
    settings: '자동화 설정',
    commonSettings: '카페 · 계정 설정',
    common: '공통',
  },
  automation: {
    welcomeComment: '환영 댓글',
  },
  dashboard: {
    heading: '대시보드',
    automations: '기능별 상태',
    awaitingShort: (count: number) => `대기 ${count}건`,
  },
  status: {
    bridgeConnected: '연결됨',
    bridgeReconnecting: '연결 대기 중',
    bridgeOffline: '끊김',
    running: '동작 중',
    stopped: '정지',
    start: '시작',
    stop: '중지',
    kill: '전면 정지',
    runOnce: '지금 한 번 실행',
  },
  stats: {
    executedToday: '오늘 실행',
    succeededToday: '성공',
    failedToday: '실패',
    awaiting: '승인 대기',
  },
  outcome: {
    heading: '마지막 세션',
    never: '아직 한 번도 실행하지 않았습니다',
    neverWithCurrentConfig: '아직 이번 설정으로 돈 적 없습니다',
    ran: (count: number) => `${count}건 처리했습니다`,
    ranWithFailures: (count: number) => `${count}건 실패했습니다`,
    /**
     * Keyed by `SessionRefusal`. Indexing this with a refusal reason is what
     * type-checks the set: a reason added to the union with no line here is a
     * compile error at the call site in `format.ts`.
     */
    refused: {
      FUTURE_DAY: '아직 오지 않은 날짜입니다',
      KILLED: '전면 정지 상태입니다. 시작을 눌러야 재개합니다',
      DISABLED: '자동화가 꺼져 있습니다',
      NO_TEMPLATE: '등록된 문구가 없습니다',
      OUTSIDE_ACTIVE_HOURS: '운영 시간대가 아닙니다',
      NOT_LOGGED_IN: '네이버에 로그인되어 있지 않습니다',
      LOGIN_CHECK_FAILED: '로그인 상태를 확인하지 못했습니다',
      STALE_BACKLOG: '오래된 미처리 건이 있어 멈췄습니다. 승인 큐를 확인하세요',
      COLLECT_FAILED: '글 목록을 가져오지 못했습니다',
    },
  },
  progress: {
    heading: '진행 중',
    collecting: '가입인사 글을 모으는 중',
    collectingCounted: (pagesRead: number, collected: number) =>
      `가입인사 글을 모으는 중 — ${pagesRead}쪽 ${collected}건`,
    backlog: (position: number, total: number) => `밀린 ${total}건 중 ${position}건째`,
    backlogOn: (position: number, total: number, nickname: string) =>
      `밀린 ${total}건 중 ${position}건째 · ${nickname}님`,
    working: (position: number, total: number) => `${total}건 중 ${position}건째`,
    workingOn: (position: number, total: number, nickname: string) =>
      `${total}건 중 ${position}건째 · ${nickname}님`,
  },
  run: {
    dayLabel: '처리할 날짜',
    dayRun: '이 날짜 처리',
    confirmHeading: '확인이 필요합니다',
    outsideHours: '지금은 운영 시간(08~24시)이 아닙니다.',
    chosenDay: (date: string) => `${date} 하루치를 처리합니다.`,
    bypasses: '운영 시간, 시간당 상한, 밀린 작업 브레이크를 넘깁니다. 전면 정지는 그대로 듣습니다.',
    counting: '대상을 세는 중…',
    countFailed: '대상을 세지 못했습니다. 그대로 진행하면 실제 건수만큼 나갑니다.',
    target: '댓글을 달 대상',
    alreadyHandled: '이미 댓글이 달린 글',
    estimate: '예상 소요',
    countUnit: (count: number) => `${count}건`,
    /** While posts are still being resolved, the figure is not yet settled. */
    countWithPending: (count: number, pending: number) => `${count}건 (확인 중 ${pending}건)`,
    minutesUnit: (minutes: number) => `${minutes}분`,
    confirm: '실행',
    cancel: '취소',
  },
  startup: {
    heading: '오늘 환영할 대상',
    count: (count: number) => `${count}명`,
    unavailable: {
      BRIDGE_OFFLINE: '확인하지 못했습니다 (확장 미연결)',
      READ_FAILED: '확인하지 못했습니다 (읽기 실패)',
    },
  },
  time: {
    justNow: '방금',
    minutesAgo: (count: number) => `${count}분 전`,
    hoursAgo: (count: number) => `${count}시간 전`,
    daysAgo: (count: number) => `${count}일 전`,
    lastSession: (elapsed: string) => `마지막 세션 · ${elapsed}`,
    nextSession: (time: string) => `다음 세션 · ${time}`,
    sessionKeptAlive: (time: string) => `네이버 세션 · ${time} 확인`,
    sessionLapsed: (time: string) => `네이버 세션 · ${time} 로그아웃 상태`,
    sessionUnchecked: '네이버 세션 · 확인 전',
  },
  approvals: {
    heading: '승인 큐',
    empty: '승인을 기다리는 건이 없습니다',
    approve: '승인',
    reject: '거부',
    preview: '나갈 댓글',
    noText: '(문구 없음)',
    post: '글',
  },
  risk: RISK_LABEL,
  templates: {
    heading: '환영 문구',
    hint: '여러 개를 등록하면 매번 무작위로 하나를 고릅니다. {닉네임}을 쓸 수 있습니다.',
    submitHint: '줄바꿈은 Enter, 등록은 ⌘/Ctrl+Enter 또는 추가 버튼입니다.',
    placeholder: '{닉네임}님 환영합니다',
    add: '추가',
    remove: '삭제',
    empty: '등록된 문구가 없습니다. 최소 하나가 있어야 동작합니다',
  },
  settings: {
    automationHeading: '자동화 설정',
    commonHeading: '카페 · 계정 설정',
    enabled: '자동화 활성화',
    policy: '승인 정책',
    policyAuto: '무승인 전자동',
    policyAutoHint: '확실한 건만 자동으로 처리하고, 위험 신호가 붙으면 건너뜁니다',
    policySemi: '자동 + 예외 승인',
    policySemiHint: '위험 신호가 붙은 건만 승인 큐로 보냅니다',
    policyManual: '전건 승인',
    policyManualHint: '모든 건을 사람이 확인한 뒤 나갑니다',
    board: '감시 게시판',
    boardId: '게시판 ID',
    boardIdHint: '이 기능이 감시할 게시판입니다. 바꾸면 새 게시판의 새 글부터 다시 시작합니다',
    cafe: '카페',
    cafeId: '카페 ID',
    cafeUrlName: '카페 주소',
    cafeUrlNameHint: (cafeUrlName: string) => `cafe.naver.com/${cafeUrlName}`,
    operatorAccounts: '운영진 계정',
    operatorAccountsHint: '이 계정 중 누구든 댓글을 달았으면 도구는 손대지 않습니다',
    operatorAccountsPlaceholder: '네이버 계정 ID',
    operatorAccountsAdd: '추가',
    operatorAccountsRemove: '삭제',
    operatorAccountsEmpty: '등록된 운영진 계정이 없습니다',
    pairing: '확장 페어링 토큰',
    pairingHint: '확장 옵션에 이 값을 한 번 붙여넣으면 연결됩니다',
    save: '저장',
  },
  /**
   * The tray is the only surface an operator sees when the window is closed,
   * so its wording is part of the same voice rather than something main.ts
   * spells out on its own.
   */
  tray: {
    openWindow: '창 열기',
    startAutomation: '자동화 시작',
    stopAutomation: '자동화 중지',
    kill: '전면 정지 (킬 스위치)',
    quit: '종료',
  },
} as const

/**
 * What an automation may call itself. The catalogue names one of these rather
 * than carrying its own label, so every word the operator reads still lives in
 * this file — and an automation whose name was never written here cannot compile.
 */
export type AutomationLabelKey = keyof typeof TEXT.automation
