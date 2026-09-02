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
    collection: '게시판 수집',
    collectionStatus: '수집 현황',
    collectionSettings: '수집 설정',
    commonSettings: '카페 · 계정 설정',
    common: '공통',
  },
  automation: {
    welcomeComment: '환영 댓글',
  },
  collectionSettings: {
    heading: '수집 설정',
    scheduled: '예약 수집',
    activeWindow: '활동 시간대',
    activeWindowHint: '이 시간 안에서만 자동 수집을 시작합니다. 실행 중인 작업은 시간대를 무시하고 계속됩니다.',
    startHour: '시작 시각',
    endHour: '끝 시각',
    workBlock: '한 번의 작업 길이',
    workBlockHint: (pages: number) => `${pages}쪽 정도를 이 시간 안에 읽습니다.`,
    workBlockMinutes: (minutes: number) => `${minutes}분`,
    restPeriod: '작업 사이의 휴식',
    restMinutes: (minutes: number) => `${minutes}분`,
    yieldsToSession: '가입인사 세션이 돌고 있으면 그것이 끝난 뒤로 미룹니다.',
    pace: '읽기 속도',
    paceBetween: '페이지 사이',
    paceBetweenValue: '5~9초',
    paceTwenty: '20쪽마다',
    paceTwentyValue: '2~5분 휴지',
    paceHundred: '100쪽마다',
    paceHundredValue: '10~20분 휴지',
    paceWhy: '카페가 사람이 읽는 속도로 받아들이도록 고정해 둔 값입니다.',
    save: '저장',
  },
  collection: {
    heading: '수집 현황',
    running: '수집 중',
    lastRun: '마지막 수집',
    never: '아직 수집한 적이 없습니다',
    /** Pages committed, not pages requested: a rewind read is not progress. */
    pagesRead: (pages: number) => `${pages}쪽 저장`,
    newPosts: (count: number) => `신규 ${count}건`,
    reobserved: (count: number) => `재관측 ${count}건`,
    elapsed: (text: string) => `${text} 경과`,
    coverage: (percent: number) => `대상 구간의 ${percent}%`,
    totals: {
      posts: '수집한 글',
      observations: '관측',
      boards: '게시판',
    },
    span: '수집 구간',
    spanRange: (oldest: string, newest: string) => `${oldest} — ${newest}`,
    spanEmpty: '아직 저장된 글이 없습니다',
    recent: '최근 실행',
    /** A range said in days, because that is what the operator asked for. */
    targetRange: (days: number) => `최근 ${days}일`,
    targetHours: (hours: number) => `최근 ${hours}시간`,
    runStatus: {
      running: '진행 중',
      succeeded: '완료',
      partial: '일부만',
      failed: '중단',
      interrupted: '멈춤',
    },
    /**
     * Storage is optional, and the two ways it can be missing need different
     * answers: one is a choice, the other is something to fix.
     */
    disabledHeading: '수집 저장소가 설정되지 않았습니다',
    disabledHow:
      '트레이 메뉴의 "수집 저장소 설정 열기"로 파일을 열어 수집 DB 주소를 적고 앱을 다시 시작하면, 수집한 글이 이 화면에 쌓입니다. 가입인사 자동화는 이것 없이도 그대로 동작합니다.',
    collectNow: '이어서 수집',
    stop: '중지',
    /** Ignoring the operating hours for the job in hand, and saying so. */
    force: '활동 시간 무시',
    forceRelease: '활동 시간 지키기',
    forcedOn: '활동 시간을 무시하고 있습니다. 이 기간을 다 옮기면 저절로 풀립니다.',
    /** A window the operator picks, as opposed to the schedule's own. */
    periodHeading: '기간 지정 수집',
    periodFrom: '시작 날짜',
    periodTo: '끝 날짜',
    periodRun: '이 기간 수집',
    periodHint: '고른 날짜의 0시부터 끝 날짜가 끝날 때까지를 읽습니다. 이미 저장한 글은 새 행이 아니라 그 자리에서 갱신됩니다.',
    nextRun: '다음 예정',
    nextRunNone: '예약 없음 — 직접 눌러 실행합니다',
    nextRunAt: (time: string) => `${time} 예정`,
    /** Refusals and rejections, each said as the thing the operator can fix. */
    refused: {
      NO_STORAGE: '수집 저장소가 없어 시작하지 못했습니다.',
      ALREADY_RUNNING: '이미 수집이 돌고 있습니다.',
      BRIDGE_OFFLINE: '확장이 연결되어 있지 않습니다.',
      STOP_RUNNING_FIRST: '수집이 도는 중입니다. 중지한 뒤에 기간을 바꾸세요.',
      NO_JOB: '이어받을 작업이 없습니다. 아래에서 기간을 골라 시작하세요.',
      JOB_FINISHED: '이 기간은 끝까지 옮겼습니다. 새 기간을 골라 시작하세요.',
    },
    /** Replacing a job the operator has not finished, said as what it costs. */
    replace: {
      heading: '진행 중인 작업이 있습니다',
      period: (from: string, to: string) => `대상 기간 ${from} — ${to}`,
      progress: (percent: number) => `${percent}%까지 옮겼습니다`,
      progressUnknown: '아직 한 쪽도 옮기지 않았습니다',
      walkedTo: (at: string) => `${at}까지 내려왔습니다`,
      cost: '기간을 바꾸면 이 작업의 진행 위치가 사라지고 새 기간의 처음부터 시작합니다. 이미 옮긴 글은 지워지지 않습니다.',
      confirm: '기간 바꾸기',
      cancel: '그대로 두기',
    },
    rejected: {
      EMPTY_RANGE: '시작 날짜가 끝 날짜보다 뒤입니다.',
      NOT_YET: '아직 오지 않은 기간입니다.',
      TOO_LONG: '한 번에 31일까지만 수집합니다.',
    },
    unavailableHeading: '수집 저장소를 쓸 수 없습니다',
    unavailable: {
      COLLECTION_CONNECTION_FAILED: 'PostgreSQL에 연결하지 못했습니다.',
      COLLECTION_AUTHENTICATION_FAILED: 'PostgreSQL 접속 계정이 거부됐습니다.',
      COLLECTION_SCHEMA_MISSING: '수집용 테이블이 아직 만들어지지 않았습니다.',
      COLLECTION_SCHEMA_MISMATCH: '저장소의 스키마가 이 버전과 다릅니다.',
      COLLECTION_MIGRATION_FILES_MISSING: '설치본에 수집용 마이그레이션이 없습니다.',
    },
  },
  dashboard: {
    heading: '대시보드',
    /** What a run put away, said the same whether it has finished or not. */
    collectionStored: (pages: number, posts: number) => `${pages}쪽 저장 · 신규 ${posts}건`,
    collectionNever: '수집 기록 없음',
    /**
     * The day drawn as a band, which is the one place the screen can say
     * "nothing is running right now, and that is the schedule working" without
     * writing the sentence. The blocks that ran are filled; the rests are the
     * gaps between them.
     */
    rhythm: {
      heading: '오늘의 리듬 · KST',
      now: (time: string) => `지금 ${time}`,
      commentLane: '댓글',
      collectionLane: '수집',
      legendWindow: '활동 시간',
      legendRan: '이미 돈 블록',
      legendNext: (time: string) => `다음 블록 ${time}`,
      legendRunning: '지금 도는 블록',
      legendNoBlock: '예약된 블록 없음',
      legendNow: '지금',
      legendRest: '블록과 블록 사이의 빈칸이 휴식입니다',
    },
    /**
     * The two jobs, named as jobs. They are different kinds of thing — one runs
     * in sessions through the day, the other walks a fixed past period across
     * many runs — and the screen says so before it says anything else.
     */
    job: {
      comment: '댓글 작업',
      commentHint: '가입인사 자동 댓글 · 세션 단위',
      collection: '게시판 수집',
      collectionHint: '과거 기간 DB화 · 작업 단위',
      /** State words, kept apart from the buttons that change state. */
      running: '진행 중',
      waiting: '대기 중',
      stopped: '정지',
      off: '꺼짐',
      unavailable: '쓸 수 없음',
    },
    /**
     * Why it is quiet, said as present state rather than as the last refusal.
     * A refusal is what happened; these are what is true now, which is the
     * question an operator opens this window to answer.
     */
    quiet: {
      sessionDisabled: '자동화가 꺼져 있습니다 — 자동화 설정에서 켜야 세션이 돕니다',
      sessionStopped: '정지 상태입니다 — 시작을 눌러야 세션이 돕니다',
      bridgeOffline: '확장이 연결되어 있지 않습니다 — 연결될 때까지 아무것도 돌지 않습니다',
      sessionOutside: (window: string) => `운영 시간 ${window} 밖입니다`,
      sessionOutsideUntil: (window: string, time: string) =>
        `운영 시간 ${window} 밖입니다 — ${time}에 다음 세션이 잡혀 있습니다`,
      sessionWaiting: (time: string, window: string) =>
        `다음 세션 ${time} · 세션 사이 대기 — 운영 시간 ${window} 안입니다`,
      sessionWaitingNoTime: '다음 세션을 기다리는 중입니다',
      collectionRunning: (elapsed: string, rest: number) =>
        `이번 블록 ${elapsed} — 끝나면 휴식 ${rest}분 뒤 다음 블록이 이어받습니다`,
      collectionResting: (time: string) =>
        `다음 블록 ${time} · 블록 사이 휴식 중입니다 — 작업은 그대로 남아 있습니다`,
      collectionOutside: (window: string, time: string) =>
        `활동 시간 ${window} 밖입니다 — ${time}에 다시 이어받습니다`,
      collectionScheduleOff: '예약 수집이 꺼져 있습니다 — 직접 눌러야 한 블록씩 돕니다',
      collectionNoJob: '이어받을 작업이 없습니다 — 수집 현황에서 기간을 골라 시작하세요',
      collectionComplete: '이 기간은 끝까지 옮겼습니다 — 새 기간을 고르면 다시 시작합니다',
      collectionNoNext: '예약이 켜져 있지만 다음 블록이 아직 잡히지 않았습니다',
    },
    /** The period as days, because a page number points elsewhere in an hour. */
    period: {
      heading: '대상 기간 · 하루 한 칸',
      walked: (at: string, from: string, to: string) =>
        `${at}까지 내려왔습니다 · 남은 구간 ${from} — ${to}`,
      walkedNone: '아직 한 쪽도 옮기지 않았습니다',
      direction: '왼쪽이 아직 남은 구간, 오른쪽이 옮긴 구간 — 새 글에서 옛 글 순으로 내려갑니다',
      coverage: (percent: number) => `${percent}%`,
    },
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
    outsideHours: (window: string) => `지금은 운영 시간(${window})이 아닙니다.`,
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
    /** Still going, as opposed to the `*Ago` line above, which has finished. */
    minutesInto: (count: number) => `${count}분째`,
    hoursInto: (count: number) => `${count}시간째`,
    hoursMinutesInto: (hours: number, minutes: number) => `${hours}시간 ${minutes}분째`,
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
    recover: '확장 복구하기',
    recoverHint: '연결이 끊겼습니다. Chrome에서 확장 폴더를 다시 불러오세요',
    heading: 'Chrome 확장 연결',
    subheading: '순서를 먼저 훑어보세요. 확인을 누르면 필요한 것이 한 번에 열립니다.',
    recovery: {
      heading: 'Chrome 확장 복구',
      subheading: '기존 확장 연결을 초기화하고 지금 불러오는 확장으로 교체합니다.',
      confirm: '초기화하고 열기',
      tokenStep: {
        body: '마지막 확인을 누르면 새 토큰이 만들어집니다. 그때 표시되는 토큰을 확장 옵션에 붙여넣고 저장하세요.',
        note: '이전 토큰은 복구를 시작하면 더 이상 사용할 수 없습니다.',
      },
    },
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
    openCollectionConfig: '수집 저장소 설정 열기',
    quit: '종료',
  },
  memberCollection: {
    heading: '회원 목록',
    running: '수집 중',
    idle: '대기',
    never: '아직 회원을 수집한 적이 없습니다',
    start: '회원 수집 시작',
    resume: '이어서 수집',
    stop: '중지',
    force: '활동 시간 무시',
    forceRelease: '활동 시간 지키기',
    forcedOn: '활동 시간을 무시하고 있습니다. 다 옮기면 저절로 풀립니다.',
    memberCount: (count: number) => `저장 회원 ${count.toLocaleString()}명`,
    pagesStored: (pages: number) => `${pages}쪽 저장`,
    progress: (percent: number) => `약 ${percent}%`,
    progressUnknown: '진행률 계산 전',
    completedAt: (time: string) => `완료 ${time}`,
    incomplete: '아직 완료되지 않았습니다',
    toppedUpAt: (time: string) => `마지막 신규 보태기 ${time}`,
    toppedUpNever: '신규 보태기 없음',
    match: (matched: number, authors: number) => `글 작성자 ${authors.toLocaleString()}명 중 ${matched.toLocaleString()}명이 회원표에 있음`,
    refused: {
      NO_STORAGE: '수집 저장소가 없어 시작하지 못했습니다.',
      ALREADY_RUNNING: '이미 수집이 돌고 있습니다.',
      BRIDGE_OFFLINE: '확장이 연결되어 있지 않습니다.',
      STOP_RUNNING_FIRST: '수집이 도는 중입니다. 중지한 뒤에 다시 시도하세요.',
      NO_JOB: '시작된 회원 수집이 없습니다.',
      JOB_FINISHED: '전체 회원을 이미 옮겼습니다. 신규는 매일 자동으로 보탭니다.',
    },
    /**
     * Why the most recent run stopped. Normal codes (budget spent, aborted) are
     * worded as progress, not failure. Unknown codes show the code itself so the
     * operator has something actionable to report.
     */
    stopReason: {
      MEMBER_PAGE_FORBIDDEN: '회원 관리 페이지에 접근할 권한이 없습니다.',
      MEMBER_PAGE_NETWORK_ERROR: '회원 목록을 불러오는 중 네트워크 오류가 발생했습니다.',
      MEMBER_PAGE_HTTP_ERROR: '회원 목록 요청이 HTTP 오류로 끝났습니다.',
      MEMBER_PAGE_INVALID_JSON: '회원 목록 응답이 올바른 JSON이 아닙니다.',
      MEMBER_PAGE_PARSE_ERROR: '회원 목록 응답 파싱에 실패했습니다.',
      MEMBER_PAGE_BAD_REQUEST: '회원 목록 요청이 거부되었습니다.',
      MEMBER_PAGE_SILENT_FALLBACK: '회원 목록 요청이 예상치 않은 응답을 반환했습니다.',
      MEMBER_PAGE_DATE_ORDER: '회원 날짜 순서가 예상과 다릅니다.',
      MEMBER_PAGE_REPEATED: '같은 페이지가 반복되어 수집을 중단했습니다.',
      MEMBER_PAGE_EMPTY: '회원 목록 페이지가 비어 있습니다.',
      MEMBER_ANCHOR_RELOCATION_FAILED: '기준 회원을 찾지 못해 수집을 중단했습니다.',
      MEMBER_RESUME_SCAN_PAGE_LIMIT: '이어받기 스캔 한도를 초과했습니다.',
      MEMBER_COLLECTION_FAILURE: '수집 중 오류가 발생했습니다.',
      PAGE_BUDGET_SPENT: '오늘 할당된 페이지를 모두 읽었습니다.',
      ABORTED: '수집이 요청에 따라 중단되었습니다.',
      CAS_CONFLICT_REPOSITION_REQUIRED: '동시 수정 충돌로 위치를 재조정해야 합니다.',
    } as Record<string, string>,
    stopReasonFallback: (code: string) => `수집이 중단되었습니다 (${code}).`,
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
