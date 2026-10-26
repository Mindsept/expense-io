# Résultats — référence avec rôle limité

Campagne du 23 octobre 2026, fuseau Europe/Paris. Code **a48fb9c1ecc6f6546d6b12fe07d50ec270e2bb4d**, intégrant `main` **0265bd5** (dont ARLA-13, ARLA-45, pagination, pool OCR et nouveaux écrans). Les deux volumes ont le même SHA et les mêmes empreintes de code/lockfile. Premier volume : dossier propre ; second : seuls les résultats du premier volume sont non versionnés, comme indiqué dans `conditions.json`.

Node **24.22.1**, npm **11.19.1**, Next **16.4.3**, PostgreSQL **16.15**, macOS Darwin/arm64 et Colima local ; matériel et charge dans les conditions. Poste partagé, caches non vidés. Ces observations locales ne sont pas une capacité de production.

## Rôle effectivement mesuré

Les deux campagnes relèvent `current_user = session_user = expense_web`, `rolsuper=false`, `rolbypassrls=false`, `rolcreatedb=false`, `rolcreaterole=false`, `rolinherit=false`. Le contrôle HA-04 inchangé passe et aucune note n'est visible sans contexte acteur. Le serveur reçoit une configuration filtrée et la seule connexion `expense_web` ; les plans utilisent également ce LOGIN limité. La connexion bootstrap `expense_test` reste séparée pour préparer et contrôler la fixture. Les conditions distinguent ces identités. Aucune policy, migration, route ou permission métier modifiée.

## Listes HTTP

Trois passages de 30 requêtes par liste et volume, concurrence 4, aucune relance. Appels legacy sans pagination : 500/5 000 notes employé, 400/4 000 manager, 300/3 000 RH. L'API paginée existe dans ce main ; cette série conserve explicitement les listes entières.

| Notes | Liste | n | Médiane ms | p95 empirique ms | Médianes par passage ms | Erreurs |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | employee | 90 | 11.10 | 16.97 | 10.05–12.70 | 0/90 |
| 1,000 | manager | 90 | 22.83 | 28.95 | 22.45–23.64 | 0/90 |
| 1,000 | hr | 90 | 33.53 | 45.28 | 30.56–36.00 | 0/90 |
| 10,000 | employee | 90 | 51.31 | 64.35 | 49.75–52.88 | 0/90 |
| 10,000 | manager | 90 | 174.60 | 224.25 | 166.05–186.59 | 0/90 |
| 10,000 | hr | 90 | 280.23 | 423.01 | 275.25–321.13 | 0/90 |

**540/540 requêtes authentifiées conformes**, plus 18 échauffements conformes et deux contrôles anonymes 401 conservés comme erreurs diagnostiques distinctes. Aucun échec ou timeout retiré du dénominateur. Les deux `outcome.json` indiquent passed ; les deux commandes `bench:run` ont renvoyé 0 et supprimé seulement leur stack.

## Plans SELECT sous RLS

18 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, sous `expense_web` avec contexte acteur transactionnel. SELECT actuels, prédicat de validation partagé et tri secondaire UUID. Pas de mesure d'INSERT/UPDATE ni de création d'index. Temps SQL distinct du temps HTTP et du coût de résolution de l'acteur.

| Notes | Liste | Médiane SQL ms | Plage des 3 plans ms | Lignes renvoyées |
| --- | --- | --- | --- | --- |
| 1,000 | employee | 0.404 | 0.342–0.464 | 500 |
| 1,000 | manager | 13.313 | 13.101–13.822 | 400 |
| 1,000 | hr | 24.675 | 23.677–27.839 | 300 |
| 10,000 | employee | 2.764 | 2.739–2.920 | 5000 |
| 10,000 | manager | 138.661 | 136.973–143.619 | 4000 |
| 10,000 | hr | 242.737 | 242.614–243.606 | 3000 |

Les files manager/RH justifient une lecture des plans par Leandro pour LE-09. Cette observation ne démontre pas qu'un index suffira ; analyse et optimisation restent dans son ticket.

## OCR et reproductibilité

**48 reconnaissances réelles, 48 sorties conformes aux huit PNG synthétiques** ; parsing des textes sources également 48/48. Initialisations, première reconnaissance et worker réutilisé distingués dans les fichiers bruts. Ce diagnostic hors HTTP ne mesure ni la file ni la saturation du pool OCR actuel. Aucune précision générale sur des photos de reçus déduite de ce petit corpus.

Une troisième stack régénère indépendamment les 1 000 notes : [empreinte et distribution](reproducibility.json). Aucun nouvel HTTP/OCR mesuré lors de ce contrôle. La [mauvaise cible](unsafe-target.log) est refusée avant écriture avec code 1, comme attendu.

## Validation commune et réception

`npm ci --no-audit --no-fund` : sortie 0. `npm run test:ci` : sortie 0 ; lint, typage, **665 unitaires, 223 API, 25 E2E Chromium**, collecte des quatre propriétaires, build, services et nettoyage réussis. Les sept nouveaux cas de contrôle d'environnement et les trois tests de métriques passent. Aucun test des autres auteurs modifié. L'ancien échec macOS `kill EPERM` ne se reproduit pas dans cette campagne.

La chaîne commune a commencé sur le contenu ensuite commité en a48fb9c, sans modification de code pendant son exécution. Ces rapports sont les preuves locales ; la CI distante de la tête publiée reste à consulter sur [PR #17](https://github.com/Mindsept/expense-io/pull/17). Le serveur commun MATH-02 conserve sa déclaration de baseline privilégiée ; les suites HA-04 et ce benchmark utilisent leurs vrais rôles limités. La réussite commune ne constitue pas à elle seule une preuve d'isolation exhaustive.

Rapports : [étapes/codes/durées](local-ci-summary.json), [collecte](local-ci-collect.log), [unitaires/lint/typage](local-ci-verify.log), [API](local-ci-api.log), [E2E](local-ci-e2e.log), [journal commun](local-ci.log).

Données : [1 000 notes](1000/summary.json), [10 000 notes](10000/summary.json) ; chaque dossier contient conditions, HTTP, plans, OCR, état final et journaux. [Protocole et relance](../../post-rls.md).

Les [mesures du 22 octobre](../../reference.md) restent historiques. Plusieurs contrats ont changé : aucune différence attribuée à la seule RLS, à la pagination ou à un index. Aucun gain d'optimisation annoncé. La réception/relecture Leandro reste attendue ; aucune validation humaine cochée automatiquement. ARLA-42 reprendra les preuves sur sa version de remise. Les slides restent inchangées à la demande de Mathis.
