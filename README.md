# Expense.io

Application de gestion de notes de frais pour plusieurs entreprises. Les employés
déposent un justificatif et suivent leurs notes ; les managers et les RH prennent
les décisions dans leur périmètre courant. Le projet comprend l'historique des
décisions, des notifications dans l'application, un préremplissage OCR facultatif
et des outils de test et de démonstration reproductibles.

## Prérequis

- **Node.js 24.22.1** et **npm 11.19.1**, conformément à `.nvmrc` et `package.json`.
- Docker local et Docker Compose accessibles.
- Git et les dépendances installées avec `npm ci`.

La stack locale utilise PostgreSQL 16 et LocalStack pour le stockage compatible
S3. L'application repose sur Next.js, React et TypeScript ; l'OCR utilise
Tesseract dans un processus isolé.

## Démarrer une démonstration locale

Depuis la racine du dépôt, dans PowerShell ou Bash :

```sh
node --version
npm --version
npm ci
npm run demo:prepare
npm run demo:start
```

Ouvrir **http://127.0.0.1:3215**. `demo:prepare` crée une stack fictive dédiée,
applique les migrations, provisionne le rôle applicatif limité, prépare trois
comptes et deux notes avec leurs justificatifs, puis construit l'application.
Le serveur utilise le rôle PostgreSQL `expense_web`, distinct de l'administrateur
de préparation. Les ports dédiés doivent être libres ; une préparation déjà
active est refusée.

| Rôle de démonstration | Adresse fictive |
| --- | --- |
| Employé | `employee@expense.test` |
| Manager | `manager@expense.test` |
| RH | `hr@expense.test` |

Les mots de passe sont **générés pour chaque stack**. Pour une connexion manuelle,
lire localement `SEED_EMPLOYEE_PASSWORD`, `SEED_MANAGER_PASSWORD` et
`SEED_HR_PASSWORD` dans `.ci-output/demo/seed.json`. Ce fichier privé contient
aussi des informations de maintenance : ne pas le commiter, le partager ou le
projeter pendant une démonstration.

`Ctrl+C` arrête le serveur lancé par `demo:start` et conserve les données. Pour
retirer uniquement cette stack de démonstration, après l'arrêt du serveur :

```sh
npm run demo:down -- --confirm-disposable
```

Le [guide de démonstration](docs/demo.md) détaille les ports, la relance du seed,
la réparation ciblée, la réinitialisation et les contrôles de cible. Le seed crée
le manquant sans écraser les comptes existants ; la réparation et le reset sont
des opérations explicites distinctes.

## Comptes, entreprises et invitations

La création d'une entreprise et de son premier RH passe par un **bootstrap
administrateur explicite**. Ensuite, un RH actif ouvre **RH → Gérer les
invitations** pour inviter une adresse précise ou révoquer une invitation non
consommée.

- L'inscription nécessite le lien privé délivré au destinataire exact ; le
  domaine d'email n'accorde aucune affiliation automatique.
- Une invitation ordinaire crée un employé dans l'entreprise de l'invitation.
- Le lien est à usage unique, expire après **48 heures** et doit être consommé
  avant sa révocation ou son expiration.
- Un compte existant n'est pas transféré implicitement vers une autre entreprise.
- Les rôles et rattachements se gèrent depuis l'espace RH selon les règles
  d'organisation ; ils ne sont pas choisis librement à l'inscription.

