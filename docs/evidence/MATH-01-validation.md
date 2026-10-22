# MATH-01 / ARLA-39 — preuve de validation

Campagne du 22 octobre 2026, fuseau Europe/Paris. Base : `9adbd6e7e9c1f76351b0dee5e1abc441a06fa696`,
branche `codex/arla-39-test-foundation`, avec les modifications du ticket dans
le dossier de travail. Ce résultat n'est pas attribué au seul SHA de base :
les empreintes exactes des fichiers de code/configuration testés sont dans
[metadata.json](MATH-01/metadata.json). Aucun fichier applicatif, migration,
Compose principal, Makefile ou lockfile n'a été modifié.

## Résultats réellement obtenus

| Contrôle | Code de sortie | Résultat |
| --- | --- | --- |
| Référence avant modification : lint, typecheck, unitaires | 0 / 0 / 0 | 196 tests unitaires existants passent |
| `npm ci --no-audit --no-fund` | 0 | 476 paquets ; avertissements ESLint 9 hors support et scripts non approuvés conservés ; aucune approbation ajoutée |
| `npx playwright install chromium` via la CLI locale verrouillée | 0 | Chromium 156.0.8078.4, révision Playwright 1248, installé |
| `npm run verify` | 0 | Lint, typecheck et **210 unitaires** réussis, dont 14 Mathis ; [sortie](MATH-01/verify.txt) |
| `npm run build` | 0 | Next 16.3.5, build Turbopack de production ; [sortie](MATH-01/build.txt) |
| `npm run test:collect` | 0 | 11 fichiers unitaires / 4 propriétaires ; 6 API / 3 propriétaires ; 1 E2E / Mathis ; [liste](MATH-01/collect.txt) |
| `npm run test:api -- tests/api/mathis/MATH-01` | 0 | Vraie requête anonyme : 401 ; [sortie](MATH-01/mathis-api.txt) |
| `npm run test:api` | 0 | **19 tests API/intégration** réussis, dont les suites existantes HA-01/HA-07/LE-04/LE-12 ; [sortie](MATH-01/api-all.txt) |
| `npm run test:smoke` | 0 | **3/3 connexions réelles Chromium** réussies après le contrôle négatif ; [sortie](MATH-01/smoke.txt) |
| Mot de passe employé volontairement faux, filtre `employee signs in` | 1 attendu | **Un vrai test exécuté et échoué** : `/login` au lieu de `/expenses` ; [sortie](MATH-01/bad-password-control.txt) |
| URL explicite retirée | 1 attendu | Refus de configuration avant connexion ; [sortie](MATH-01/missing-url-control.txt) |
| Exclusion temporaire des unitaires Elyes | 1 attendu | Le collecteur refuse le propriétaire manquant ; configuration restaurée octet pour octet et collecte repassée ; [sortie](MATH-01/missing-owner-control.txt) |

Les durées observées et commandes exactes sont conservées dans les métadonnées.
Les 19 tests API incluent de l'intégration PostgreSQL/S3/OCR et des contrôles
de configuration ; ce nombre n'est pas présenté comme 19 parcours navigateur.
La collecte liste des déclarations/fichiers et n'est pas comptée parmi les tests réussis.

Deux erreurs de mise au point ont été corrigées avant le résultat final :
le type `ProcessEnv` enrichi par Next exigeait `NODE_ENV` dans les doubles
d'environnement, corrigé par un dictionnaire de variables ; un premier filtre
`^employee ` ne sélectionnait aucun test. Ce dernier essai n'est **pas** la
preuve négative : le filtre corrigé a exécuté et fait échouer le vrai smoke,
puis les trois smokes ont été rejoués avec succès. Les codes non nuls restent
présents dans les métadonnées ; aucun test n'est ignoré ou déclaré en échec attendu.

## Environnement et limites

Node 24.21.0 / npm 11.19.0, macOS ARM64. PostgreSQL `16-alpine` et LocalStack
`3.8.1` dans un nouveau projet Compose réservé à cette campagne ; base
`expense_io_test`, bucket `receipts-math01-test`, ports loopback distincts
55439/45739 et application 3199. La suite HA-01 possède ses serveurs au port
3198. La préparation a utilisé les migrations, le bucket et le seed existants,
uniquement sur cette nouvelle base vide. Aucun `.env` de développement n'a été créé,
écrasé ou publié. Les identifiants aléatoires ne sont pas dans les preuves.

Le serveur de test utilise le rôle bootstrap existant, `expense_test`, avec
`rolsuper=true` et `rolbypassrls=true` : [constat réel](MATH-01/database-role.txt).
**Ces résultats ne démontrent pas la RLS ni l'absence complète d'accès croisés.**
HA-04 demeure au périmètre Hamza. La préparation partagée et GitHub Actions
restent à MATH-02 ; cette stack de premier passage était manuelle et temporaire.
Les versions applicatives n'ont pas été mises à jour dans ce ticket.

Les logs versionnés ont été expurgés ; pas de trace, vidéo, cookie, état
d'authentification, archive DB ou URL signée utilisable. Le rôle de préparation
privilégié n'est pas une prescription pour le rôle applicatif final.

## Revue encore requise

Leandro doit relire la configuration avant fusion. Mathis doit savoir ouvrir
les tests, expliquer les assertions et reproduire les deux résultats. Les
contrôles techniques ci-dessus sont exécutés ; la revue humaine n'est pas
inventée. Voir [le guide](../tests.md), [les défauts ouverts](../defauts-ouverts.md)
et [la restitution HTML](../restitution-mathis.html).
