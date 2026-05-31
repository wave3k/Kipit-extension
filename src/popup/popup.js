const API_URL = 'https://kipit-two.vercel.app';

// DOM elements
const loginView = document.getElementById('login-view');
const confirmView = document.getElementById('confirm-view');
const dashboardView = document.getElementById('dashboard-view');
const logoutBtn = document.getElementById('logout-btn');
const itemsList = document.getElementById('items-list');
const siteMatchSection = document.getElementById('site-match-section');
const siteMatchList = document.getElementById('site-match-list');
const searchInput = document.getElementById('search-input');
const addModal = document.getElementById('add-modal');
const addForm = document.getElementById('add-form');
const closeModal = document.getElementById('close-modal');
const modalTitle = document.getElementById('modal-title');
const encryptCheckbox = document.getElementById('add-encrypt');
const masterPwdField = document.getElementById('master-pwd-field');
const pendingSaveBanner = document.getElementById('pending-save-banner');

let currentType = 'link';
let currentTabHostname = null;
let currentUrl = null;

// Init
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab URL
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0] && tabs[0].url) {
      const url = new URL(tabs[0].url);
      currentTabHostname = url.hostname.replace('www.', '');
    }
  } catch (e) {
    console.warn('Kipit: impossible de récupérer l\'URL de l\'onglet', e);
  }

  encryptCheckbox.checked = true;
  encryptCheckbox.disabled = true;
  masterPwdField.classList.remove('hidden');

  const stored = await chrome.storage.local.get(['kipitUser']);

  if (stored.kipitUser) {
    // Show confirm view
    showConfirmView(stored.kipitUser);
  } else {
    // Try to check if logged in on the site
    showLogin();
  }
});

// Open login page
document.getElementById('open-login-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://kipit-two.vercel.app/auth/login' });
});

// Check session after login on site
document.getElementById('check-session-btn').addEventListener('click', async () => {
  try {
    const res = await fetch('https://kipit-two.vercel.app/api/auth/me', {
      credentials: 'include',
    });

    if (res.ok) {
      const user = await res.json();
      await chrome.storage.local.set({
        kipitUser: { name: user.name, email: user.email, id: user.id }
      });
      showConfirmView({ name: user.name, email: user.email });
    } else {
      alert('Not logged in yet. Please sign in on the website first.');
    }
  } catch {
    alert('Could not connect. Please sign in on the website first.');
  }
});

// Confirm view
function showConfirmView(user) {
  loginView.classList.add('hidden');
  confirmView.classList.remove('hidden');
  dashboardView.classList.add('hidden');

  document.getElementById('confirm-avatar').textContent = user.name?.charAt(0)?.toUpperCase() || '?';
  document.getElementById('confirm-name').textContent = user.name || 'User';
  document.getElementById('confirm-email').textContent = user.email || '';
}

document.getElementById('confirm-continue-btn').addEventListener('click', () => {
  confirmView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  loadItems().then(prefillPendingItem);
});

document.getElementById('confirm-switch-btn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['kipitUser']);
  confirmView.classList.add('hidden');
  showLogin();
});

// Logout
logoutBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(['kipitUser']);
  dashboardView.classList.add('hidden');
  showLogin();
});

// Add buttons
document.querySelectorAll('.add-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentType = btn.dataset.type;
    currentUrl = null;
    pendingSaveBanner.classList.add('hidden');
    const labels = { link: 'Ajouter un lien', password: 'Ajouter un mot de passe', crypto: 'Ajouter une clé crypto' };
    modalTitle.textContent = labels[currentType];
    addModal.classList.remove('hidden');
  });
});

closeModal.addEventListener('click', () => {
  pendingSaveBanner.classList.add('hidden');
  addModal.classList.add('hidden');
});

// Encrypt toggle
encryptCheckbox.addEventListener('change', () => {
  encryptCheckbox.checked = true;
  masterPwdField.classList.remove('hidden');
});

// Add form
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const label = document.getElementById('add-label').value;
  let payload = document.getElementById('add-payload').value;
  const shouldEncrypt = true;
  const masterPwd = document.getElementById('add-master-pwd').value;
  let iv = null;

  if (!masterPwd) {
    alert('Mot de passe maitre requis pour chiffrer cet element.');
    return;
  }

  if (shouldEncrypt && masterPwd) {
    const encrypted = await encryptData(payload, masterPwd);
    payload = `${encrypted.salt}:${encrypted.ciphertext}`;
    iv = encrypted.iv;
  }

  try {
    const res = await fetch(`${API_URL}/api/vault`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ type: currentType, label, payload, is_encrypted: shouldEncrypt, iv, url: currentUrl || undefined }),
    });

    if (!res.ok) throw new Error('Erreur');

    addModal.classList.add('hidden');
    pendingSaveBanner.classList.add('hidden');
    addForm.reset();
    currentUrl = null;
    encryptCheckbox.checked = true;
    masterPwdField.classList.remove('hidden');
    loadItems();
  } catch (err) {
    alert('Erreur lors de l\'ajout');
  }
});

