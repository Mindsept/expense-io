# LE-01 — Tranche indépendante, 22 octobre 2026

Base de travail : `9adbd6e` (main avec les améliorations UI d'Elyes).
Node 24.19.0, dépendances du lockfile existant. Aucune modification du manifest,
du lockfile, de la configuration des tests ou des fichiers de Hamza/Elyes.

## Résultat et état

Validation/tri et adoption du contrat d'erreurs HA-07 implémentés dans les routes
personnelles. **Le ticket est encore incomplet.** HA-02 / PR #4 reste un brouillon
non intégré ; l'adoption de l'acteur courant et sa matrice HTTP/PostgreSQL ne
sont pas réalisées. Ne pas fusionner cette PR ni clôturer LE-01 sur cette preuve.
Le transfert des autres routes attend aussi les PR #7/#11 encore en brouillon.

Les premières régressions sur la base non modifiée ont donné 27 attentes en échec
sur 34 (validation, absence de mutations ou contrat d'erreurs), 7 en succès.
Notamment, un montant suffixé pouvait être accepté et un tri arbitraire atteignait
SQL ; les doubles ne constituent pas une preuve d'exploitation réelle de la DB.
Les mêmes assertions passent après le changement, sans être diminuées.

## Validation finale

| Contrôle | Résultat |
| --- | --- |
| `npm run test:unit` | 274 tests réussis, dont 77 LE-01 |
| `npm run lint` | code 0 |
| `npm run typecheck` | code 0 |
| `npm run build -- --webpack` | code 0 |
| `npm run test:api` | 48 tests réussis, dont 30 LE-01 |
| `git diff --check` | code 0 |

Les tests réels vérifient une connexion Auth.js, les six tris historiques, le
filtre utilisateur face à une autre entreprise, les bornes montant/date, les
descriptions invalides et les fichiers vides/mensongers/tronqués. Pour chaque
refus testé, le nombre de notes et la liste des objets S3 sont inchangés.
Six dépôts réussis couvrent PNG, JPEG baseline/progressif, WebP avec/sans perte
et PDF ; la somme maximale et une date future sont conservées, les octets S3
sont identiques au fichier soumis. Cela ne prouve ni l'acteur courant ni la RLS.

Environnement jetable : projet Compose `expense-leandro-20261022-test`, images
PostgreSQL 16-alpine et LocalStack 3.8.1, ports 127.0.0.1:15439 et :14569 ;
base `expense_leandro_test`, bucket `expense-leandro-test`, serveur Next de
production 127.0.0.1:13139. Schéma appliqué via `migrate:up`, bucket via
`ensure-bucket`, avec les seules variables de cet environnement. `.env` n'est
ni chargé pour choisir une cible, ni modifié. Chaque suite refuse une cible
non locale/non suffixée de test avant ses écritures, et nettoie ses seuls UUID.

Reproduction : préparer ces services isolés ; définir `DATABASE_URL`, les
variables S3 usuelles, un AUTH_SECRET privé généré, `AUTH_TRUST_HOST=true` puis
construire et lancer le serveur de production. Définir `LE01_TEST_BASE_URL` et
`LE01_TEST_DATABASE_URL` vers les mêmes cibles et lancer
`npm run test:api -- tests/api/leandro/LE-01`. Pour les régressions, ajouter les
variables HA01/HA07/LE04/LE12 documentées dans leurs suites et lancer toutes les
suites. Aucun secret ou cookie n'est un artefact à commiter.

## Ajustement d'une ancienne fixture et limites

L'ancien petit PNG encodé en base64 dans LE-12 échoue au décodage libpng
(`vipspng: libpng read error`). Il est remplacé par le PNG synthétique valide
déjà versionné dans LE-04. Les assertions de dépôt, DTO, isolation personnelle
et égalité des octets S3 restent intactes. Le nouveau validateur ne tolère pas
un fichier corrompu pour préserver une fixture incorrecte.

Pas de décodeur complet/antivirus ajouté. La limite de 10 MiB s'applique après
matérialisation multipart ; LE-05 doit borner la lecture HTTP. La cohérence
DB/S3, le contexte de l'UPDATE final et l'idempotence restent LE-02/LE-03.
Le plafond de description est technique et documenté, pas une décision métier
PO-01 revendiquée. Aucune nouvelle garantie de tenant/rôle tirée d'un ancien JWT.
Turbopack demeure limité par son IPC dans cet environnement ; Webpack réussit.
Aucun script E2E navigateur ou CI absent n'est annoncé comme exécuté.
