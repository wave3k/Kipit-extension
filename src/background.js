/**
 * BitLock background service worker.
 *
 * Credentials waiting for confirmation stay in memory only. They are never
 * written to chrome.storage in clear text. Losing them when Chrome suspends
 * the worker is preferable to persisting a secret.
 */

const PENDING_TTL_MS = 2 * 60 * 1000
let pendingCredential = null
let pendingTimer = null

function sanitizeCredential(value) {
  if (!value || typeof value !== 'object') return null

  const username = String(value.username || '').slice(0, 512)
  const password = String(value.password || '').slice(0, 4096)
  const url = String(value.url || '').slice(0, 2048)
  const hostname = String(value.hostname || '').slice(0, 255)
  const label = String(value.label || hostname || 'Identifiant').slice(0, 200)

  if (!password || !/^https?:\/\//i.test(url)) return null
  return { username, password, url, hostname, label, createdAt: Date.now() }
}

function clearPendingCredential() {
  pendingCredential = null
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = null
  chrome.action.setBadgeText({ text: '' }).catch(() => {})
}

function queuePendingCredential(value) {
  const credential = sanitizeCredential(value)
  if (!credential) return false

  pendingCredential = credential
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(clearPendingCredential, PENDING_TTL_MS)

  chrome.action.setBadgeBackgroundColor({ color: '#49de80' }).catch(() => {})
  chrome.action.setBadgeText({ text: '1' }).catch(() => {})
  return true
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return undefined

  if (message.type === 'BITLOCK_CAPTURE_CREDENTIAL') {
    const queued = queuePendingCredential(message.credential)
    sendResponse({ ok: queued })

    if (queued) {
      chrome.action.openPopup().catch(() => {
        // The badge remains visible when Chrome cannot open the popup.
      })
    }
    return undefined
  }

  if (message.type === 'BITLOCK_PEEK_PENDING') {
    sendResponse({ pending: Boolean(pendingCredential) })
    return undefined
  }

  if (message.type === 'BITLOCK_TAKE_PENDING') {
    const credential = pendingCredential
    clearPendingCredential()
    sendResponse({ credential })
    return undefined
  }

  if (message.type === 'BITLOCK_CLEAR_PENDING') {
    clearPendingCredential()
    sendResponse({ ok: true })
  }

  return undefined
})

chrome.runtime.onInstalled.addListener(() => {
  clearPendingCredential()
})
