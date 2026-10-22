# Tests communs — MATH-01 / ARLA-39

Le socle conserve Vitest 5.0.5 et Playwright 1.64.1 déjà verrouillés. Il ajoute
les trois parcours de connexion et complète la configuration commune sans
modifier l'application, les migrations ou les versions des dépendances.

## Commandes et responsabilités

```bash
npm ci
npx playwright install chromium
npm run verify
npm run test:collect
npm run test:api
npm run test:e2e
npm run test:smoke
```

`verify` exécute lint, typage et unitaires sans services. `test:api` sélectionne
le projet Playwright `api`, sans navigateur. `test:e2e` sélectionne `e2e`,
avec Chromium. `test:smoke` ne lance que les trois connexions de référence.
L'URL et les comptes explicites sont nécessaires à la collecte API/E2E aussi.

| Niveau | Convention | Propriétaires actuellement présents |
| --- | --- | --- |
| Vitest | `tests/unit/{owner}/{ID}/*.test.ts` | elyes, hamza, leandro, mathis |
| Playwright HTTP/intégration | `tests/api/{owner}/{ID}/*.spec.ts` | hamza, leandro, mathis |
| Playwright navigateur | `tests/e2e/{owner}/{ID}/*.spec.ts` | mathis |

Chaque auteur conserve ses propres tests. `tests/support/` appartient à Mathis.
Les configurations découvrent toutes les racines, pas une liste de tickets.
Aucun faux test n'est créé pour représenter un propriétaire sans E2E livré.

## Configuration explicite

Le support Mathis ne charge aucun fichier `.env` et ne fournit aucun serveur
par défaut. Injecter les variables via un fichier privé situé hors du dépôt
ou l'environnement du terminal. Ne pas utiliser `.env` de développement.

| Variable | Valeur attendue |
| --- | --- |
| `ARLA_TEST_ENV` | `isolated` |
| `ARLA_TEST_BASE_URL` | Origine HTTP de test locale, port explicite différent de 3000, par exemple `http://127.0.0.1:3199` |
| `ARLA_TEST_EMPLOYEE_EMAIL` / `ARLA_TEST_EMPLOYEE_PASSWORD` | Compte fictif employé de la base jetable |
| `ARLA_TEST_MANAGER_EMAIL` / `ARLA_TEST_MANAGER_PASSWORD` | Compte fictif manager |
| `ARLA_TEST_HR_EMAIL` / `ARLA_TEST_HR_PASSWORD` | Compte fictif `hr_admin` |

Les URL distantes, URL avec identifiants, chemins, requêtes et fragments sont
refusées. Ce garde-fou désigne l'application de test ; il ne prouve pas à lui
seul sa connexion à une base jetable. La préparation manuelle doit la vérifier.
MATH-02 fournira le contrôle commun de DB/bucket/Compose avant toute écriture.

Les suites existantes gardent leurs contrats :

- HA-01 : `HA01_TEST_DATABASE_URL`, `HA01_SERVER_MODE=production`, port réservé
  via `HA01_TEST_PORT`. Elle démarre ses propres serveurs et teste les redémarrages.
- HA-07 : `HA07_TEST_BASE_URL`, `HA07_TEST_DATABASE_URL`, `HA07_TEST_PASSWORD`.
- LE-04 : `LE04_TEST_BASE_URL`, `LE04_TEST_DATABASE_URL`.
- LE-12 : `LE12_TEST_BASE_URL`, `LE12_TEST_DATABASE_URL` et variables S3.

Dans une campagne commune, les quatre URL DB désignent la même base jetable
et les trois URL d'application désignent le serveur de production de test.
Ne pas les faire pointer vers les données personnelles de l'équipe.

## Premier passage manuel avant MATH-02

Prérequis constatés : Node 24.21.0, npm 11.19.0, Docker opérationnel, Chromium
installé par la version Playwright du lockfile. La paire proposée dans HA-08
pour la future CI reste à revalider et épingler dans MATH-02/07.

1. Créer un fichier Compose privé temporaire avec les images du dépôt,
   `postgres:16-alpine` et `localstack/localstack:3.8.1`. Utiliser un nom de
   projet inédit `arla-math01-<identifiant>`, sans montage de données de
   développement, avec des healthchecks et une attente bornée.
2. Publier uniquement `127.0.0.1:55439:5432` et `127.0.0.1:45739:4566`, après
   vérification de leur disponibilité. Créer `expense_io_test` et le bucket
   `receipts-math01-test`. Les noms de services restent `postgres`/`localstack`.
3. Créer un fichier privé `test.env` avec `DATABASE_URL`, les variables S3,
   un `AUTH_SECRET` aléatoire privé, `AUTH_TRUST_HOST=true` et les variables
   du tableau. Fournir des mots de passe fictifs aléatoires pour les trois rôles.
   Faire correspondre `SEED_{EMPLOYEE,MANAGER,HR}_{EMAIL,PASSWORD}` aux
   comptes `ARLA_TEST_*`, afin que les tests utilisent les comptes préparés.
