# Mettre le site Kaizen en ligne (gratuit)

Deux services gratuits, sans carte bancaire :
- **Supabase** : comptes des utilisateurs + relais entre le site et l'extension.
- **GitHub Pages** : héberge le site (adresse du type `https://<ton-pseudo>.github.io/kaizen/`).

## 1. Supabase (≈ 5 minutes)
1. Va sur https://supabase.com → **Start your project** → connecte-toi avec GitHub.
2. **New project** : nom `kaizen`, mot de passe de base de données (garde-le pour toi),
   région **West EU (Paris)** ou la plus proche, plan **Free**.
3. Quand le projet est prêt : menu **SQL Editor** → **New query** → colle tout le contenu de
   `supabase/schema.sql` → **Run**. Tu dois voir « Success ».
4. Menu **Project Settings → API** (ou **Data API**) : copie
   - **Project URL** (ex. `https://abcd1234.supabase.co`)
   - la clé **anon public** (longue clé qui commence par `eyJ…`).
   Ces deux valeurs sont publiques : tu peux les donner à Claude.
   **Ne donne jamais la clé `service_role`** (secrète).
5. Menu **Authentication → URL Configuration** : mets **Site URL** = l'adresse du site
   (étape 2 ci-dessous), et ajoute la même adresse dans **Redirect URLs**.

## 2. GitHub Pages (≈ 5 minutes)
1. Sur https://github.com/new : nom du dépôt `kaizen`, **Public**, sans README → **Create repository**.
2. Envoie le dossier `kaizen-web` dans ce dépôt (Claude peut le faire avec git).
3. Dans le dépôt : **Settings → Pages** → Source **Deploy from a branch**, branche `main`, dossier `/ (root)` → **Save**.
4. Une minute plus tard, le site est en ligne sur `https://<ton-pseudo>.github.io/kaizen/`.

## 3. Relier les deux
Donne à Claude l'URL Supabase et la clé anon : il les met dans `js/config.js` (site)
et `background/cloud.js` (extension), reconstruit le ZIP de l'extension dans
`downloads/kaizen.zip`, et publie.

## Limites du plan gratuit (largement suffisantes au début)
- Supabase Free : 50 000 utilisateurs actifs par mois, 500 Mo de base de données.
  Un projet sans aucune activité pendant 7 jours est mis en pause (un clic pour le relancer).
- E-mails de confirmation : quelques-uns par heure avec l'envoi intégré de Supabase.
  Pour beaucoup d'inscriptions, il faudra brancher un service d'e-mail (Resend, Brevo… gratuits au début).
