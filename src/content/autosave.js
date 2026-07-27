/**
 * BitLock credential bridge.
 *
 * The script captures credentials only after an explicit submit-like action.
 * It also receives one-time fill commands from the extension popup.
 */

(() => {
  if (window.top !== window || window.__bitlockCredentialBridge) return
  window.__bitlockCredentialBridge = true

  const ignoredHostKey = `bitlock-ignore:${window.location.hostname}`
  let lastCaptureFingerprint = ''
  let promptHost = null
  let promptTimer = null
  let promptEscapeHandler = null

  function isVisible(input) {
    if (!(input instanceof HTMLInputElement)) return false
    const style = window.getComputedStyle(input)
    const rect = input.getBoundingClientRect()
    return style.visibility !== 'hidden'
      && style.display !== 'none'
      && rect.width > 0
      && rect.height > 0
      && !input.disabled
  }

  function firstVisible(inputs) {
    return Array.from(inputs).find(isVisible) || null
  }

  function findPasswordField(scope = document) {
    return firstVisible(scope.querySelectorAll('input[type="password"]'))
  }

  function findUsernameField(passwordInput) {
    const scope = passwordInput?.form
      || passwordInput?.closest('[role="form"], main, section')
      || document

    const selectors = [
      'input[autocomplete="username"]',
      'input[type="email"]',
      'input[name*="email" i]',
      'input[name*="user" i]',
      'input[name*="login" i]',
      'input[type="text"]',
    ].join(',')

    return firstVisible(scope.querySelectorAll(selectors))
      || firstVisible(document.querySelectorAll(selectors))
  }

  function setNativeValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )
    descriptor?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function pageContext() {
    return {
      hostname: window.location.hostname.replace(/^www\./, ''),
      url: window.location.href,
      hasPasswordField: Boolean(findPasswordField()),
    }
  }

  function credentialFrom(passwordInput) {
    if (!passwordInput || !passwordInput.value) return null
    const usernameInput = findUsernameField(passwordInput)
    const hostname = window.location.hostname.replace(/^www\./, '')

    return {
      username: usernameInput?.value || '',
      password: passwordInput.value,
      hostname,
      label: hostname || document.title || 'Identifiant',
      url: window.location.href,
    }
  }

  async function scheduleCapture(passwordInput) {
    const credential = credentialFrom(passwordInput)
    if (!credential || sessionStorage.getItem(ignoredHostKey) === 'true') return

    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode([
        credential.hostname,
        credential.username,
        credential.password,
      ].join('\u0000')),
    )
    const fingerprint = Array.from(new Uint8Array(digest), byte => (
      byte.toString(16).padStart(2, '0')
    )).join('')

    if (fingerprint === lastCaptureFingerprint) return
    lastCaptureFingerprint = fingerprint
    window.setTimeout(() => showSavePrompt(credential), 180)
  }

  document.addEventListener('submit', (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null
    scheduleCapture(findPasswordField(form || document))
  }, true)

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    const target = event.target
    if (target instanceof HTMLInputElement && target.type === 'password' && !target.form) {
      scheduleCapture(target)
    }
  }, true)

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('button, input[type="submit"], [role="button"]')
      : null
    if (!target || target.closest('form')) return

    const passwordInput = findPasswordField(
      target.closest('[role="form"], main, section') || document,
    )
    if (passwordInput) scheduleCapture(passwordInput)
  }, true)

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return undefined

    if (message.type === 'BITLOCK_PAGE_CONTEXT') {
      sendResponse(pageContext())
      return undefined
    }

    if (message.type === 'BITLOCK_FILL') {
      const credential = message.credential || {}
      const passwordInput = findPasswordField()
      if (!passwordInput) {
        sendResponse({ ok: false, reason: 'NO_PASSWORD_FIELD' })
        return undefined
      }

      const usernameInput = findUsernameField(passwordInput)
      if (usernameInput && credential.username) {
        setNativeValue(usernameInput, String(credential.username))
      }
      setNativeValue(passwordInput, String(credential.password || ''))
      passwordInput.focus()
      sendResponse({ ok: true })
    }

    return undefined
  })

  function closePrompt() {
    promptHost?.remove()
    promptHost = null
    if (promptTimer) window.clearTimeout(promptTimer)
    promptTimer = null
    if (promptEscapeHandler) {
      document.removeEventListener('keydown', promptEscapeHandler, true)
      promptEscapeHandler = null
    }
  }

  function showSavePrompt(credential) {
    closePrompt()

    const host = document.createElement('div')
    host.id = 'bitlock-save-prompt-host'
    host.style.cssText = 'all:initial;position:fixed;inset:16px 16px auto auto;z-index:2147483647;'
    const shadow = host.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = `
      :host {
        --paper: oklch(15% 0.02 250);
        --paper-2: oklch(19% 0.024 250);
        --ink: oklch(96% 0.01 145);
        --muted: oklch(72% 0.025 250);
        --rule: oklch(31% 0.03 250);
        --accent: oklch(80% 0.19 145);
        --focus: oklch(88% 0.16 145);
        --shadow: oklch(5% 0.01 250 / 0.48);
        color-scheme: dark;
      }
      * { box-sizing: border-box; }
      .prompt {
        width: min(336px, calc(100vw - 32px));
        border: 1px solid var(--rule);
        border-radius: 8px;
        background: var(--paper);
        color: var(--ink);
        box-shadow: 0 18px 48px var(--shadow);
        font: 13px/1.5 "Segoe UI Variable", "Segoe UI", sans-serif;
        overflow: clip;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        border-bottom: 1px solid var(--rule);
        font-family: "Cascadia Mono", Consolas, monospace;
        font-weight: 700;
      }
      .brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .mark {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border: 1px solid var(--accent);
        border-radius: 6px;
        color: var(--accent);
      }
      .close, button {
        min-height: 44px;
        border: 1px solid var(--rule);
        border-radius: 6px;
        background: var(--paper-2);
        color: var(--ink);
        cursor: pointer;
        font: inherit;
      }
      .close { width: 44px; font-size: 18px; }
      .body { padding: 14px; }
      .site { margin: 0; font-weight: 700; overflow-wrap: anywhere; }
      .account { margin: 4px 0 0; color: var(--muted); overflow-wrap: anywhere; }
      .actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; margin-top: 14px; }
      button { padding-inline: 12px; white-space: nowrap; }
      .save { border-color: var(--accent); background: var(--accent); color: var(--paper); font-weight: 700; }
      button:hover { border-color: var(--accent); }
      button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
      button:active { transform: translateY(1px); }
      button:disabled { cursor: not-allowed; opacity: .55; }
      .never { margin-top: 10px; min-height: 44px; border: 0; background: transparent; color: var(--muted); padding: 0; }
      @media (prefers-reduced-motion: reduce) { button:active { transform: none; } }
    `

    const prompt = document.createElement('section')
    prompt.className = 'prompt'
    prompt.setAttribute('role', 'dialog')
    prompt.setAttribute('aria-label', 'Enregistrer l’identifiant dans BitLock')

    const head = document.createElement('div')
    head.className = 'head'
    const brand = document.createElement('div')
    brand.className = 'brand'
    const mark = document.createElement('span')
    mark.className = 'mark'
    mark.textContent = 'B'
    const title = document.createElement('span')
    title.textContent = 'BitLock'
    brand.append(mark, title)

    const close = document.createElement('button')
    close.className = 'close'
    close.type = 'button'
    close.setAttribute('aria-label', 'Fermer')
    close.textContent = '×'
    close.addEventListener('click', closePrompt)
    head.append(brand, close)

    const body = document.createElement('div')
    body.className = 'body'
    const site = document.createElement('p')
    site.className = 'site'
    site.textContent = `Enregistrer ${credential.hostname} ?`
    const account = document.createElement('p')
    account.className = 'account'
    account.textContent = credential.username || 'Compte sans identifiant'

    const actions = document.createElement('div')
    actions.className = 'actions'
    const save = document.createElement('button')
    save.className = 'save'
    save.type = 'button'
    save.textContent = 'Continuer dans BitLock'
    save.addEventListener('click', () => {
      save.disabled = true
      chrome.runtime.sendMessage({
        type: 'BITLOCK_CAPTURE_CREDENTIAL',
        credential,
      }, (response) => {
        if (response?.ok) closePrompt()
        else {
          save.disabled = false
          save.textContent = 'Réessayer'
        }
      })
    })

    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.textContent = 'Ignorer'
    dismiss.addEventListener('click', closePrompt)
    actions.append(save, dismiss)

    const never = document.createElement('button')
    never.className = 'never'
    never.type = 'button'
    never.textContent = 'Ne plus proposer pendant cette session'
    never.addEventListener('click', () => {
      sessionStorage.setItem(ignoredHostKey, 'true')
      closePrompt()
    })

    body.append(site, account, actions, never)
    prompt.append(head, body)
    shadow.append(style, prompt)
    document.documentElement.appendChild(host)
    promptHost = host

    promptEscapeHandler = (event) => {
      if (event.key === 'Escape') {
        closePrompt()
      }
    }
    document.addEventListener('keydown', promptEscapeHandler, true)
    promptTimer = window.setTimeout(closePrompt, 30_000)
  }
})()