4. Vérifier le projet inédit, les adresses loopback, le suffixe `_test`, le
   bucket `-test` et l'absence de volumes partagés avant toute préparation.
   Réserver un autre port, par exemple 3198, aux serveurs privés HA-01.
5. Depuis un terminal Bash configuré pour ce test, exécuter la séquence suivante.
   Les chemins et le projet sont ceux explicitement choisis aux étapes précédentes.

```bash
# Adapter ces trois chemins/noms au dossier privé de cette campagne.
export MATH01_COMPOSE=/chemin/prive/compose.yml
export MATH01_ENV=/chemin/prive/test.env
export MATH01_PROJECT=arla-math01-identifiant-unique

set -a
source "$MATH01_ENV"
set +a

docker compose -p "$MATH01_PROJECT" -f "$MATH01_COMPOSE" up -d --wait --wait-timeout 180
npm run migrate:up -- --envPath "$MATH01_ENV"
npm run ensure-bucket
# Le seed actuel imprime les identifiants : sortie privée, jamais publiée brute.
npm run seed > /chemin/prive/seed.log 2>&1
npm run build
npm run start -- --hostname 127.0.0.1 --port 3199
```

Dans un second terminal avec le même environnement privé chargé :

```bash
npm run verify
npm run test:collect
npm run test:api
npm run test:e2e
```

Le premier passage de ce ticket a suivi cette procédure manuelle avec une
configuration temporaire propre, pas un orchestrateur partagé déjà livré.
L'automatisation depuis un checkout vierge, les précontrôles communs et
GitHub Actions relèvent de MATH-02. Les exemples Bash ne sont pas des commandes
PowerShell natives. Ne pas lancer `make dev` ou `make clean` pour cette campagne.

Après arrêt du serveur lancé par cette campagne seulement, contrôler à nouveau
le projet et la cible avant nettoyage :

```bash
docker compose -p "$MATH01_PROJECT" -f "$MATH01_COMPOSE" down --volumes --remove-orphans
```

## Collecte vérifiable

```bash
npx vitest list --json
npx playwright test --project=api --list --reporter=json
npx playwright test --project=e2e --list --reporter=json
npm run test:collect
```

`test:collect` utilise ces CLI installées, compare les fichiers réellement
collectés à tous les fichiers présents dans les trois racines et à huit
exemples connus. Il vérifie aussi les noms des trois smokes. Une exclusion
accidentelle d'un propriétaire ou la disparition d'un exemple fait échouer
le contrôle. Le résultat distingue les fichiers et propriétaires par niveau.
La collecte ne lance ni hooks ni tests ; ses décomptes ne sont pas un taux de réussite.

## Assertions et contrôles négatifs

- Le vrai handler GET personnel est appelé avec `null` puis sans `user`.
  Auth et DB sont simulées : 401 est exigé avant tout accès au pool ou au scope DB.
- Le test HTTP demande la vraie route sans session et sans suivre les redirections.
  Il exige 401 et le corps JSON attendu. Il ne mesure pas les requêtes DB du serveur.
- Chaque smoke reçoit un contexte navigateur neuf sans cookie, utilise les labels
  du vrai formulaire, vérifie la session email/rôle puis le titre propre à son écran.
  Il refuse les pages de connexion et « Accès réservé ». Aucun jeton n'est forgé.
- Pour constater un échec réel, remplacer temporairement **dans l'environnement du
  processus uniquement** le mot de passe employé, puis lancer
  `npm run test:smoke -- --grep 'employee signs in'`. Le test doit s'exécuter et
  échouer sur la connexion. Un message « No tests found » ne valide pas ce contrôle.
  Rétablir la valeur correcte et rejouer les trois smokes.
- Retirer `ARLA_TEST_BASE_URL` doit faire échouer l'import avec un diagnostic utile.
  Les unitaires du support couvrent également les cibles ambiguës/distantes.

Pas de retry automatique, `skip`, `fail` ou faux vert. Traces, vidéo et captures
automatiques sont désactivées ; les états de session et rapports générés sont ignorés.
Expurger les logs et contrôler leur contenu avant de les versionner.

## Limites et revue

La référence utilise le rôle bootstrap privilégié existant, et ne démontre pas
la RLS. HA-04 fournit le contrat du rôle limité. Les fixtures de deux entreprises
restent à Hamza. Leandro doit relire la configuration avant fusion ; Mathis doit
comprendre les assertions et reproduire un succès ainsi qu'un échec volontaire.
Les résultats datés sont dans [la preuve MATH-01](evidence/MATH-01-validation.md),
les défauts encore ouverts dans [le registre](defauts-ouverts.md).

Références primaires consultées : [projets Playwright](https://playwright.dev/docs/test-projects),
[CLI Playwright](https://playwright.dev/docs/test-cli), [CLI Vitest](https://vitest.dev/guide/cli.html).

