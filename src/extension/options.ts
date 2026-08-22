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
    if (state !== null) state.textContent = '토큰을 입력하세요.'
    return
  }
  // The background worker watches storage and reconnects on its own.
  void chrome.storage.local.set({ pairingToken: token }).then(() => {
    if (state !== null) state.textContent = '저장했습니다. 앱과 연결을 시도합니다.'
  })
})

void load()
