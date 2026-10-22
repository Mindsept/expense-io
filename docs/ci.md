# MATH-02 / ARLA-40 — stack de test et GitHub Actions

La référence commune utilise les trois comptes de démonstration existants.
Elle ne prétend pas intégrer les fixtures de deux entreprises ni le rôle
applicatif limité qui restent à Hamza dans HA-04. Elle n'active aucune policy,
ne modifie aucune migration et ne corrige pas les tests métier des autres auteurs.

## Une commande depuis un checkout vierge

Utiliser Node **24.22.1** (`.nvmrc`) et npm **11.19.1** (`packageManager`),
Docker local et la CLI Playwright verrouillée. La distribution officielle Node
a été contrôlée par SHA-256 pour le passage local, sans modifier Node global.

```bash
npm ci
npx playwright install chromium
npm run test:ci
```

Le job Linux utilise `npx playwright install --with-deps chromium` pour ses
bibliothèques système. La chaîne est la même en local et dans la CI :

1. Charger/créer la configuration privée et refuser toute cible incohérente.
2. Relever SHA, modifications locales, runtime et empreinte du lockfile.
3. Exécuter `verify` (lint, typage, unitaires), puis le contrôle de collecte.
4. Vérifier le moteur Docker local et la disponibilité des ports dédiés.
5. Préparer uniquement le nouveau projet Compose, attendre sa santé dans un
   délai maximal de 90 secondes, vérifier sa propriété et l'identité DB réelle.
6. Appliquer les migrations via le fichier d'environnement de test explicite,
   créer le bucket et utiliser le seed existant sur cette base neuve jetable.
7. Construire la production et démarrer `next start` sur loopback ; attendre
   `/login` avec des requêtes bornées à 1,5 s et une limite globale de 30 s.
8. Exécuter les vrais tests API existants puis les E2E Chromium.
9. En succès comme en échec, arrêter le seul serveur lancé par le runner et
   détruire exclusivement les services/volumes de son projet de test.

Une suite absente ou un test en échec fait échouer la commande. Aucun retry,
`test.skip`, `test.fail`, `continue-on-error` ou faux résultat vert n'est ajouté.
Les tests des autres auteurs restent dans leurs dossiers et sont tous collectés.

## Cibles et garde-fous

Chaque campagne crée un identifiant aléatoire de huit caractères hexadécimaux.

| Élément | Convention |
| --- | --- |
| Projet Compose | `arla-test-<id>` |
| Base | `expense_<id>_test` |
| Bucket | `receipts-<id>-test` |
| PostgreSQL / S3 / application | `127.0.0.1:55440` / `:45740` / `:3210` |
| Serveurs propres HA-01 | `127.0.0.1:3211` |
| Images | `postgres:16-alpine`, `localstack/localstack:3.8.1`, comme le dépôt |
| Configuration privée | `.test-runtime/active.json`, permissions privées à la création |

`tests/support/preflight.mjs` vérifie le marqueur `isolated`, les noms exacts
dérivés de l'identifiant, les ports distincts, les URL sans ambiguïté et les
comptes fictifs. Les noms de développement et leurs ports sont refusés. Les
variables de cible exportées dans le terminal, si différentes, font échouer
la commande ; elles ne sont pas silencieusement réutilisées.

Le précontrôle précède les commandes Docker/SQL/S3 et le nettoyage. Avant une
mutation de services, le runner exige un moteur Docker via socket local Unix
ou named pipe Windows, vérifie les labels de propriété du projet et ne stoppe
aucun port déjà occupé. La base réellement connectée et son rôle sont lus
avant les migrations. Ni `make clean` ni le Compose principal ne sont appelés.

Les ports loopback du Compose de développement restent à MATH-06 : seul le
nouveau `docker-compose.test.yml` est modifié ici. La campagne refuse un projet
déjà préparé ; utiliser `test:down` avant une nouvelle préparation vierge.
Les fichiers privés ne doivent pas être modifiés pour détourner leurs cibles.

