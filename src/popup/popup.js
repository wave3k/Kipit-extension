const API_URL = 'http://localhost:3000'
const MASTER_VERIFIER_TEXT = 'bitlock://master-verifier/v1'
const TOKEN_PATTERN = /^blx_[A-Za-z0-9_-]{40,64}$/

const elements = {
  connectView: document.getElementById('connect-view'),
  unlockView: document.getElementById('unlock-view'),
  vaultView: document.getElementById('vault-view'),
  addView: document.getElementById('add-view'),
  connectForm: document.getElementById('connect-form'),
  connectButton: document.getElementById('connect-btn'),
  tokenInput: document.getElementById('token-input'),
  toggleTokenButton: document.getElementById('toggle-token-btn'),
  unlockForm: document.getElementById('unlock-form'),
  unlockButton: document.getElementById('unlock-submit-btn'),
  masterPasswordInput: document.getElementById('master-password-input'),
  lockButton: document.getElementById('lock-btn'),
  disconnectButton: document.getElementById('disconnect-btn'),
  openAddButton: document.getElementById('open-add-btn'),
  closeAddButton: document.getElementById('close-add-btn'),
  addForm: document.getElementById('add-form'),
  addSignal: document.getElementById('add-signal'),
  addTitle: document.getElementById('add-title'),
  addLabel: document.getElementById('add-label'),
  addUrl: document.getElementById('add-url'),
  addUsername: document.getElementById('add-username'),
  addPassword: document.getElementById('add-password'),
  generatePasswordButton: document.getElementById('generate-password-btn'),
  saveButton: document.getElementById('save-btn'),
  searchInput: document.getElementById('search-input'),
  siteSection: document.getElementById('site-section'),
  siteList: document.getElementById('site-list'),
  siteCount: document.getElementById('site-count'),
  allList: document.getElementById('all-list'),
  allCount: document.getElementById('all-count'),
  status: document.getElementById('status'),
}

const state = {
  token: '',
  rawItems: [],
  items: [],
  masterPassword: '',
  activeTab: null,
  pageContext: null,
  statusTimer: null,
}

document.addEventListener('DOMContentLoaded', initialize)

elements.connectForm.addEventListener('submit', connectExtension)
elements.unlockForm.addEventListener('submit', unlockVault)
elements.addForm.addEventListener('submit', saveCredential)
elements.lockButton.addEventListener('click', lockVault)
elements.disconnectButton.addEventListener('click', disconnectExtension)
elements.openAddButton.addEventListener('click', () => openAddView())
elements.closeAddButton.addEventListener('click', closeAddView)
elements.generatePasswordButton.addEventListener('click', generateIntoPasswordField)
elements.searchInput.addEventListener('input', renderCredentials)
elements.toggleTokenButton.addEventListener('click', toggleTokenVisibility)

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.addView.classList.contains('hidden')) {
    closeAddView()
  }
})

