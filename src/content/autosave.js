/**
 * Content script - Enhanced form detection
 * Detects password submissions across all types of forms
 */

let lastSavedPassword = ''
let promptVisible = false

// Detect password fields and monitor them
function observePasswordFields() {
  // Find all password inputs (including dynamically added ones)
  const passwordInputs = document.querySelectorAll('input[type="password"]')
  
  passwordInputs.forEach(input => {
    if (input.dataset.kipitObserved) return
    input.dataset.kipitObserved = 'true'

    // Detect Enter key press on password field
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        setTimeout(() => captureCredentials(input), 100)
      }
    })

    // Detect blur (user leaves the field - might have submitted)
    input.addEventListener('change', () => {
      // Store the value for later capture
      input.dataset.kipitValue = input.value
    })
  })

  // Find all submit buttons near password fields
  const buttons = document.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type]), [role="button"]')
  
  buttons.forEach(btn => {
    if (btn.dataset.kipitBtnObserved) return
    btn.dataset.kipitBtnObserved = 'true'

    btn.addEventListener('click', () => {
      // Find nearest password input
      const form = btn.closest('form')
      let passwordInput = null

      if (form) {
        passwordInput = form.querySelector('input[type="password"]')
      }
      
      if (!passwordInput) {
        // Look in parent containers (for form-less layouts)
        const container = btn.closest('div[class*="form"], div[class*="login"], div[class*="sign"], div[class*="auth"], section, main, [role="form"]')
        if (container) {
          passwordInput = container.querySelector('input[type="password"]')
        }
      }

      if (!passwordInput) {
        // Last resort: find any visible password input on the page
        const allPwdInputs = document.querySelectorAll('input[type="password"]')
        for (const inp of allPwdInputs) {
          if (inp.offsetParent !== null && inp.value) {
            passwordInput = inp
            break
          }
        }
      }

      if (passwordInput && passwordInput.value) {
        setTimeout(() => captureCredentials(passwordInput), 200)
      }
    })
  })
}

// Also observe traditional form submissions
function observeForms() {
  const forms = document.querySelectorAll('form')
  forms.forEach(form => {
    if (form.dataset.kipitFormObserved) return
    form.dataset.kipitFormObserved = 'true'

    form.addEventListener('submit', () => {
      const passwordInput = form.querySelector('input[type="password"]')
      if (passwordInput && passwordInput.value) {
        captureCredentials(passwordInput)
      }
    })
  })
}

// Capture credentials from a password input
function captureCredentials(passwordInput) {
  const password = passwordInput.value || passwordInput.dataset.kipitValue
  if (!password || password === lastSavedPassword) return

  lastSavedPassword = password
  const siteName = window.location.hostname.replace('www.', '')
  const url = window.location.href

  // Find associated email/username input
  let email = ''
  const form = passwordInput.closest('form') || passwordInput.closest('div[class*="form"], div[class*="login"], div[class*="sign"], section, main')
  
  if (form) {
    const emailInput = form.querySelector(
      'input[type="email"], input[name="email"], input[name="username"], input[name="login"], input[name="user"], input[autocomplete="email"], input[autocomplete="username"], input[type="text"]'
    )
    if (emailInput) email = emailInput.value
  }

  // If no email found in form, search broader
  if (!email) {
    const allInputs = document.querySelectorAll('input[type="email"], input[name="email"], input[name="username"]')
    for (const inp of allInputs) {
      if (inp.value) { email = inp.value; break }
    }
  }

  showSavePrompt(siteName, email, password, url)
}

function showSavePrompt(site, email, password, url) {
  if (promptVisible) return
  promptVisible = true

  const overlay = document.createElement('div')
  overlay.id = 'kipit-save-prompt'
  const card = document.createElement('div')
  card.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999999;background:#171717;border:1px solid #404040;border-radius:12px;padding:16px;width:320px;font-family:-apple-system,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,0.5);'

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;'

  const logo = document.createElement('div')
  logo.style.cssText = 'width:28px;height:28px;background:#2563eb;border-radius:6px;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;'
  logo.textContent = 'K'

  const title = document.createElement('span')
  title.style.cssText = 'color:white;font-weight:600;font-size:14px;'
  title.textContent = 'Kipit'
  header.append(logo, title)

  const message = document.createElement('p')
  message.style.cssText = 'color:#a3a3a3;font-size:12px;margin-bottom:12px;'
  message.append('Save this password for ')
  const strong = document.createElement('strong')
  strong.style.color = '#e5e5e5'
  strong.textContent = site
  message.append(strong, '?')

  card.append(header, message)

  if (email) {
    const account = document.createElement('p')
    account.style.cssText = 'color:#737373;font-size:11px;margin-bottom:8px;'
    account.textContent = `Account: ${email}`
    card.appendChild(account)
  }

  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;gap:8px;'

  const saveButton = document.createElement('button')
  saveButton.id = 'kipit-save-yes'
  saveButton.type = 'button'
  saveButton.style.cssText = 'flex:1;padding:8px;background:#2563eb;color:white;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;'
  saveButton.textContent = 'Save'

  const ignoreButton = document.createElement('button')
  ignoreButton.id = 'kipit-save-no'
  ignoreButton.type = 'button'
  ignoreButton.style.cssText = 'flex:1;padding:8px;background:#262626;color:#a3a3a3;border:1px solid #404040;border-radius:6px;font-size:12px;cursor:pointer;'
  ignoreButton.textContent = 'Ignore'

  actions.append(saveButton, ignoreButton)
  card.appendChild(actions)
  overlay.appendChild(card)

  document.body.appendChild(overlay)

  saveButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'SAVE_PASSWORD',
      data: { site, email, password, url }
    })
    overlay.remove()
    promptVisible = false
  })

  ignoreButton.addEventListener('click', () => {
    overlay.remove()
    promptVisible = false
  })

  // Auto-dismiss after 15 seconds
  setTimeout(() => {
    if (overlay.parentNode) {
      overlay.remove()
      promptVisible = false
    }
  }, 15000)
}

// Observe DOM changes for SPAs and dynamically loaded forms
const observer = new MutationObserver(() => {
  observePasswordFields()
  observeForms()
})

observer.observe(document.body, { childList: true, subtree: true })

// Initial scan
observePasswordFields()
observeForms()

// Re-scan periodically (catches lazy-loaded forms)
setInterval(() => {
  observePasswordFields()
  observeForms()
}, 3000)
