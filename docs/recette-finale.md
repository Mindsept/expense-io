# ARLA-42 / MATH-04 — dossier de recette et transfert

**État au 25 octobre 2026 : préparation documentaire. La recette finale n'est pas exécutée et le SHA de remise n'est pas choisi.** Responsable de l'assemblage : Mathis ; relecteur et décision de remise : Hugo. Les preuves de chaque correction restent celles de son auteur.

Ce dossier répond à [ARLA-42](https://mindsept.atlassian.net/browse/ARLA-42). Les références « C1/C9, cours 1–2 s47/s49, cours 3 s38 » ci-dessous sont celles du ticket ; les supports de cours n'ont pas été relus pour cette préparation. Le dépôt examiné est exclusivement [Mindsept/expense-io](https://github.com/Mindsept/expense-io), base `888a74ddae9db28378596adc7709358798986e49`. Cette base de lecture n'est pas déclarée version de remise.

Le petit dossier [evidence/MATH-04](evidence/MATH-04/README.md) contient un relevé expurgé des validations de branches et une fiche de campagne encore vide. Aucun nouveau test, framework, correctif métier ou scénario réseau dupliqué n'est ajouté ici.

## 1. Fixer la version avant d'exécuter

Hugo choisit les tickets retenus et le SHA qui les intègre. Mathis renseigne [final-campaign.json](evidence/MATH-04/final-campaign.json) avant le lancement, puis relève les résultats réels, sans modifier les preuves historiques.

| Élément à consigner | État de la campagne finale |
| --- | --- |
| Dépôt et remote | Fork `https://github.com/Mindsept/expense-io.git` ; à revérifier sur le checkout d'exécution |
| SHA et branche de remise | **Non choisis** ; ne pas substituer un head de PR |
| État du dossier | À relever avec `git status --porcelain` ; toute modification locale doit être identifiée et jointe, ou la campagne repart d'un checkout propre |
| Début/fin et fuseau | À relever en ISO 8601 et `Europe/Paris`, avec le décalage effectif du jour |
| OS et architecture | À relever sur le poste/runner qui exécute la campagne |
| Node/npm | Versions attendues par cette base : **24.22.1 / 11.19.1** ; relever les versions réellement utilisées |
| Services | Version moteur Docker/Compose et images réellement résolues à relever ; fichiers actuels : PostgreSQL `16-alpine`, LocalStack `3.8.1` |
| Cible | Projet neuf `arla-ci-<id>`, loopback, DB `expense_io_test`, bucket `receipts-ci-test` ; les fixtures HA-04/HA-09 créent leurs propres DB jetables |
| Connexions | Séparer administrateur de préparation, serveur `expense_web` et worker `expense_notifications` ; publier seulement les identités/attributs observés, jamais les URL ni mots de passe |

Un changement ultérieur de code, migration, dépendance ou configuration invalide les preuves concernées. Identifier les scénarios impactés et les rejouer sur le nouveau SHA ; une nouvelle CI de branche ne met pas automatiquement à jour cette recette.

## 2. Preuves de branches disponibles, distinctes de la remise

Les preuves historiques restent dans [branch-checks.json](evidence/MATH-04/branch-checks.json). Le [relevé actualisé](evidence/MATH-04/current-branch-checks.json) distingue les résultats réellement lus après push et la campagne finale toujours non exécutée. Les totaux ci-dessous viennent des journaux des jobs terminés, et non d'un simple badge.

| Ticket / PR | SHA / exécution | Résultat observé au relevé | Portée et réception restante |
| --- | --- | --- | --- |
| ARLA-41 / [#27](https://github.com/Mindsept/expense-io/pull/27) | `82e88df8cb383fd771ce47ed660a9b6ff6d6edf2` ; [40238564482](https://github.com/Mindsept/expense-io/actions/runs/40238564482) | CI Linux réussie : 695 unitaires / 253 API / 29 E2E | Branche resynchronisée avec main ; droits, parcours et reproduction humaine du guide encore attendus. |
| ARLA-44 / [#33](https://github.com/Mindsept/expense-io/pull/33) | `d566e3277117b74e26887d8e8748e268f0c430c6` ; [40238545915](https://github.com/Mindsept/expense-io/actions/runs/40238545915) | CI Linux réussie : 701 unitaires / 242 API / 29 E2E | [Rejeu macOS du vrai cycle restauration](https://github.com/Mindsept/expense-io/blob/d566e3277117b74e26887d8e8748e268f0c430c6/docs/evidence/MATH-06/current-main-macos.json) réussi ; revue Hamza et parcours navigateur humain encore attendus. |
| ARLA-43 / [#17](https://github.com/Mindsept/expense-io/pull/17) | Mesures `ad51a01445765e47a6e914dbbe7ecddf9b108e79`, publication `ae7d7dc1e72ce04db4cef8fa1c1bdaee67b0df10` ; [40239646020](https://github.com/Mindsept/expense-io/actions/runs/40239646020) | CI Linux après push réussie : 708 unitaires / 242 API / 29 E2E ; même bilan local sur la source mesurée. | [Nouvelle référence paginée](https://github.com/Mindsept/expense-io/blob/ae7d7dc1e72ce04db4cef8fa1c1bdaee67b0df10/docs/performance/results/paged-20261025/README.md) : 540 mesures / 0 erreur, 18 plans, 48 OCR corrects ; pas de comparaison directe à la série legacy. Réception Leandro attendue. |
| ARLA-35 / #29, LE-11 / #34, LE-09 / #35 | Fusionnés dans la base de lecture `888a74d` | Pagination UI, listes bornées et index mesurés intégrés par leurs auteurs | Ce constat d'intégration ne choisit pas le SHA de remise. |

L'ancien échec EL-04 est levé par la correction d'Elyes, PR #28 fusionnée. Mathis n'a pas retouché ses tests. Les preuves Windows existantes gardent leur source et leur portée ; elles ne sont pas déduites des jobs Linux.

Ne pas présenter ces PR comme fusionnées sur la seule base d'un check vert. La CI commune valide les vérifications déclarées. Son serveur partagé utilise une baseline bootstrap privilégiée ; la preuve sous véritable rôle limité vient des fixtures spécifiques HA-04/HA-09 et doit être identifiée séparément dans les rapports.

Autres références déjà versionnées : [HA-04 runtime](security/HA-04/runtime-isolation.md), [HA-09 au 25 octobre](evidence/HA-09-Runtime-2026-10-25/README.md), [LE-02](evidence/LE-02-validation.md), [LE-03](evidence/LE-03-idempotency.md), [LE-08](evidence/LE-08-observability.md). Leurs dates, SHA, versions et limites restent ceux de leurs campagnes d'origine. Les documents historiques qui disent « Actions désactivées » ou « CI rouge » ne remplacent pas les checks datés ci-dessus, et ne sont pas réécrits pour faire disparaître un ancien échec.

## 3. Matrice de recette

Dans la colonne résultat, **NE = non exécuté sur le SHA de remise**. Un test présent ou collecté n'est pas un test réussi. La preuve « avant » peut être un constat référencé, mais son absence ne doit jamais être remplacée par une reproduction inventée.

| Exigence du cours / ticket | Problème | Ticket | Responsable | Scénario | Preuve avant | Preuve après à rattacher | Résultat final | Limite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1/C9, cours 3 s38 : preuve traçable | Suites oubliées, résultat sans version | ARLA-40 / ARLA-42 | Mathis | Installer verrouillé, vérifier lint/types/unitaires, collecte par propriétaire/niveau, build, API, E2E et nettoyage | Consigne ARLA-42 ; pas de nouvelle reproduction du défaut de collecte | `summary.json`, logs `verify/collect/build/api/e2e/cleanup` de la campagne finale ; [runner](../tests/support/ci.mjs) et [collecteur](../tests/support/check-collection.mjs) | NE | La collecte liste les fichiers et scénarios ; elle n'exécute pas leurs assertions |
| C1/C9 : parcours métier conservé | Une page seule ne prouve pas le cycle de vie | ARLA-42, HA-04, LE-01 | Mathis assemble ; Hamza/Leandro fournissent leurs preuves | Employé crée avec reçu ; manager décide ; employé retrouve statut/historique et reçu ; RH ouvre sa console | Référence des auteurs ; aucune capture « avant » produite ici | [Smokes trois rôles](../tests/e2e/mathis/MATH-01/roles.smoke.spec.ts), [soumission navigateur](../tests/e2e/leandro/LE-01/submission.spec.ts), [flux HTTP limité](../tests/api/hamza/HA-04/runtime-isolation.spec.ts), plus parcours manuel consigné sur le même SHA | NE | Les trois smokes ne font que connexion/écran ; le test HTTP ne remplace pas un parcours navigateur complet |
| C1/C9 : refus explicites | Accès sans acteur, interentreprises ou privilèges excessifs | ARLA-13 / HA-04 | Hamza ; Mathis rejoue | Vérifier login réel, ownership, flags, refus SQL/HTTP, contexte après commit/rollback, droits courants | [Inventaire historique](security/HA-04/evidence/readiness-baseline.json) | [runtime-isolation.spec.ts](../tests/api/hamza/HA-04/runtime-isolation.spec.ts), [enrôlement navigateur](../tests/e2e/hamza/HA-04/runtime-enrollment.spec.ts) et sous-matrice §5 | NE | Le garde de démarrage et une CI bootstrap verte ne suffisent pas à démontrer tous les refus |
| C1/C9 : tables ajoutées prises en compte | Une outbox plus récente échappe à une ancienne preuve RLS | ARLA-18 / HA-09 | Hamza | Transaction décision/historique/intention ; panne worker, reprise sans doublon ; droits web/worker ; accès étranger ; lecture persistante | [Historique de préparation](notification-readiness.md), daté et dépassé par le contrat courant | [Tests SQL/HTTP réels](../tests/api/hamza/HA-09/runtime-notifications.spec.ts), [navigateur réel](../tests/e2e/hamza/HA-09/runtime-notifications.spec.ts), [contrat](notifications-runtime.md) ; preuves finales par table | NE | Aucun envoi réel à une personne ; distinguer panne injectée, worker réel et réception humaine |
| C1/C9 : comportement d'erreur vérifiable | Erreur réseau, champs perdus ou reprise inaccessible | EL-01 / EL-04 | Elyes | Interrompre uniquement POST ou lecture ciblée ; afficher l'erreur, garder les champs, réactiver la reprise ; succès de la nouvelle tentative | [Scénarios EL-01](../tests/e2e/elyes/EL-01/network-errors.spec.ts) : assertions nommées, pas une exécution rouge « avant » fournie ici | Rejouer **les mêmes fichiers** [EL-01](../tests/e2e/elyes/EL-01/network-errors.spec.ts) et [EL-04](../tests/e2e/elyes/EL-04/submission-intent.spec.ts), §4 | NE | Navigateur réel, routes HTTP ciblées interceptées ; cela ne prouve pas l'idempotence PostgreSQL |
| C1/C9 : preuves à chaque niveau | Deux notes après une réponse perdue ou reçu orphelin | LE-02 / LE-03 | Leandro | Upload/INSERT et échec ; même clé rejouée ; même note et reçu ; état incertain traité explicitement | [LE-02](evidence/LE-02-validation.md), [LE-03](evidence/LE-03-idempotency.md) | Tests API Leandro déjà présents et scénario HA-04 de replay sous `expense_web` ; lier les lignes du rapport final | NE | Les mocks d'interface d'Elyes n'établissent pas à eux seuls l'atomicité DB/S3 |
| C1/C9 : démo relançable | Seed réécrivant un compte, reçu absent | ARLA-41 / MATH-03 | Mathis ; Hamza relit les droits | Relancer l'initialisation sans modifier identités/décisions ; réparer explicitement un reçu identifié ; trois rôles | [before.json à la tête inspectée](https://github.com/Mindsept/expense-io/blob/8e9d2e935f9a5d185de04c00e08e3de139f8d091/docs/evidence/MATH-03/before.json) | [Preuves de branche](https://github.com/Mindsept/expense-io/blob/8e9d2e935f9a5d185de04c00e08e3de139f8d091/docs/evidence/MATH-03/README.md), puis rejeu après intégration | NE | PR #27 distincte de la base ; répétition humaine et parcours Windows ne sont pas déduits d'une CI Linux |
| C1/C9 : UI sur version intégrée | Pagination instable ou incohérente après changement de page | ARLA-35 / EL-05 | Elyes | Navigation/pages, filtres et état de chargement selon les tests livrés | Besoin ARLA-35 ; aucune nouvelle exécution « avant » | [Tests EL-05 au SHA observé](https://github.com/Mindsept/expense-io/blob/a653a0026427a28660da48ba393f225e60a7f8c7/tests/e2e/elyes/EL-05/pagination.spec.ts), PR #29 puis rejeu sur la remise | NE | EL-05 intégré dans la base de lecture ; les futurs correctifs EL-07/08 restent à identifier séparément |
| C1/C9 : limites mesurées | Une durée isolée devient une promesse de performance | ARLA-43 / MATH-05 ; LE-09 | Mathis ; Leandro relit | Référence 1 000/10 000 notes, trois passages ; conditions, erreurs et plans conservés | [Référence post-RLS au SHA inspecté](https://github.com/Mindsept/expense-io/blob/114e16e1bdfc2f422e6de19832da770188e22bb1/docs/performance/results/post-rls-20261023/reference.md) : mesures sur `a48fb9c` | [Référence paginée du 25 octobre](https://github.com/Mindsept/expense-io/blob/ae7d7dc1e72ce04db4cef8fa1c1bdaee67b0df10/docs/performance/results/paged-20261025/README.md), puis éventuel rejeu sur la remise sans écraser les campagnes | NE | Série v4 limitée à la première page de 100 avec agrégats ; ni capacité production ni ratio de gain face aux anciennes listes complètes |
| C1/C9 : variante conditionnelle explicite | Annoncer une reprise OCR durable non livrée | ARLA-24 / LE-06 | Leandro ; Hugo confirme le périmètre | Conserver OCR synchrone borné et saisie manuelle ; recontrôler le schéma final | [ADR LE-06](adr/LE-06-bounded-ocr.md) | Contrat accepté et tests LE-05/06 existants ; absence de jobs durables à reconfirmer sur la remise | NE | Au SHA de lecture, aucun job OCR durable livré ; si une table jobs est ajoutée, étendre §5 avant conclusion |
| C1/C9 : défauts actionnables | Masquer un échec par skip ou déclaration « terminé » | ARLA-42 / ARLA-44 | Mathis assemble ; auteur corrige ; Hugo arbitre | Conserver les échecs, reproductions, responsable et impact démo ; rattacher exploitation/reprise si retenue | [Registre historique](defauts-ouverts.md), daté du 22 octobre | Registre §7 actualisé sur le SHA final et preuves de l'auteur du correctif | NE | Ce registre historique ne donne pas le statut actuel de Jira ; aucune clôture automatique |

## 4. Panne réseau : réutiliser les tests d'Elyes

Les fichiers EL-01 et EL-04 sont présents dans la base de lecture. Le collecteur commun et `test:ci` les prennent en charge ; **ne pas créer un second fichier de panne MATH-04**.

- EL-01, `an uncertain submission preserves every field and does not retry automatically` : le POST ciblé est interrompu ; alerte « Résultat non confirmé », montant/date/description/reçu conservés, bouton de reprise actif, une seule tentative.
- EL-04, `a retry after a lost response reuses the same key, fields and receipt` : premier POST interrompu, second simulé en succès ; même clé, mêmes données et reçu, confirmation visible puis champs vidés.
- EL-01, `a confirmed submission keeps its success message and stale history can be refreshed` : confirmation préservée après échec de la lecture ; bouton Réessayer puis historique actualisé et alerte retirée.

Ces scénarios démontrent le comportement de l'interface face à des réponses/interceptions contrôlées. La preuve réelle DB/S3 et de non-duplication reste celle de Leandro et de HA-04. Ne pas couper le réseau de toute la machine. Si ces tests ne sont pas intégrés ou ne sont pas exécutés sur le SHA de remise, conserver « ouvert/non livré » ou « non exécuté », selon le cas.

## 5. Sous-matrice RLS et identités réelles

La base lue contient **13 tables protégées** dans [runtime-database.ts](../src/lib/runtime-database.ts). Sur la remise, Hamza doit rattacher les assertions et résultats à l'inventaire réel, y compris toute table ajoutée depuis. Les attentes ci-dessous reprennent les contrats existants ; Mathis ne définit pas de nouvelle policy.

| Ensemble | Tables à inventorier | Preuve existante à rejouer | Contrôle final encore attendu |
| --- | --- | --- | --- |
| Identités | `companies`, `users`, `enrollment_invitations` | HA-04 SQL/HTTP réel et enrôlement navigateur | Login courant/session `expense_web`, flags non privilégiés, aucune propriété ; sans contexte, entreprise étrangère, colonnes privées et mutations interdites |
| Métier | `expense_notes`, `expense_decision_history`, `management_changes` | HA-04 ; HA-02/03/06 pour les droits métier | Refus sans contexte/interentreprises, auteur/décideur autorisés, droits courants, données historiques non réécrites |
| Idempotence | `expense_submission_operations`, `expense_submission_attempts` | HA-04 et LE-03 | Accès propriétaire/entreprise, refus de valeurs forgées et de nettoyage par le web |
| Notifications de décision | `decision_notification_outbox`, `decision_inbox` | HA-09 runtime SQL/HTTP, panne/reprise et navigateur | Refus directs sans contexte et interentreprises par table ; append/lecture/`read_at` selon contrat ; pas de mutation de métadonnées ou de traitement worker par le web |
| Attribution | `expense_notification_routes`, `assignment_notification_outbox`, `assignment_inbox` | HA-09 runtime : réaffectation, tous RH éligibles, premier décideur, auteur exclu, aucun RH disponible | Même matrice de refus par table et identité ; retirer les droits au changement d'affectation ; worker séparé |
| Jobs OCR | Aucune table durable dans la base lue ; pool borné en processus selon LE-06 | ADR et tests de Leandro | Refaire l'inventaire final ; toute nouvelle table exige droits, refus sans contexte/interentreprises et preuve du véritable rôle |

À relever pour `expense_web` : `current_user = session_user = expense_web`, `rolsuper=false`, `rolbypassrls=false`, `rolcreatedb=false`, `rolcreaterole=false`, absence de propriété des tables et de memberships dangereux. Le garde HA-04 contrôle aussi replication/inherit, grants et fonctions privilégiées ; joindre son résultat sans le confondre avec la matrice de refus.

Le worker HA-09 est `expense_notifications`, distinct du web et de l'administrateur. Son contrat autorise un traitement interentreprises borné des files ; il ne faut donc pas inventer un refus global qui interdirait son travail. Rejouer les refus définis par Hamza : données privées/métier interdites, absence de pouvoir de décision, de changement d'utilisateur, de fallback administrateur et d'escalade de rôle.

**Limite identifiée à la lecture :** HA-04 énumère explicitement les huit tables initiales dans son contrôle sans contexte. HA-09 apporte des tests réels de droits, d'inbox étrangère et de mutations interdites, mais ces assertions ne constituent pas à elles seules une fiche complète « chaque table × chaque identité × sans contexte/interentreprises ». Demander à Hamza de pointer les assertions correspondantes ou de fournir les preuves manquantes sur le SHA final. Tant qu'une case manque, ne pas conclure « isolation exhaustive validée ».

## 6. Commandes existantes et journal d'exécution

Le protocole opératoire est [docs/ci.md](ci.md). Depuis un checkout propre du SHA retenu, relever d'abord les versions et l'identité de source, sans afficher l'environnement privé :

```sh
git remote get-url origin
git rev-parse HEAD
git status --porcelain
node --version
npm --version
docker version
docker compose version
```

Puis, avec les runtimes épinglés et Docker local disponibles :

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:ci
```

Sous Windows, utiliser `npx playwright install chromium` conformément à `docs/ci.md`. La disponibilité du moteur et les corrections de portabilité doivent être vérifiées sur le checkout réellement testé. Une installation Docker réussie ou une suite unitaire Windows ne remplace pas le cycle complet services/API/navigateur/nettoyage.

`test:ci` construit la configuration jetable, contrôle les ports, orchestre les commandes ci-dessous et nettoie uniquement son projet. Les suites API/E2E ne se lancent pas hors de cette configuration préparée ; ne pas réutiliser un `.env` de développement. Aucune commande de reset/migration sur la base personnelle n'est prescrite ici.

| Étape existante | Commande exécutée par la chaîne | Code / durée / rapport de la campagne finale |
| --- | --- | --- |
| Vérification | `npm run verify` → lint, typecheck, unitaires | Non exécuté ; code et durée inconnus |
| Collecte | `npm run test:collect` | Non exécuté ; conserver fichiers/niveaux/propriétaires et les exemples trois rôles |
| Services | Compose de test, projet aléatoire ; texte exact dans le log | Non exécuté |
| Préparation | `npm run test:prepare` | Non exécuté |
| Production | `npm run build`, puis serveur possédé par le runner | Non exécuté |
| Intégration | `npm run test:api` | Non exécuté ; distinguer fixtures bootstrap et véritables logins limités |
| Navigateur | `npm run test:e2e` | Non exécuté ; relever chaque succès/échec, aucun retry silencieux |
| Nettoyage | Compose `down --volumes --remove-orphans` du seul projet généré, après garde | Non exécuté ; un échec rend la campagne en échec |

Pour chaque étape, copier **le texte exact, le code de sortie, la durée observée, le SHA et le lien du rapport**. `.ci-output/summary.json` relève `exitCode` et `durationMs` ; les logs du runner sont expurgés. Conserver les originaux privés et publier uniquement une sélection relue. Les artefacts GitHub ont une rétention courte documentée par MATH-02 : archiver les preuves utiles après expurgation, sans inventer celles devenues indisponibles.

## 7. Bilan, écarts et décisions restantes

**Campagne finale actuelle : 0 E2E exécuté, 0 réussi, 0 échoué ; nombre collecté à établir. Aucun taux calculable.** Les contrôles de la matrice sont tous non exécutés sur la remise. Aucun résultat d'E2E du professeur ni référence comparable n'a été fourni dans ce dossier ; Hugo doit les identifier et les conserver séparément des suites de l'équipe. Ne pas annoncer « 100 % des E2E préservés ».

| Écart / dépendance | Action et propriétaire | Impact sur la conclusion |
| --- | --- | --- |
| SHA de remise et périmètre non fixés | Hugo choisit les tickets acceptés ; Mathis relève le checkout exact | La campagne finale ne peut pas être déclarée réussie |
| PR #17/#27/#33 encore en revue ; #29/#34/#35 intégrées | Choisir les livraisons retenues et vérifier les CI au SHA final ; réception des auteurs/relecteurs | Les preuves de branche restent utilisables seulement dans leur portée historique |
| Matrice RLS/outbox par table incomplète dans ce dossier | Hamza fournit les assertions/résultats manquants ; Mathis rejoue | Pas d'affirmation d'isolation exhaustive |
| Recette navigateur et reprise sur poste de remise non exécutées | Mathis rejoue les suites existantes ; Elyes examine ses échecs ; Hugo assiste au parcours | Démo finale non acceptée |
| Référence E2E professeur absente | Hugo fournit les scénarios, version et résultat | Pas de comparaison ni pourcentage global |
| Exploitation/restauration ARLA-44 en revue ; accessibilité ARLA-37 et recette UI ARLA-38 | Rattacher PR #33 et les preuves des autres auteurs si retenues ; ne pas inventer leur réception | Limites à annoncer ou nouveau rejeu ciblé |

Pour tout échec futur, ajouter : SHA/date, ticket/propriétaire, étapes de reproduction, attendu, observé, rapport expurgé, impact démo et décision d'Hugo (corriger ou annoncer la limite). Ne pas modifier le test d'un autre auteur, ajouter `skip`/`fail`/`continue-on-error` ou affaiblir une assertion pour rendre la CI verte. Une régression obligatoire garde la chaîne rouge.

## 8. Transfert à Hugo

Trois captures utiles maximum, **aucune produite pour cette préparation** : (1) état confirmé de la note après décision ; (2) erreur ciblée et reprise réussie ; (3) console RH/notification autorisée. Associer chaque capture au scénario, SHA et horodatage ; masquer données personnelles, identifiants privés, URL signées et cookies. Une capture atteste un écran à un instant, pas l'absence de fuite ou de course concurrente.

**Script oral, environ 60 secondes :**

> Notre recette relie chaque exigence à un scénario, à son auteur et à une preuve sur une version précise. Aujourd'hui, le dossier rassemble les références des branches ; la version de remise reste à choisir et sa recette n'est pas annoncée réussie. Pour la valider, nous relançons la chaîne isolée et conservons commandes, codes, durées et résultats. Les tests d'Elyes montrent l'erreur réseau ciblée puis la reprise ; les tests SQL et HTTP de Hamza et Leandro vérifient les données et les droits réels. Le serveur limité et les tables de notifications demandent leurs propres preuves. Un écran ou une CI verte ne démontre pas tout. Les cas non exécutés et les défauts restent visibles. Un autre membre repart du même SHA et suit le protocole, puis Hugo décide des écarts acceptables avant la soutenance.

Checklist de réception humaine, à compléter après exécution :

- [ ] Chaque réussite pointe une assertion, une exécution et le SHA remis.
- [ ] Employé, manager et RH ont été couverts ; le parcours complet est consigné.
- [ ] Tous les propriétaires et niveaux attendus sont réellement collectés.
- [ ] Véritable rôle web, worker et matrice RLS de toutes les tables livrées revérifiés.
- [ ] Panne ciblée et reprise rejouées, ou leur absence explicitement annoncée.
- [ ] Numérateurs/dénominateurs tirés des rapports ; suites professeur séparées.
- [ ] Aucun défaut ouvert n'a disparu du bilan et aucune réception humaine n'a été inventée.
- [ ] Un autre membre a relancé le protocole ; Hugo peut expliquer ses limites.
- [ ] Répétition collective réalisée et décisions de remise consignées.
