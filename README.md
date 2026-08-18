# 🌾 Carte de la Moisson — INP-HB Centre

Application de suivi de l'évangélisation des chambres du campus INP-HB Centre.
Fonctionne hors connexion (IndexedDB), se synchronise automatiquement entre
tous les frères dès qu'il y a du réseau (Supabase), et s'installe comme une
application sur téléphone Android (PWA — Progressive Web App).

---

## 1. Vue d'ensemble technique

| Élément | Technologie |
|---|---|
| Interface | HTML/CSS/JS natif (aucune installation requise, pas de build) |
| Stockage local hors-ligne | IndexedDB (dans le navigateur/l'app) |
| Synchronisation & base partagée | Supabase (PostgreSQL gratuit) |
| Installation sur Android | PWA (manifest + service worker) |
| Hébergement | GitHub Pages (gratuit) |

Il n'y a **aucune étape de compilation** : ce sont des fichiers statiques.
Tu peux littéralement glisser ce dossier dans un dépôt GitHub et l'activer.

---

## 2. Créer la base de données (Supabase — gratuit)

1. Va sur https://supabase.com et crée un compte gratuit.
2. Clique sur **New project**, choisis un nom (ex. `carte-moisson`) et un mot
   de passe pour la base (à conserver de côté, tu n'en auras pas besoin ici).
3. Une fois le projet créé, va dans **SQL Editor** (menu de gauche) →
   **New query**.
4. Ouvre le fichier [`supabase/schema.sql`](./supabase/schema.sql) de ce
   projet, copie tout son contenu, colle-le dans l'éditeur SQL, puis clique
   sur **Run**.
5. Va ensuite dans **Project Settings → API**. Tu y trouveras :
   - **Project URL** (ex. `https://abcdefgh.supabase.co`)
   - **anon public key** (une longue chaîne de caractères)
6. Ouvre le fichier [`config.js`](./config.js) de ce projet et remplace :
   ```js
   window.SUPABASE_CONFIG = {
     url: "https://VOTRE-PROJET.supabase.co",
     anonKey: "VOTRE_CLE_ANON_PUBLIQUE"
   };
   ```
   par tes propres valeurs.

⚠️ La clé "anon" est conçue pour être publique côté client (ce n'est pas un
mot de passe secret) — c'est normal qu'elle apparaisse dans le code. Les
règles de sécurité (RLS) définies dans `schema.sql` limitent ce qui peut être
fait avec cette clé.

---

## 3. Mettre le projet sur GitHub

1. Crée un compte sur https://github.com si tu n'en as pas.
2. Crée un nouveau dépôt (bouton **New repository**), par exemple nommé
   `carte-moisson`. Laisse-le **public** (nécessaire pour GitHub Pages
   gratuit).
3. Mets tous les fichiers de ce dossier dans ce dépôt. Deux façons de faire :

   **Option A — via le site GitHub (sans ligne de commande) :**
   - Sur la page du dépôt, clique sur **Add file → Upload files**.
   - Glisse-dépose tous les fichiers et dossiers de ce projet
     (`index.html`, `app.js`, `styles.css`, `config.js`, `manifest.json`,
     `service-worker.js`, le dossier `icons/`, le dossier `supabase/`, ce
     `README.md`).
   - Clique sur **Commit changes**.

   **Option B — via Git en ligne de commande :**
   ```bash
   cd carte-moisson-app
   git init
   git add .
   git commit -m "Première version de l'application"
   git branch -M main
   git remote add origin https://github.com/TON-COMPTE/carte-moisson.git
   git push -u origin main
   ```

---

## 4. Activer GitHub Pages (hébergement gratuit)

1. Dans le dépôt GitHub, va dans **Settings → Pages**.
2. Sous **Source**, choisis **Deploy from a branch**.
3. Sous **Branch**, choisis `main` et le dossier `/ (root)`, puis **Save**.
4. Après 1 à 2 minutes, ton application sera disponible à une adresse du
   type :
   ```
   https://TON-COMPTE.github.io/carte-moisson/
   ```

C'est cette adresse que tu partages avec les frères.

---

## 5. Installer l'application sur un téléphone Android

1. Ouvre l'adresse ci-dessus dans **Chrome** sur le téléphone Android.
2. Un bandeau **« Installer l'application »** doit apparaître en bas de
   l'écran — appuie sur **Installer**.
   - Si le bandeau n'apparaît pas : ouvre le menu **⋮** de Chrome →
     **Ajouter à l'écran d'accueil** (ou **Installer l'application**).
3. Une icône « Carte de la Moisson » apparaît sur l'écran d'accueil, comme
   une vraie application, avec son propre écran (sans la barre d'adresse du
   navigateur).

C'est une **PWA installable**, pas un fichier `.apk` classique du Play
Store — c'est la méthode standard, gratuite et sans compte développeur, pour
distribuer ce type d'application en dehors du Play Store. Elle fonctionne
exactement comme une app native : icône, plein écran, notifications hors
ligne, etc.

---

## 6. Fonctionnement hors connexion

- Les chambres consultées et les visites enregistrées sont sauvegardées
  immédiatement dans **IndexedDB**, sur l'appareil — donc disponibles même
  sans Internet, y compris après avoir fermé et rouvert l'application.
- Tant qu'il n'y a pas de réseau, les modifications restent dans une file
  d'attente locale (visible dans **Admin**).
- Dès que le réseau revient, la file est automatiquement envoyée vers
  Supabase, et les changements des autres frères sont récupérés.
- Les mises à jour se font **par étudiant** (colonne par colonne dans la
  base), donc si deux frères modifient la même chambre en même temps
  (ex. l'un coche l'étudiant 1, l'autre l'étudiant 2), les deux
  modifications sont conservées — aucune ne écrase l'autre.

---

## 7. Structure des fichiers

```
carte-moisson-app/
├── index.html            → page principale
├── styles.css             → apparence de l'application
├── app.js                 → logique (IndexedDB, Supabase, interface)
├── config.js               → tes identifiants Supabase (à remplir)
├── manifest.json           → configuration PWA (icône, nom, couleurs)
├── service-worker.js       → mise en cache pour le fonctionnement hors-ligne
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── supabase/
│   └── schema.sql          → script de création des tables Supabase
└── README.md                → ce document
```

---

## 8. Mettre à jour l'application plus tard

Pour changer une couleur, un texte, ajouter une fonctionnalité : modifie les
fichiers, puis re-upload / `git push` vers GitHub. GitHub Pages republie
automatiquement en 1-2 minutes. Les frères qui ont déjà installé
l'application recevront la mise à jour automatiquement au prochain
lancement (grâce au service worker).

---

## 9. Limites à connaître

- Il n'y a pas de système de comptes avec mot de passe : l'identité d'un
  frère est simplement le nom qu'il saisit à la première ouverture (stocké
  sur son appareil). C'est volontairement simple, adapté à une petite
  équipe de confiance — pas à un usage public.
- La clé Supabase "anon" utilisée ici a des droits de lecture/écriture
  ouverts (voir `supabase/schema.sql`). Si tu veux restreindre l'accès
  (ex. avec un mot de passe d'équipe), il faudra ajouter l'authentification
  Supabase — je peux t'aider à faire évoluer le projet dans cette direction
  si besoin.