// Search
searchInput.addEventListener('input', () => {
  const query = searchInput.value.toLowerCase();
  document.querySelectorAll('.item').forEach(item => {
    const label = item.querySelector('.item-label').textContent.toLowerCase();
    const url = item.querySelector('.item-url');
    const urlText = url ? url.textContent.toLowerCase() : '';
    item.style.display = (label.includes(query) || urlText.includes(query)) ? 'flex' : 'none';
  });
});

// Load items
async function loadItems() {
  try {
    const res = await fetch(`${API_URL}/api/vault`, {
      credentials: 'include',
    });

    if (!res.ok) {
      if (res.status === 401) {
        await chrome.storage.local.remove(['kipitUser']);
        showLogin();
        return;
      }
      throw new Error('Erreur');
    }

    const data = await res.json();
    renderItems(data.items || []);
  } catch (err) {
    itemsList.innerHTML = '<p class="empty-state">Erreur de chargement</p>';
  }
}

function getHostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '';
  }
}

function itemMatchesCurrentSite(item) {
  if (!currentTabHostname || !item.url) return false;
  const itemHostname = getHostnameFromUrl(item.url);
  return itemHostname === currentTabHostname;
}

function renderItems(items) {
  if (items.length === 0) {
    renderEmpty(itemsList, 'Votre coffre-fort est vide');
    siteMatchSection.classList.add('hidden');
    return;
  }

  const icons = { link: '🔗', password: '🔑', crypto: '₿' };
  const typeLabels = { link: 'Lien', password: 'Mot de passe', crypto: 'Crypto' };

  // Separate matching items from the rest
  const matchingItems = items.filter(item => itemMatchesCurrentSite(item));
  const otherItems = items.filter(item => !itemMatchesCurrentSite(item));

  // Render site match section
  if (matchingItems.length > 0) {
    siteMatchSection.classList.remove('hidden');
    renderItemList(siteMatchList, matchingItems, icons, typeLabels, true);
  } else {
    siteMatchSection.classList.add('hidden');
    siteMatchList.innerHTML = '';
  }

  // Render the rest
  if (otherItems.length > 0) {
    renderItemList(itemsList, otherItems, icons, typeLabels, false);
  } else if (matchingItems.length > 0) {
    renderEmpty(itemsList, 'Tous les elements correspondent a ce site');
  } else {
    renderEmpty(itemsList, 'Votre coffre-fort est vide');
  }
}

function renderEmpty(target, text) {
  target.innerHTML = '';
  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = text;
  target.appendChild(empty);
}

function renderItemList(target, items, icons, typeLabels, isMatch) {
  target.innerHTML = '';
  items.forEach(item => target.appendChild(buildItemElement(item, icons, typeLabels, isMatch)));
}

function buildItemElement(item, icons, typeLabels, isMatch) {
  const root = document.createElement('div');
  root.className = `item${isMatch ? ' site-match' : ''}`;
  root.dataset.id = item.id;

  const icon = document.createElement('div');
  icon.className = `item-icon ${item.type}`;
  icon.textContent = icons[item.type] || 'Doc';

  const info = document.createElement('div');
  info.className = 'item-info';

  const label = document.createElement('div');
  label.className = 'item-label';
  label.textContent = item.label || 'Sans titre';
  info.appendChild(label);

  if (item.url) {
    const url = document.createElement('div');
    url.className = 'item-url';
    url.textContent = getHostnameFromUrl(item.url) || item.url;
    info.appendChild(url);
  }

  const meta = document.createElement('div');
  meta.className = 'item-meta';
  meta.textContent = typeLabels[item.type] || item.type;
  if (item.is_encrypted) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'Chiffre';
    meta.append(' · ', badge);
  }
  info.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  if (!item.is_encrypted) {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.title = 'Copier';
    copy.textContent = 'Copier';
    copy.addEventListener('click', () => copyItem(item.payload));
    actions.appendChild(copy);
  }

  root.append(icon, info, actions);
  return root;
}

// Copy to clipboard
window.copyItem = async function(text) {
  await navigator.clipboard.writeText(text);
};

// Views
function showLogin() {
  loginView.classList.remove('hidden');
  confirmView.classList.add('hidden');
  dashboardView.classList.add('hidden');
}

function showDashboard() {
  loginView.classList.add('hidden');
  confirmView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
}

async function prefillPendingItem() {
  const stored = await chrome.storage.session.get(['pendingVaultItem']);
  const pending = stored.pendingVaultItem;
  if (!pending) return;

  currentType = pending.type || 'password';
  currentUrl = pending.url || null;
  modalTitle.textContent = 'Ajouter un mot de passe';
  document.getElementById('add-label').value = pending.label || '';
  document.getElementById('add-payload').value = pending.payload || '';
  encryptCheckbox.checked = true;
  masterPwdField.classList.remove('hidden');
  pendingSaveBanner.classList.remove('hidden');
  addModal.classList.remove('hidden');

  await chrome.storage.session.remove(['pendingVaultItem']);
}

// Encryption (AES-256-GCM)
async function encryptData(plaintext, masterPassword) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(masterPassword), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
    salt: btoa(String.fromCharCode(...salt)),
  };
}
