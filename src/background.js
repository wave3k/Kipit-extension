/**
 * Background service worker
 * Gère la sauvegarde des mots de passe détectés
 */

// Écouter les messages du content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_PASSWORD') {
    queueVaultSave(message.data)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('Kipit: erreur preparation sauvegarde', err)
        sendResponse({ ok: false })
      })
    return true
  }
})

async function queueVaultSave(data) {
  await chrome.storage.session.set({
    pendingVaultItem: {
      type: 'password',
      label: data.site || 'Sans titre',
      payload: data.email ? `${data.email}:${data.password}` : data.password,
      url: data.url || '',
      createdAt: Date.now(),
    },
  })

  try {
    await chrome.action.openPopup()
  } catch (err) {
    console.info('Kipit: ouvrez le popup pour terminer la sauvegarde chiffree.')
  }
}
