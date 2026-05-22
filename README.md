# Kipit - Extension Chrome

Extension Chrome pour accéder à votre coffre-fort Kipit directement depuis votre navigateur.

## Fonctionnalités

- Connexion à votre compte Kipit
- Voir tous vos éléments (liens, mots de passe, crypto)
- Ajouter des éléments rapidement
- Chiffrement AES-256-GCM côté client
- Recherche dans le coffre-fort
- Copie en un clic

## Installation (Mode développeur)

1. Ouvrez Chrome → `chrome://extensions/`
2. Activez le **Mode développeur** (en haut à droite)
3. Cliquez sur **Charger l'extension non empaquetée**
4. Sélectionnez le dossier de ce projet

## Structure

```
├── manifest.json          # Configuration Chrome Extension
├── icons/                 # Icônes de l'extension
└── src/popup/
    ├── popup.html         # Interface principale
    ├── popup.css          # Styles
    └── popup.js           # Logique (auth, vault, crypto)
```

## Connexion à l'API

L'extension se connecte à `https://kipit-two.vercel.app` pour :
- Authentification (`/api/auth/login`)
- CRUD coffre-fort (`/api/vault`)

## Sécurité

- Le chiffrement se fait **dans l'extension** (côté client)
- Le mot de passe maître ne quitte jamais le navigateur
- Les sessions sont stockées localement via `chrome.storage`

## Par la Team RootLayer
