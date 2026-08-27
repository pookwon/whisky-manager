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
    title: '네이버 카페 관리',
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
    /**
     * Said on the dashboard for as long as it is true, not once after an
     * import. A switched-off automation refuses every session and every forced
     * run, and the refusal only shows up after the operator has already pressed
     * something and waited.
     */
    disabledHeading: '꺼져 있음',
    disabled: (names: string) => `${names} 자동화가 꺼져 있습니다`,
    disabledHow: '시작을 눌러도, 지금 한 번 실행을 눌러도 아무것도 하지 않습니다. 자동화 설정에서 켜세요.',
  },
  status: {
    bridgeConnected: '연결됨',
    bridgeReconnecting: '연결 대기 중',
    bridgeOffline: '끊김',
    running: '동작 중',
    stopped: '정지',
    /**
     * The two above name a state, these two name a press. Keeping them apart is
     * the point: a button reading '정지' is read as one that stops something,
     * which is the opposite of what a switch showing its own state means.
     */
    turnOn: '켜기',
    turnOff: '끄기',
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
      NOT_CONFIGURED: '카페와 게시판을 먼저 설정해야 합니다',
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
      NOT_CONFIGURED: '카페와 게시판을 먼저 설정해야 합니다',
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
   * Carrying a configuration from the machine it was worked out on to the one
   * that will run it. The wording says out loud what the file does not carry,
   * because an operator who expects the extension to be paired by it would
   * wait for a connection that never comes.
   */
  configTransfer: {
    heading: '설정 파일',
    hint: '개발 기계에서 맞춰 둔 설정을 파일 하나로 옮깁니다. 페어링 토큰과 실행 이력은 이 기계의 것이므로 담기지 않습니다.',
    exportButton: '내보내기',
    importButton: '가져오기',
    saveTitle: '설정 내보내기',
    openTitle: '설정 가져오기',
    fileKind: '설정 파일',
    exported: (path: string) => `${path} 에 저장했습니다`,
    confirmHeading: '확인이 필요합니다',
    confirmBody: '지금 등록된 카페·운영진 계정·승인 정책·게시판·문구·자동화 켜짐 상태가 파일의 내용으로 통째로 바뀝니다. 파일이 켜진 채였다면 그대로 켜집니다. 되돌릴 수 없습니다.',
    confirm: '가져오기',
    cancel: '취소',
    imported: (templateCount: number) =>
      `설정을 가져왔습니다. 문구 ${templateCount}건을 등록했습니다.`,
    /**
     * The file carries the switch, so the sentence after an import has to say
     * which way it landed — one of these two always shows.
     */
    importedEnabled: (count: number) =>
      `자동화 ${count}건이 켜진 채로 들어왔습니다. 확장이 연결되어 있으면 다음 세션부터 댓글이 나갑니다.`,
    importedAllOff: '자동화는 꺼진 채로 들어왔습니다. 자동화 설정에서 켜야 돌기 시작합니다.',
    /**
     * Every reason a file can be turned away, or the build fails. Indexing this
     * with a `BundleProblem` is what type-checks the set — a reason added to
     * the union with no line here does not reach the screen as its own name.
     */
    rejected: {
      NOT_JSON: '설정 파일이 아닙니다. 내용을 읽을 수 없습니다',
      NOT_A_BUNDLE: '이 앱이 만든 설정 파일이 아닙니다',
      UNSUPPORTED_VERSION: '이 버전이 읽을 수 없는 설정 파일입니다. 앱을 최신 버전으로 올리세요',
      NO_CAFE: '카페 ID가 비어 있는 파일입니다. 가져와도 세션이 열리지 않습니다',
    },
  },
  /**
   * The walkthrough an operator meets once, before anything works at all.
   *
   * Keyed by step rather than written out as a list, so the order the renderer
   * walks, the illustration each step carries and this wording are checked
   * against one another by the compiler. A step named in one place and missing
   * from another does not reach the screen half-drawn.
   */
  extensionSetup: {
    /** The sidebar's call to action while no extension has ever paired. */
    connect: '확장 연결하기',
    connectHint: 'Chrome 확장을 아직 연결하지 않았습니다',
    heading: 'Chrome 확장 연결',
    subheading: '순서를 먼저 훑어보세요. 확인을 누르면 필요한 것이 한 번에 열립니다.',
    position: (step: number, total: number) => `${step} / ${total}`,
    steps: {
      folder: {
        title: '확장 폴더는 앱이 만들어 둡니다',
        body: '따로 내려받거나 압축을 풀 것이 없습니다. 확인을 누르면 manifest.json이 들어 있는 폴더가 열립니다.',
        note: 'Chrome은 폴더 위치로 확장을 구분합니다. 옮기거나 이름을 바꾸지 마세요.',
      },
      devMode: {
        title: '개발자 모드를 켭니다',
        body: 'Chrome 주소창에 chrome://extensions 를 붙여넣고 Enter, 오른쪽 위 개발자 모드 스위치를 켭니다.',
        note: '웹스토어를 거치지 않는 설치에 Chrome이 요구하는 절차입니다. 오류가 아닙니다.',
      },
      load: {
        title: '폴더를 불러옵니다',
        body: '왼쪽 위 “압축해제된 확장 프로그램을 로드”를 누르고 열려 있는 확장 폴더를 선택합니다.',
        note: '폴더를 확장 화면 위로 끌어다 놓아도 됩니다.',
      },
      token: {
        title: '페어링 토큰을 붙여넣습니다',
        body: 'Whisky Manager Bridge 카드의 “세부정보” → “확장 프로그램 옵션”을 열고, 토큰을 붙여넣은 뒤 저장합니다.',
        note: '이 컴퓨터의 앱과 확장을 잇는 비밀번호입니다. 다른 사람에게 보내지 마세요.',
      },
      launch: {
        title: '이제 확인을 누르세요',
        body: '확장 폴더가 열리고, chrome://extensions 주소가 복사되고, Chrome이 켜집니다.',
        note: '연결되면 왼쪽 위 상태가 ‘연결됨’으로 바뀝니다.',
      },
    },
    back: '이전',
    next: '다음',
    confirm: '확인',
    close: '닫기',
    copy: '복사',
    copied: '복사했습니다',
    /** Shown after the press, while the operator works in Chrome. */
    done: {
      heading: '열었습니다',
      folder: '확장 폴더',
      token: '페어링 토큰',
      urlCopied: (url: string) =>
        `${url} 주소를 복사했습니다. Chrome 새 탭 주소창에 붙여넣고 Enter를 누르세요.`,
      chromeMissing: 'Chrome을 찾지 못했습니다. Chrome을 직접 실행한 뒤 주소창에 붙여넣으세요.',
      remaining: '개발자 모드를 켜고, 열린 폴더를 불러온 뒤, 위 토큰을 확장 옵션에 붙여넣고 저장하면 끝입니다.',
    },
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

/**
 * The steps of the extension walkthrough. Exported so the renderer's ordering
 * and its illustrations are indexed by the same names this file spells, rather
 * than by a second list that can quietly fall out of step with it.
 */
export type ExtensionSetupStepKey = keyof typeof TEXT.extensionSetup.steps
