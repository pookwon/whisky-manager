/**
 * The bridge's own words, kept here rather than in the app's catalogue: this
 * page ships inside the extension, a separate bundle that has no reason to
 * carry the desktop app's wording. The static lines live in `options.html`.
 */
const MESSAGE = {
  tokenMissing: '토큰을 입력하세요.',
  saved: '저장했습니다. 앱과 연결을 시도합니다.',
} as const

const tokenField = document.querySelector<HTMLInputElement>('#token')
const saveButton = document.querySelector<HTMLButtonElement>('#save')
const state = document.querySelector<HTMLDivElement>('#state')

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get('pairingToken')
  const token: unknown = stored.pairingToken
  if (tokenField !== null && typeof token === 'string') tokenField.value = token
}

saveButton?.addEventListener('click', () => {
  const token = tokenField?.value.trim() ?? ''
  if (token === '') {
    if (state !== null) state.textContent = MESSAGE.tokenMissing
    return
  }
  // The background worker watches storage and reconnects on its own.
  void chrome.storage.local.set({ pairingToken: token }).then(() => {
    if (state !== null) state.textContent = MESSAGE.saved
  })
})

void load()
