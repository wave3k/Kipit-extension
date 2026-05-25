/**
 * Content script - Détecte les soumissions de formulaires avec mot de passe
 * et propose de sauvegarder dans Kipit
 */

let lastSavedPassword = ''
let promptVisible = false

function observeForms() {
  const forms = document.querySelectorAll('form')

  forms.forEach(form => {
    if (form.dataset.kipitObserved) return
    form.dataset.kipitObserved = 'true'

    form.addEventListener('submit', () => {
      const passwordInput = form.querySelector('input[type="password"]')
      const emailInput = form.querySelector('input[type="email"], input[name="email"], input[name="username"], input[name="login"], input[type="text"]')

      if (passwordInput && passwordInput.value && passwordInput.value !== lastSavedPassword) {
        lastSavedPassword = passwordInput.value
        const siteName = window.location.hostname.replace('www.', '')
        const email = emailInput ? emailInput.value : ''

        showSavePrompt(siteName, email, passwordInput.value)
      }
    })
  })
}

function showSavePrompt(site, email, password) {
  if (promptVisible) return
  promptVisible = true

  const overlay = document.createElement('div')
  overlay.id = 'kipit-save-prompt'
  overlay.innerHTML = `
    <div style="position:fixed;top:16px;right:16px;z-index:999999;background:#171717;border:1px solid #404040;border-radius:12px;padding:16px;width:320px;font-family:-apple-system,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <div style="width:28px;height:28px;background:#16a34a;border-radius:6px;display:flex;align-items:center;justify-content:center;">
          <svg width="16" height="16" viewBox="0 0 32 32" fill="none"><path d="M16 4C16 4 8 7 8 7v7c0 5.5 3.4 10.3 8 13 4.6-2.7 8-7.5 8-13V7s-8-3-8-3z" stroke="white" stroke-width="2" fill="none"/></svg>
        </div>
        <span style="color:white;font-weight:600;font-size:14px;">Kipit</span>
      </div>
      <p style="color:#a3a3a3;font-size:12px;margin-bottom:12px;">Sauvegarder ce mot de passe pour <strong style="color:#e5e5e5;">${site}</strong> ?</p>
      <div style="display:flex;gap:8px;">
        <button id="kipit-save-yes" style="flex:1;padding:8px;background:#16a34a;color:white;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Sauvegarder</button>
        <button id="kipit-save-no" style="flex:1;padding:8px;background:#262626;color:#a3a3a3;border:1px solid #404040;border-radius:6px;font-size:12px;cursor:pointer;">Ignorer</button>
      </div>
    </div>
  `

  document.body.appendChild(overlay)

  document.getElementById('kipit-save-yes').addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'SAVE_PASSWORD',
      data: { site, email, password, url: window.location.href }
    })
    overlay.remove()
    promptVisible = false
  })

  document.getElementById('kipit-save-no').addEventListener('click', () => {
    overlay.remove()
    promptVisible = false
  })

  // Auto-dismiss après 10 secondes
  setTimeout(() => {
    if (overlay.parentNode) {
      overlay.remove()
      promptVisible = false
    }
  }, 10000)
}

// Observer les changements du DOM (pour les SPA)
const observer = new MutationObserver(() => observeForms())
observer.observe(document.body, { childList: true, subtree: true })
observeForms()