## Utilisation séparée pour les auteurs

```bash
npm run test:prepare
npm run test:exec -- verify
npm run test:exec -- collect
npm run test:exec -- build
npm run test:serve
```

Dans un second terminal du même checkout, sans réexporter les secrets :

```bash
npm run test:exec -- api
npm run test:exec -- e2e
# Ou seulement les trois connexions :
npm run test:exec -- smoke
```

Arrêter `test:serve` par Ctrl+C, puis `npm run test:down`. Cette commande refuse
elle aussi une configuration non conforme avant tout nettoyage. L'option
`npm run test:down -- --if-present` ne fait rien si aucune configuration active
n'existe ; elle permet l'étape finale indépendante du workflow.

Le runner utilise les programmes du checkout et des arguments séparés, sans
évaluer une commande shell provenant d'un fichier ou d'une variable. Les
contrats HA-01/HA-07/LE-04/LE-12 sont alimentés depuis la même cible validée.
La connexion de préparation reste distincte conceptuellement de celle du
serveur : **dans cette référence initiale elles utilisent encore le même rôle
bootstrap privilégié**. Le contrat futur fourni par Hamza devra séparer les
deux connexions et fournir ses fixtures avant toute revendication RLS.

## Rapports et délais

Seul `.test-runtime/reports/<id>/` est conservé comme artefact : commandes,
codes/durées, état de source, rôle DB observé, logs expurgés et rapports JSON
Playwright expurgés. Les sorties brutes, `.env` de test et identifiants restent
dans `.test-runtime/private/` ou `active.json`, hors de cette sélection et
ignorés par Git. Les rapports ne contiennent pas de trace, vidéo ou état de session.

Le runner expurge mots de passe, secret Auth.js, URL DB, cookies de réponse et
URL S3 signées avant publication de ses sorties. Le seed initial imprime les
identifiants : sa sortie est capturée et expurgée, jamais relayée brute. Le
workflow n'archive pas `test-results/`, le dossier privé ou un dump de données.
La rétention des artefacts est de **trois jours**. Examiner les rapports avant
une copie manuelle dans la documentation.

Les commandes longues ont un délai maximal et l'arrêt vise le groupe de
processus créé par le runner. `ARLA_TEST_READY_TIMEOUT_SECONDS` peut réduire
la limite de santé entre 5 et 90 s, notamment pour le contrôle de panne ; le
workflow utilise 90 s. Les requêtes de disponibilité HTTP ont leur propre
timeout. Les erreurs de téléchargement, santé, build ou assertions restent visibles.

## Workflow et preuves

`.github/workflows/ci.yml` contient un seul job Ubuntu 24.04. Il vérifie les
versions exactes, utilise `npm ci`, installe Chromium, lance la chaîne puis
une étape finale de nettoyage `always()`. Les actions officielles sont
épinglées aux SHA vérifiés de leur branche v7 ; le token du job n'a que
`contents: read` et n'est pas conservé par checkout.

Les passages locaux, refus et limites sont consignés dans
[la preuve MATH-02](evidence/MATH-02-validation.md). Une réussite locale ne
signifie pas qu'un run GitHub a eu lieu. Les liens/code SHA des exécutions
distantes et du contrôle volontairement rouge seront ajoutés après exécution.
La revue Leandro et la confirmation du contrat DB par Hamza restent nécessaires.

Sources primaires : [checkout](https://github.com/actions/checkout),
[setup-node](https://github.com/actions/setup-node),
[upload-artifact](https://github.com/actions/upload-artifact),
[distribution Node 24.22.1](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt).

## Preuve distante initiale

[Échec volontaire](https://github.com/Mindsept/expense-io/actions/runs/39751865154), puis [campagne corrigée réussie](https://github.com/Mindsept/expense-io/actions/runs/39781367995). Voir [la validation](evidence/MATH-02-validation.md) pour les SHA et limites.
