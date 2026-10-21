# LE-12 — Validation du 21 octobre 2026

Base examinée : `522d7b5` (Mindsept/expense-io, main). Node 24.19.0,
installation exacte par `npm ci` ; aucun manifest ni lockfile modifié.

| Contrôle | Résultat |
| --- | --- |
| `npm run test:unit` | 138 tests réussis, dont 36 LE-12 |
| `npm run lint` | code 0 |
| `npm run typecheck` | code 0 |
| `npm run build -- --webpack` | code 0, build de production |
| `npm run test:api` | 11 tests réussis : 3 HA-01, 7 HA-07, 1 LE-12 |
| `git diff --check` | code 0 |

Le test HTTP LE-12 utilise une vraie connexion Auth.js, le serveur Next de
production, PostgreSQL 16 et LocalStack 3.8.1. Il envoie un PNG synthétique,
vérifie les octets S3, le DTO POST puis son égalité avec le DTO GET. Une seconde
note appartenant à un autre employé ne figure pas dans la liste personnelle.
Cela prouve ce parcours et son filtre, pas l'isolation RLS future de HA-04.

Environnement jetable : projet Compose `expense-leandro-20261021-test`, sans
volume partagé, ports `127.0.0.1:15439` (Postgres) et `127.0.0.1:14569` (S3),
base `expense_leandro_test`, bucket `expense-leandro-test`. Le serveur de test
écoute sur `127.0.0.1:13139`. Le schéma initial est appliqué par `migrate:up` et
le bucket par `ensure-bucket` avec ces seules cibles. Les données de développement
et `.env` ne sont pas utilisés. Les tests refusent des cibles non locales ou sans
suffixe de test et nettoient uniquement leurs UUID/objets synthétiques.

Pour reproduire, préparer ces services isolés, définir `DATABASE_URL`, les
variables S3 habituelles, un `AUTH_SECRET` privé généré, `AUTH_TRUST_HOST=true`,
puis construire et lancer `next start --hostname 127.0.0.1 --port 13139`.
Définir `LE12_TEST_BASE_URL`, `LE12_TEST_DATABASE_URL` avec ces mêmes cibles et
lancer `npm run test:api -- tests/api/leandro/LE-12`.
Pour les régressions existantes, définir aussi `HA01_TEST_DATABASE_URL`,
`HA07_TEST_BASE_URL`, `HA07_TEST_DATABASE_URL` et un `HA07_TEST_PASSWORD`
aléatoire, puis lancer `npm run test:api`. HA-01 lance ses propres serveurs sur
son port distinct. Aucun secret ni cookie n'est une preuve à commiter.

Limites : le build Turbopack par défaut échoue ici sur la création d'un port IPC
(`Operation not permitted` dans PostCSS) ; le premier essai sandboxé échouait
aussi au téléchargement Google Fonts. Le build Webpack réel réussit avec accès
réseau. Aucun script `test:e2e` navigateur n'existe dans cette base ; aucune suite
future MATH-01 n'est annoncée comme exécutée. Les DTO manager/RH/frontend sont
publiés pour adoption par leurs propriétaires, sans modification de leurs droits.

Relecture : validation explicite des champs exportés, conservation des anciennes
clés S3, des dates civiles et du filtre utilisateur ; erreur de mapping attendue
dans le GET pour qu'une valeur invalide ne contourne pas la frontière d'erreurs.
La recette humaine de l'équipe reste distincte de cette validation automatisée.
