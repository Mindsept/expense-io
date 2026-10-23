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

## Validation initiale avant le socle commun

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
Aucun script E2E navigateur ou CI absent de cette ancienne base n'était annoncé
comme exécuté lors de ce premier passage.

## Intégration du socle MATH-01/02 après main `a0a0ab0`

La branche reprend le socle commun et la CI maintenant fusionnés : `verify`,
`test:collect`, `test:api`, `test:e2e` et `test:ci`. Le contrôle local `verify`
réussit avec 357 tests unitaires, lint et typage. Les résultats du pipeline complet
sont attachés au SHA testé dans les checks de la [PR #12](https://github.com/Mindsept/expense-io/pull/12).

Deux tests de non-authentification ajoutés par Mathis figeaient encore
`{error:'Unauthorized'}`. Leur migration est nécessaire à l'adoption HA-07 :
ils exigent maintenant le corps Problem Details exact, le statut 401, le type
de contenu et la corrélation en-tête/corps. Les deux sessions invalides et les
assertions d'absence de DB restent intactes. Aucun support partagé, runner ou
workflow n'est assoupli pour faire passer ces tests.

Le nouveau test `tests/e2e/leandro/LE-01/submission.spec.ts` utilise Chromium,
le formulaire et l'API réels, sans interception réseau : reçu mensonger refusé,
erreur HTTP corrélée et message de validation visible, champs conservés, absence de note, puis
correction du fichier, réussite unique et égalité des octets S3. Il consomme
les comptes fictifs et les variables isolées du socle, et ne nettoie que sa
description synthétique UUID dans la base/le bucket de test.

Ce complément retire la limite d'absence d'outillage E2E. Il ne retire pas le
blocage d'intégration HA-02 ni ne prouve la révocation des anciennes sessions.
Le `requestId` est vérifié dans le corps et l'en-tête HTTP ; l'interface actuelle
ne l'affiche pas. Le test ne suppose pas cet affichage absent et cible les alertes
du `<main>`, sans confondre l'annonceur de navigation Next avec une erreur métier.


## Intégration finale HA-02, après main `45086ba`

Les mentions de blocage HA-02 ci-dessus décrivent les validations antérieures.
HA-02 et HA-03 sont maintenant intégrés. GET/POST personnels utilisent
`withCurrentActor` ; les deux écritures de création sont scopées, avec garde
propriétaire sur l'UPDATE final et nouvelle vérification après upload. Aucun
verrou/transaction n'est tenu pendant le multipart ou S3. La cohérence atomique
et la compensation restent LE-02.

Les tests de consommation du vrai helper refusent l'acteur absent/inactif avant
SQL métier ; une désactivation après upload interdit la finalisation. Les tests
HTTP supplémentaires utilisent des sessions réelles, puis désactivent/suppriment
le compte ou changent son rôle/entreprise. Ils vérifient les 401 sans mutation
DB/S3, le retrait des droits RH et la continuité des opérations personnelles
encore permises, sans accepter userId/companyId/role soumis par le client.
Le contrat OpenAPI courant passe à v2, avec v1 conservé comme archive.

La campagne finale complète et son SHA sont enregistrés dans les checks et la
description de la PR #12 ainsi que dans le commentaire de clôture ARLA-19.
Aucun résultat de la campagne précédente n'est présenté comme preuve de ces
nouveaux scénarios. Les preuves sur le rôle privilégié de bootstrap ne prouvent
pas une RLS effective ; la limite de lecture HTTP et les créations partielles
restent des limites explicitement affectées à LE-05 et LE-02/03.

## Sélecteur E2E concurrent — 23 octobre 2026

La CI 39811210493 passe les 438 unitaires, 120 API et le build standard, puis
échoue dans EL-03 : `getByRole('status')` correspond simultanément au succès de
soumission et au chargement de l'historique. Le scénario LE-01 réel passe.
Le sélecteur EL-03 cible désormais le texte précis, sans première/dernière
occurrence ni assertion supprimée. Le rafraîchissement est maintenu en attente
par un deferred, ce qui reproduit systématiquement les deux statuts légitimes
pendant l'assertion, puis il est libéré. Le contrôle du résultat OCR obsolète,
du bouton et des champs reste intact. Aucun retry ou délai arbitraire ajouté.

### Résultat de reprise du 23 octobre

Sur `0d33bcb51382cd6997dfd9d31a41657c5d0c2a1d`, la campagne locale complète
réussit : lint/types, 438 unitaires, collecte, préparation PostgreSQL/S3 isolée,
build Webpack, 120 API, 13 Chromium E2E et nettoyage, toutes étapes code 0.
Le témoin EL-03 maintient volontairement le rafraîchissement en attente pendant
la vérification du succès ; aucune assertion métier ni aucun retry n'est retiré.

Le nouveau push n'a déclenché aucun run. Le lancement manuel du workflow existant
sur main avec `pr_number=12` retourne HTTP 422 : « Actions has been disabled for
this repository ». Aucun paramètre global Actions n'est modifié pour contourner
cette désactivation. La CI 39811210493 reste une preuve du build standard Linux,
des 438 unitaires et des 120 API du même code produit ; son échec navigateur est
le sélecteur désormais corrigé. Elle n'est pas présentée comme une CI verte du
dernier commit. Les seuls changements suivants concernent le test et la présente
preuve documentaire.