async function initialize() {
  await readActivePage()
  const stored = await chrome.storage.local.get(['bitlockExtensionToken'])
  const token = typeof stored.bitlockExtensionToken === 'string'
    ? stored.bitlockExtensionToken
    : ''

  if (!TOKEN_PATTERN.test(token)) {
    showView('connect')
    return
  }

  state.token = token
  try {
    await refreshEncryptedItems()
    showView('unlock')
  } catch (error) {
    await chrome.storage.local.remove(['bitlockExtensionToken'])
    state.token = ''
    showView('connect')
    showStatus(messageFromError(error, 'Le jeton enregistré n’est plus valide.'), 'error')
  }
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`)
  if (options.body) headers.set('Content-Type', 'application/json')

  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      cache: 'no-store',
    })
  } catch {
    throw new Error('BitLock local est inaccessible. Lancez le serveur sur localhost:3000.')
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || `Erreur BitLock (${response.status})`)
  }
  return data
}

async function connectExtension(event) {
  event.preventDefault()
  clearFieldError(elements.tokenInput)
  const token = elements.tokenInput.value.trim()

  if (!TOKEN_PATTERN.test(token)) {
    setFieldError(elements.tokenInput)
    showStatus('Ce jeton BitLock est invalide.', 'error')
    return
  }

  setLoading(elements.connectButton, true)
  state.token = token
  try {
    await refreshEncryptedItems()
    await chrome.storage.local.set({ bitlockExtensionToken: token })
    elements.tokenInput.value = ''
    showView('unlock')
    showStatus('Extension connectée.', 'success')
  } catch (error) {
    state.token = ''
    setFieldError(elements.tokenInput)
    showStatus(messageFromError(error, 'Connexion impossible.'), 'error')
  } finally {
    setLoading(elements.connectButton, false)
  }
}

async function unlockVault(event) {
  event.preventDefault()
  clearFieldError(elements.masterPasswordInput)
  const masterPassword = elements.masterPasswordInput.value

  if (!masterPassword) {
    setFieldError(elements.masterPasswordInput)
    showStatus('Saisissez votre mot de passe maître.', 'error')
    return
  }

  setLoading(elements.unlockButton, true)
  try {
    const unlockState = await apiRequest('/api/extension/unlock')
    await verifyMasterPassword(unlockState, masterPassword)

    const decrypted = []
    let invalidCount = 0
    for (const item of state.rawItems) {
      try {
        const plaintext = await decryptEnvelope(item.payload, item.iv, masterPassword)
        decrypted.push({
          ...item,
          ...parseCredentialPayload(plaintext),
        })
      } catch {
        invalidCount += 1
      }
    }

    state.masterPassword = masterPassword
    state.items = decrypted
    elements.masterPasswordInput.value = ''
    showView('vault')
    renderCredentials()
    await consumePendingCredential()

    if (invalidCount) {
      showStatus(`${invalidCount} élément(s) n’ont pas pu être déchiffrés.`, 'error')
    } else {
      showStatus('Coffre déverrouillé.', 'success')
    }
  } catch (error) {
    state.masterPassword = ''
    state.items = []
    setFieldError(elements.masterPasswordInput)
    showStatus(messageFromError(error, 'Mot de passe maître incorrect.'), 'error')
  } finally {
    setLoading(elements.unlockButton, false)
  }
}

async function verifyMasterPassword(unlockState, masterPassword) {
  if (unlockState?.configured && unlockState.verifier) {
    const plaintext = await decryptEnvelope(
      unlockState.verifier.payload,
      unlockState.verifier.iv,
      masterPassword,
    )
    if (plaintext !== MASTER_VERIFIER_TEXT) throw new Error('Mot de passe maître incorrect.')
    return
  }

  if (unlockState?.probe) {
    await decryptEnvelope(unlockState.probe.payload, unlockState.probe.iv, masterPassword)
    return
  }

  throw new Error('Configurez d’abord le mot de passe maître dans BitLock.')
}

async function refreshEncryptedItems() {
  const data = await apiRequest('/api/extension/passwords')
  state.rawItems = Array.isArray(data.items) ? data.items : []
}

function lockVault() {
  state.masterPassword = ''
  state.items = []
  elements.searchInput.value = ''
  showView('unlock')
  showStatus('Coffre verrouillé.', 'success')
}

async function disconnectExtension() {
  state.token = ''
  state.masterPassword = ''
  state.rawItems = []
  state.items = []
  await chrome.storage.local.remove(['bitlockExtensionToken'])
  await chrome.runtime.sendMessage({ type: 'BITLOCK_CLEAR_PENDING' }).catch(() => {})
  showView('connect')
  showStatus('Extension déconnectée.', 'success')
}

function showView(name) {
  const map = {
    connect: elements.connectView,
    unlock: elements.unlockView,
    vault: elements.vaultView,
    add: elements.addView,
  }
  Object.values(map).forEach(view => view.classList.add('hidden'))
  map[name].classList.remove('hidden')

  const connected = name !== 'connect'
  const unlocked = name === 'vault' || name === 'add'
  elements.disconnectButton.classList.toggle('hidden', !connected)
  elements.lockButton.classList.toggle('hidden', !unlocked)
}

async function readActivePage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    state.activeTab = tab || null
    if (!tab?.id || !/^https?:/i.test(tab.url || '')) return

    try {
      state.pageContext = await chrome.tabs.sendMessage(tab.id, {
        type: 'BITLOCK_PAGE_CONTEXT',
      })
    } catch {
      const url = new URL(tab.url)
      state.pageContext = {
        hostname: url.hostname.replace(/^www\./, ''),
        url: tab.url,
        hasPasswordField: false,
      }
    }
  } catch {
    state.activeTab = null
    state.pageContext = null
  }
}

function renderCredentials() {
  const query = elements.searchInput.value.trim().toLowerCase()
  const filtered = state.items.filter((item) => {
    if (!query) return true
    return [item.label, item.username, hostnameFromUrl(item.url)]
      .some(value => String(value || '').toLowerCase().includes(query))
  })

  const siteItems = filtered.filter(item => domainsMatch(
    hostnameFromUrl(item.url),
    state.pageContext?.hostname || '',
  ))

  elements.siteSection.classList.toggle('hidden', siteItems.length === 0)
  elements.siteCount.textContent = String(siteItems.length)
  elements.allCount.textContent = String(filtered.length)
  renderCredentialList(elements.siteList, siteItems, true)
  renderCredentialList(elements.allList, filtered, false)
}

function renderCredentialList(target, items, emphasizeFill) {
  target.replaceChildren()
  if (!items.length) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = elements.searchInput.value
      ? 'Aucun résultat.'
      : 'Aucun identifiant enregistré.'
    target.appendChild(empty)
    return
  }

  items.forEach(item => {
    const row = document.createElement('article')
    row.className = 'credential'

    const copy = document.createElement('div')
    copy.className = 'credential__copy'
    const label = document.createElement('strong')
    label.textContent = item.label || hostnameFromUrl(item.url) || 'Sans titre'
    const account = document.createElement('small')
    account.textContent = item.username || 'Compte sans identifiant'
    copy.append(label, account)

    const actions = document.createElement('div')
    actions.className = 'credential__actions'

    const copyButton = document.createElement('button')
    copyButton.type = 'button'
    copyButton.className = 'button'
    copyButton.textContent = 'Copier'
    copyButton.addEventListener('click', () => copyPassword(item, copyButton))

    const fillButton = document.createElement('button')
    fillButton.type = 'button'
    fillButton.className = `button${emphasizeFill ? ' button--primary' : ''}`
    fillButton.textContent = 'Remplir'
    fillButton.disabled = !state.pageContext?.hasPasswordField
    fillButton.title = fillButton.disabled
      ? 'Aucun champ de mot de passe détecté sur cette page'
      : 'Remplir cette page'
    fillButton.addEventListener('click', () => fillCredential(item, fillButton))

    actions.append(copyButton, fillButton)
    row.append(copy, actions)
    target.appendChild(row)
  })
}

async function fillCredential(item, button) {
  if (!state.activeTab?.id) {
    showStatus('Aucun onglet compatible.', 'error')
    return
  }

  setLoading(button, true)
  try {
    const response = await chrome.tabs.sendMessage(state.activeTab.id, {
      type: 'BITLOCK_FILL',
      credential: {
        username: item.username,
        password: item.password,
      },
    })
    if (!response?.ok) throw new Error('Aucun formulaire compatible sur cette page.')
    setTransientState(button, 'success', 'Rempli')
    showStatus('Identifiant rempli.', 'success')
  } catch (error) {
    setTransientState(button, 'error', 'Échec')
    showStatus(messageFromError(error, 'Remplissage impossible.'), 'error')
  } finally {
    setLoading(button, false)
  }
}

async function copyPassword(item, button) {
  try {
    await navigator.clipboard.writeText(item.password)
    setTransientState(button, 'success', 'Copié')
    showStatus('Mot de passe copié. Pensez à vider le presse-papiers.', 'success')
  } catch {
    setTransientState(button, 'error', 'Échec')
    showStatus('Copie impossible.', 'error')
  }
}

async function consumePendingCredential() {
  const response = await chrome.runtime.sendMessage({ type: 'BITLOCK_TAKE_PENDING' })
    .catch(() => null)
  if (response?.credential) openAddView(response.credential)
}

function openAddView(credential = null) {
  if (!state.masterPassword) {
    showView('unlock')
    return
  }

  elements.addForm.reset()
  elements.addSignal.textContent = credential ? 'identifiant détecté' : 'nouvel identifiant'
  elements.addTitle.textContent = credential ? 'Vérifier puis enregistrer' : 'Ajouter au coffre'
  elements.addLabel.value = credential?.label || state.pageContext?.hostname || ''
  elements.addUrl.value = credential?.url || state.pageContext?.url || ''
  elements.addUsername.value = credential?.username || ''
  elements.addPassword.value = credential?.password || ''
  showView('add')
  elements.addLabel.focus()
}

function closeAddView() {
  elements.addForm.reset()
  showView('vault')
}

async function saveCredential(event) {
  event.preventDefault()
  clearAddFieldErrors()

  const label = elements.addLabel.value.trim()
  const username = elements.addUsername.value.trim()
  const password = elements.addPassword.value
  let url

  try {
    url = new URL(elements.addUrl.value.trim())
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol')
  } catch {
    setFieldError(elements.addUrl)
    showStatus('Utilisez une adresse http:// ou https:// valide.', 'error')
    return
  }

  if (!label || !password) {
    if (!label) setFieldError(elements.addLabel)
    if (!password) setFieldError(elements.addPassword)
    showStatus('Le nom du site et le mot de passe sont requis.', 'error')
    return
  }

  setLoading(elements.saveButton, true)
  try {
    const plaintext = JSON.stringify({
      schema: 'bitlock.credentials/v1',
      username,
      password,
    })
    const encrypted = await encryptData(plaintext, state.masterPassword)

    await apiRequest('/api/extension/passwords', {
      method: 'POST',
      body: JSON.stringify({
        label,
        url: url.toString(),
        payload: `${encrypted.salt}:${encrypted.ciphertext}`,
        iv: encrypted.iv,
      }),
    })

    await refreshEncryptedItems()
    await rebuildDecryptedItems()
    showView('vault')
    renderCredentials()
    showStatus('Identifiant chiffré et enregistré.', 'success')
  } catch (error) {
    showStatus(messageFromError(error, 'Enregistrement impossible.'), 'error')
  } finally {
    setLoading(elements.saveButton, false)
  }
}

async function rebuildDecryptedItems() {
  const next = []
  for (const item of state.rawItems) {
    try {
      const plaintext = await decryptEnvelope(item.payload, item.iv, state.masterPassword)
      next.push({ ...item, ...parseCredentialPayload(plaintext) })
    } catch {
      // Corrupt or differently encrypted items remain hidden from autofill.
    }
  }
  state.items = next
}

function parseCredentialPayload(plaintext) {
  try {
    const parsed = JSON.parse(plaintext)
    if (parsed && typeof parsed.password === 'string') {
      return {
        username: typeof parsed.username === 'string' ? parsed.username : '',
        password: parsed.password,
      }
    }
  } catch {
    // Fall through to the legacy payload parser.
  }

  const separator = plaintext.indexOf(':')
  if (separator > 0) {
    return {
      username: plaintext.slice(0, separator),
      password: plaintext.slice(separator + 1),
    }
  }
  return { username: '', password: plaintext }
}

async function encryptData(plaintext, masterPassword) {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(masterPassword, salt, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  )

  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  }
}

async function decryptEnvelope(payload, ivBase64, masterPassword) {
  if (typeof payload !== 'string' || typeof ivBase64 !== 'string') {
    throw new Error('Élément chiffré invalide.')
  }
  const separator = payload.indexOf(':')
  if (separator <= 0) throw new Error('Élément chiffré invalide.')

  const salt = base64ToBytes(payload.slice(0, separator))
  const ciphertext = base64ToBytes(payload.slice(separator + 1))
  const iv = base64ToBytes(ivBase64)
  const key = await deriveKey(masterPassword, salt, ['decrypt'])
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  )
  return new TextDecoder().decode(decrypted)
}

async function deriveKey(masterPassword, salt, usages) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  )
}

function base64ToBytes(value) {
  const binary = atob(value)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

function bytesToBase64(value) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    binary += String.fromCharCode(...value.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function generateIntoPasswordField() {
  const password = generatePassword(22)
  elements.addPassword.value = password
  elements.addPassword.type = 'text'
  window.setTimeout(() => {
    elements.addPassword.type = 'password'
  }, 4000)
  elements.addPassword.dispatchEvent(new Event('input', { bubbles: true }))
  showStatus('Mot de passe fort généré.', 'success')
}

function generatePassword(length) {
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%&*+-=?',
  ]
  const all = groups.join('')
  const bytes = crypto.getRandomValues(new Uint32Array(length))
  const chars = groups.map((group, index) => group[bytes[index] % group.length])
  for (let index = groups.length; index < length; index += 1) {
    chars.push(all[bytes[index] % all.length])
  }

  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = bytes[index] % (index + 1)
    ;[chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]]
  }
  return chars.join('')
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function domainsMatch(left, right) {
  if (!left || !right) return false
  const a = left.replace(/^www\./, '').toLowerCase()
  const b = right.replace(/^www\./, '').toLowerCase()
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

function toggleTokenVisibility() {
  const visible = elements.tokenInput.type === 'text'
  elements.tokenInput.type = visible ? 'password' : 'text'
  elements.toggleTokenButton.textContent = visible ? 'Voir' : 'Masquer'
  elements.toggleTokenButton.setAttribute(
    'aria-label',
    visible ? 'Afficher le jeton' : 'Masquer le jeton',
  )
}

function setLoading(button, loading) {
  button.disabled = loading
  if (loading) button.dataset.state = 'loading'
  else if (button.dataset.state === 'loading') delete button.dataset.state
}

function setTransientState(button, stateName, text) {
  const original = button.textContent
  button.dataset.state = stateName
  button.textContent = text
  window.setTimeout(() => {
    if (button.dataset.state === stateName) delete button.dataset.state
    button.textContent = original
  }, 1400)
}

function setFieldError(input) {
  input.setAttribute('aria-invalid', 'true')
  input.focus()
}

function clearFieldError(input) {
  input.removeAttribute('aria-invalid')
}

function clearAddFieldErrors() {
  [
    elements.addLabel,
    elements.addUrl,
    elements.addUsername,
    elements.addPassword,
  ].forEach(clearFieldError)
}

function showStatus(message, stateName = 'success') {
  if (state.statusTimer) window.clearTimeout(state.statusTimer)
  elements.status.textContent = message
  elements.status.dataset.state = stateName
  elements.status.classList.remove('hidden')
  state.statusTimer = window.setTimeout(() => {
    elements.status.classList.add('hidden')
    delete elements.status.dataset.state
  }, stateName === 'error' ? 6000 : 3200)
}

function messageFromError(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback
}
