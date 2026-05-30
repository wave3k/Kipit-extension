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
  overlay.innerHTML = `
    <div style="position:fixed;top:16px;right:16px;z-index:999999;background:#171717;border:1px solid #404040;border-radius:12px;padding:16px;width:320px;font-family:-apple-system,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <div style="width:28px;height:28px;background:#2563eb;border-radius:6px;display:flex;align-items:center;justify-content:center;">
          <svg width="16" height="16" viewBox="0 0 32 32" fill="none"><path d="M16 4C16 4 8 7 8 7v7c0 5.5 3.4 10.3 8 13 4.6-2.7 8-7.5 8-13V7s-8-3-8-3z" stroke="white" stroke-width="2" fill="none"/></svg>
        </div>
        <span style="color:white;font-weight:600;font-size:14px;">Kipit</span>
      </div>
      <p style="color:#a3a3a3;font-size:12px;margin-bottom:12px;">Save this password for <strong style="color:#e5e5e5;">${site}</strong>?</p>
      ${email ? `<p style="color:#737373;font-size:11px;margin-bottom:8px;">Account: ${email}</p>` : ''}
      <div style="display:flex;gap:8px;">
        <button id="kipit-save-yes" style="flex:1;padding:8px;background:#2563eb;color:white;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Save</button>
        <button id="kipit-save-no" style="flex:1;padding:8px;background:#262626;color:#a3a3a3;border:1px solid #404040;border-radius:6px;font-size:12px;cursor:pointer;">Ignore</button>
      </div>
    </div>
  `

  document.body.appendChild(overlay)

  document.getElementById('kipit-save-yes').addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'SAVE_PASSWORD',
      data: { site, email, password, url }
    })
    overlay.remove()
    promptVisible = false
  })

  document.getElementById('kipit-save-no').addEventListener('click', () => {
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
