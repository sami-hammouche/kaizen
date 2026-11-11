# Kaizen web – contexte pour Claude Code

Site public (statique, GitHub Pages) pour piloter l'extension **Kaizen** (dossier `C:\Users\samip\vinted-pilot`,
voir son CLAUDE.md) depuis un téléphone ou un autre PC. Projet de Sami ; il ne veut rien payer.

## Architecture
- Le site ne parle **jamais** à Vinted. Il lit l'état envoyé par l'extension et envoie des ordres.
- Relais = **Supabase** (gratuit) : `supabase/schema.sql` crée `snapshots` (1 ligne/utilisateur : `data` jsonb,
  `seen_at` = signal de vie chaque minute) et `commands` (ordres : pending → running → done/error),
  RLS « chacun ses lignes », fonctions `delete_my_account` et `prune_commands`, realtime sur les deux tables.
- Extension : `background/cloud.js` (alarme toutes les 30 s) lit les ordres, n'exécute que la liste blanche
  `CLOUD_ACTIONS` via `handlers`, renvoie l'état (`buildSnapshot`) au plus toutes les 5 min, ou après un ordre,
  ou toutes les minutes pendant une republication ; sinon un simple PATCH `seen_at`.
- Site : `index.html` + `js/` (modules ES, pas de build) : `config.js` (URL + clé anon Supabase, publiques),
  `api.js` (supabase-js 2.45.4 depuis jsdelivr ; `window.__kaizenClient` = faux client en test),
  `main.js` (comptes, navigation, temps réel + relecture toutes les 20 s), `views.js` (5 écrans, un seul
  écouteur de clics délégué), `util.js`. PWA : `manifest.webmanifest`, `sw.js`, `icons/`.

## Règles
- Les clés de réglages envoyées par `saveSettings` doivent exister dans l'extension (sections `NESTED`).
- Si les données échangées changent : augmenter `API_VERSION` (extension) et adapter `views.js`.
- Ne jamais stocker de mot de passe / session Vinted côté site. Ne jamais utiliser la clé `service_role`.
- Avertissement CGU Vinted + « non affilié » visibles (accueil, inscription, `privacy.html`).

## Tests
`python tools/dev_server.py` puis http://127.0.0.1:8767/tests/app.html (faux Supabase : `tests/fake-supabase.js`).
Côté extension : `tests/bg-cloud.html` dans vinted-pilot. Icônes : http://127.0.0.1:8767/tools/icons.html.

## Mise en ligne
Voir `MISE-EN-LIGNE.md`. `downloads/kaizen.zip` = paquet de l'extension (`python tools/build.py` dans vinted-pilot).
Répondre à Sami en français simple, résultat d'abord, étapes concrètes.
