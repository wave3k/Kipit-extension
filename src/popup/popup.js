const API_URL = 'https://kipit-two.vercel.app';

// DOM elements
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const itemsList = document.getElementById('items-list');
const searchInput = document.getElementById('search-input');
const addModal = document.getElementById('add-modal');
const addForm = document.getElementById('add-form');
const closeModal = document.getElementById('close-modal');
const modalTitle = document.getElementById('modal-title');
const encryptCheckbox = document.getElementById('add-encrypt');
const masterPwdField = document.getElementById('master-pwd-field');

let currentType = 'link';
let sessionCookie = null;

// Init
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get(['kipitSession']);
  if (stored.kipitSession) {
    sessionCookie = stored.kipitSession;
    showDashboard();
    loadItems();
  } else {
    showLogin();
  }
});

// Login
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  loginError.classList.add('hidden');
  document.getElementById('login-btn').disabled = true;

  try {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || 'Erreur de connexion');
    }

    // Store session cookie
    const cookies = await chrome.cookies.getAll({ url: API_URL });
    const sessionCk = cookies.find(c => c.name.includes('session') || c.name.includes('auth'));
    
    if (sessionCk) {
      sessionCookie = `${sessionCk.name}=${sessionCk.value}`;
      await chrome.storage.local.set({ kipitSession: sessionCookie });
    }

    showDashboard();
    loadItems();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
  } finally {
    document.getElementById('login-btn').disabled = false;
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(['kipitSession']);
  sessionCookie = null;
  showLogin();
});

// Add buttons
document.querySelectorAll('.add-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentType = btn.dataset.type;
    const labels = { link: 'Ajouter un lien', password: 'Ajouter un mot de passe', crypto: 'Ajouter une clé crypto' };
    modalTitle.textContent = labels[currentType];
    addModal.classList.remove('hidden');
  });
});

closeModal.addEventListener('click', () => addModal.classList.add('hidden'));

// Encrypt toggle
encryptCheckbox.addEventListener('change', () => {
  masterPwdField.classList.toggle('hidden', !encryptCheckbox.checked);
});

// Add form
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const label = document.getElementById('add-label').value;
  let payload = document.getElementById('add-payload').value;
  const shouldEncrypt = encryptCheckbox.checked;
  const masterPwd = document.getElementById('add-master-pwd').value;
  let iv = null;

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
        'Cookie': sessionCookie || '',
      },
      credentials: 'include',
      body: JSON.stringify({ type: currentType, label, payload, is_encrypted: shouldEncrypt, iv }),
    });

    if (!res.ok) throw new Error('Erreur');

    addModal.classList.add('hidden');
    addForm.reset();
    masterPwdField.classList.add('hidden');
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
    item.style.display = label.includes(query) ? 'flex' : 'none';
  });
});

// Load items
async function loadItems() {
  try {
    const res = await fetch(`${API_URL}/api/vault`, {
      headers: { 'Cookie': sessionCookie || '' },
      credentials: 'include',
    });

    if (!res.ok) {
      if (res.status === 401) {
        await chrome.storage.local.remove(['kipitSession']);
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

function renderItems(items) {
  if (items.length === 0) {
    itemsList.innerHTML = '<p class="empty-state">Votre coffre-fort est vide</p>';
    return;
  }

  const icons = { link: '🔗', password: '🔑', crypto: '₿' };
  const typeLabels = { link: 'Lien', password: 'Mot de passe', crypto: 'Crypto' };

  itemsList.innerHTML = items.map(item => `
    <div class="item" data-id="${item.id}">
      <div class="item-icon ${item.type}">${icons[item.type]}</div>
      <div class="item-info">
        <div class="item-label">${item.label || 'Sans titre'}</div>
        <div class="item-meta">
          ${typeLabels[item.type]}
          ${item.is_encrypted ? ' · <span class="badge">🔒 Chiffré</span>' : ''}
        </div>
      </div>
      <div class="item-actions">
        ${!item.is_encrypted ? `<button onclick="copyItem('${item.payload}')" title="Copier">📋</button>` : ''}
      </div>
    </div>
  `).join('');
}

// Copy to clipboard
window.copyItem = async function(text) {
  await navigator.clipboard.writeText(text);
};

// Views
function showLogin() {
  loginView.classList.remove('hidden');
  dashboardView.classList.add('hidden');
}

function showDashboard() {
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
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
