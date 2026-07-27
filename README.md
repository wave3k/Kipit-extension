# BitLock — Extension Chrome locale

L’extension BitLock permet de rechercher, déchiffrer, copier, remplir et
enregistrer des identifiants depuis l’instance locale de BitLock.

## Fonctions

- connexion avec un jeton d’extension révocable ;
- déverrouillage avec le mot de passe maître, conservé uniquement en mémoire ;
- affichage prioritaire des comptes correspondant au site actif ;
- remplissage du username et du mot de passe ;
- capture après une action explicite de soumission ;
- validation avant enregistrement d’un identifiant détecté ;
- chiffrement AES-256-GCM côté extension ;
- génération de mots de passe forts ;
- recherche locale dans les éléments déjà déchiffrés.

## Prérequis

1. Lancer BitLock sur `http://localhost:3000`.
2. Se connecter à BitLock.
3. Ouvrir les paramètres de sécurité et créer un jeton d’extension.
4. Copier le jeton commençant par `blx_`.

Le jeton n’est affiché qu’au moment de sa création. Il peut être révoqué depuis
les paramètres BitLock.

## Installation

1. Ouvrir `chrome://extensions/`.
2. Activer le mode développeur.
3. Choisir **Charger l’extension non empaquetée**.
4. Sélectionner le dossier `Kipit-extension`.
5. Ouvrir le popup BitLock et coller le jeton.

Après une modification du code, utiliser le bouton **Actualiser** de la carte
de l’extension dans `chrome://extensions/`.

## Sécurité

- Le mot de passe maître n’est jamais écrit dans `chrome.storage`.
- Une credential capturée reste en mémoire dans le service worker pendant deux
  minutes au maximum.
- Le serveur reçoit uniquement un payload chiffré avec AES-256-GCM.
- Le jeton d’extension donne accès uniquement aux routes dédiées aux mots de
  passe chiffrés.
- Le remplissage est déclenché par un clic explicite dans le popup.
- L’extension ne demande ni la permission `cookies`, ni la permission `tabs`.

Le jeton est stocké dans l’espace privé de l’extension afin de conserver la
connexion après le redémarrage du navigateur. Verrouiller le coffre efface
immédiatement les données déchiffrées de la mémoire du popup.

## Validation

```powershell
bun run test
```

Le validateur contrôle la syntaxe JavaScript, le manifeste, les permissions,
les identifiants DOM, les anciennes URL et les erreurs d’encodage.

## Structure

```text
manifest.json
icons/
scripts/validate.mjs
src/background.js
src/content/autosave.js
src/popup/popup.html
src/popup/popup.js
src/popup/popup.css
src/popup/tokens.css
```