Pour activer la livraison des invitations dans un environnement réel, configurer
privément `AUTH_URL`, `ENROLLMENT_DELIVERY_URL`, `ENROLLMENT_DELIVERY_BEARER` et
`ENROLLMENT_INVITATION_TTL_SECONDS=172800`. Le fournisseur réel n'est pas configuré
par le dépôt ; les tests utilisent un bridge local fictif. Voir le
[contrat d'enrôlement](docs/invitation-enrollment.md) pour le bootstrap, la
configuration et le parcours complet.

## Règles du parcours de notes de frais

- Une note ordinaire est décidée par son manager direct actif et éligible.
  Sans manager éligible, les RH de la même entreprise assurent le recours.
- Une note RH nécessite un autre RH éligible. **L'auto-approbation est toujours
  interdite** ; sans valideur, la note reste en attente avec une raison visible.
- Plusieurs RH éligibles peuvent être notifiés. La première décision validée en
  base gagne ; une décision concurrente ne remplace pas l'historique.
- Rôle, entreprise et activité sont rechargés à chaque opération. Une
  réaffectation modifie les droits courants sans réécrire les décisions passées.
- Les justificatifs acceptés sont PNG, JPEG, WebP et PDF, non vides, jusqu'à
  **10 MiB (10 485 760 octets)**. Le préremplissage OCR analyse les images ; les
  PDF se renseignent manuellement. Une suggestion reste à vérifier par l'utilisateur.
- Les dates de dépense sont des dates civiles ; les dates futures sont acceptées.
- Les listes sont paginées ; leur total porte sur tout l'ensemble autorisé et
  filtré, indépendamment de la page.

Les [règles produit](docs/po/regles-et-contrats.md) et la
[hiérarchie de validation](docs/management-hierarchy.md) précisent les cas limites.
La récupération de compte et la modification, l'annulation ou la réouverture des
notes sont hors périmètre de cette version.

## Architecture et fiabilité

Le monolithe modulaire extrait les cas d'usage `SubmitExpense` et `DecideExpense`
derrière des ports et adaptateurs utilisés par l'application.

- **Accès :** acteur courant, autorisations applicatives et politiques RLS avec
  rôles PostgreSQL limités ; administrateur, web et worker ont des identités distinctes.
- **Soumission :** insertion d'une note complète, compensation du stockage et
  registre durable avec `Idempotency-Key` pour reprendre une intention sans la
  dupliquer. PostgreSQL et S3 ne forment pas une transaction distribuée.
- **Décision :** statut, historique et intention de notification partagent une
  transaction. Un worker séparé livre dans l'inbox avec reprise et déduplication.
- **OCR :** aide facultative, requête HTTP synchrone avec calcul isolé, admission
  et délais bornés ; la saisie manuelle reste disponible.

Voir [la soumission](docs/expense-submission.md),
[l'idempotence](docs/expense-idempotency.md),
[la décision atomique](docs/adr/HA-03-atomic-decisions.md),
[les notifications et leur worker](docs/notifications-runtime.md) et
[la décision OCR](docs/adr/LE-06-bounded-ocr.md).

## Tests et vérifications

Pour préparer Chromium et exécuter la campagne intégrée :

```sh
npm ci
npx playwright install chromium
npm run test:ci
```

La campagne vérifie lint, types, tests unitaires et collecte, démarre des services
jetables, prépare les migrations, construit la production, exécute les tests API
et navigateur, puis nettoie son propre projet. Les suites API/E2E exécutées
isolément nécessitent la configuration décrite dans le [guide CI](docs/ci.md).

```sh
npm run lint
npm run typecheck
npm run test:unit
npm run test:collect
```

La [recette finale](docs/recette-finale.md) rattache chaque résultat à son commit,
à son environnement et à ses limites. Elle distingue tests sur doubles,
intégration SQL/S3, rôles réellement limités et parcours navigateur.

## Configuration, exploitation et documentation

Le parcours de démonstration ci-dessus est la procédure locale reproductible.
Pour configurer un autre environnement, suivre les guides correspondants avec des
identifiants privés et les rôles adaptés ; ne pas fournir un compte administrateur
au processus web ou au worker.

| Sujet | Documentation |
| --- | --- |
| Configuration et secret d'authentification | [Authentification](docs/authentication-configuration.md), [.env.example](.env.example) |
| Rôle web et garde de démarrage | [Isolation du runtime](docs/security/HA-04/runtime-isolation.md) |
| Diagnostic, sauvegarde PostgreSQL + reçus et restauration fictive | [Exploitation locale](docs/exploitation-locale.md) |
| Logs, corrélation et mesures | [Observabilité](docs/observability.md) |
| Contrats HTTP et erreurs | [OpenAPI](docs/openapi/README.md), [Problem Details](docs/api-errors.md) |
| Décisions, preuves et périmètre accepté | [Dossier produit](docs/po/README.md), [recette](docs/recette-finale.md) |

Les outils de diagnostic, de sauvegarde et de restauration ont des configurations
et des gardes propres. Leurs exemples complets figurent dans les runbooks ; une
sauvegarde locale fictive n'est pas une qualification de production.
