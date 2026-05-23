/**
 * Background service worker
 * Gère la sauvegarde des mots de passe détectés
 */

const API_URL = 'https://kipit-two.vercel.app'

// Écouter les messages du content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_PASSWORD') {
    saveToVault(message.data)
  }
})

async function saveToVault(data) {
  const stored = await chrome.storage.local.get(['kipitSession'])
  if (!stored.kipitSession) return

  try {
    await fetch(`${API_URL}/api/vault`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': stored.kipitSession,
      },
      credentials: 'include',
      body: JSON.stringify({
        type: 'password',
        label: data.site,
        payload: data.email ? `${data.email}:${data.password}` : data.password,
        is_encrypted: false,
        iv: null,
      }),
    })
    console.log('Kipit: mot de passe sauvegardé pour', data.site)
  } catch (err) {
    console.error('Kipit: erreur sauvegarde', err)
  }
}
