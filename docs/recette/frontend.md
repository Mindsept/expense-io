# Recette frontend — EL-08 / ARLA-38

Cette recette réunit les preuves EL-01 à EL-07 sans modifier leurs contrats
serveur. Le dépôt est **Mindsept/expense-io**. Les scénarios de panne utilisent
des réponses HTTP contrôlées dans Chromium ; la connexion utilise les comptes
fictifs du serveur local. Une simulation d'API ne prouve ni PostgreSQL, ni S3,
ni l'idempotence serveur, ni les refus d'accès entre entreprises.

## Relancer depuis une copie installée

Utiliser les versions Node/npm déclarées dans `package.json` et le lockfile,
Docker opérationnel et Chromium installé par Playwright. Aucun compte réel,
fichier `.env` de développement ou reçu personnel n'est nécessaire.

```sh
npm ci
npx playwright install chromium
npm run test:ci
```

La dernière commande appartient au socle MATH-02 : configuration éphémère,
projet Compose distinct, base `_test`, bucket `-test`, refus des ports occupés,
préparation des trois comptes, build, suites API/navigateur puis nettoyage des
seules ressources de cette campagne. Voir [CI](../ci.md). Elle conserve les
résultats expurgés dans `.ci-output/`. Les mots de passe sont générés à chaque
campagne et ne sont pas publiés dans cette recette.

Pour une démo déjà démarrée avec la configuration privée MATH-03, conserver
ses variables explicites `ARLA_TEST_ENV`, `ARLA_TEST_BASE_URL` et les trois
paires `ARLA_TEST_<ROLE>_EMAIL/PASSWORD`. Ne pas deviner un mot de passe ou
remplacer cette cible par le port de développement 3000.

```sh
npm run test:collect
npm run test:unit -- tests/unit/elyes
npm run test:e2e -- tests/e2e/elyes
npm run lint
npm run typecheck
```

`test:collect` vérifie les fichiers réellement découverts et les propriétaires.
Une collecte réussie ne signifie pas que les tests ont été exécutés. Il n'y a
pas de suite API Elyes artificielle : les assertions serveur restent chez
Hamza et Leandro. Aucun second runner ni nouvelle dépendance n'est ajouté.

## Matrice de reproduction

Les chemins ci-dessous sont relatifs à `tests/`. Les titres de tests décrivent
les assertions attendues ; le résultat observé doit venir d'une campagne datée
et identifiée, pas de la simple présence d'un fichier.

| Ticket | Action et résultat attendu | Preuve exécutable | Portée |
| --- | --- | --- | --- |
| EL-01 / ARLA-31 | Soumission interrompue : champs et reçu conservés, aucune nouvelle tentative automatique ; après 201 et GET échoué, succès conservé, historique récupérable | `e2e/elyes/EL-01/network-errors.spec.ts` | UI contrôlée ; connexion réelle |
| EL-01 | Décision manager 409 : ligne conservée jusqu'à l'actualisation explicite ; erreur RH d'annuaire indépendante des notes | Même fichier, scénarios manager et RH | UI contrôlée |
| EL-02 / ARLA-32 | Dates civiles valides/invalides et même date à Paris/New York | `unit/elyes/EL-02/civil-date.test.ts`, `e2e/elyes/EL-02/civil-dates.spec.ts` | Calcul pur + deux fuseaux Chromium |
| EL-03 / ARLA-33 | OCR B finit avant A ; A n'écrase ni B ni une saisie manuelle | `e2e/elyes/EL-03/ocr-suggestions.spec.ts` | Promesses contrôlées, aucun appel réel à l'OCR |
| EL-04 / ARLA-34 | Reprise explicite avec même clé/contenu/reçu ; formulaire changé ou page rechargée ne crée pas silencieusement une nouvelle intention | `e2e/elyes/EL-04/submission-intent.spec.ts` | UI ; le serveur est testé par LE-03 |
| EL-05 / ARLA-35 | Pagination et totaux serveur ; manager RH accessible au-delà de la page courante | `e2e/elyes/EL-05/pagination.spec.ts`, `unit/elyes/EL-05/pagination.test.ts` | UI + parseur de contrat |
| EL-06 / ARLA-36 | Auteur et circuit explicites ; détail indisponible ne bloque pas la liste | `e2e/elyes/EL-06/workflow-visibility.spec.ts` | UI ; droits serveur hors mock |
| EL-07 / ARLA-37 | Actions contextualisées, labels, chargement/erreur, focus, clavier et petite largeur | `e2e/elyes/EL-07/accessibility.spec.ts` | Scénarios ciblés, pas certification globale |
| EL-08 / ARLA-38 | Au clavier : page 2 puis page 1, soumission incertaine, reprise avec même clé, 201 suivi d'un GET500, récupération de l'historique et pagination mise à jour sans POST supplémentaire | `e2e/elyes/EL-08/integrated-flows.spec.ts` | Intégration des comportements UI EL-01/04/05/07 |

La décision PO et [l'ADR LE-06](../adr/LE-06-bounded-ocr.md) retiennent un OCR
synchrone borné, facultatif, avec saisie manuelle. Il n'existe donc pas de
scénario de suivi d'un job OCR durable à ajouter à cette recette.

## Démonstration reproductible sans lire le code

Sur la démo isolée, ouvrir l'URL affichée par MATH-03 et se connecter avec son
compte fictif employé. Utiliser uniquement le reçu de test fourni.

1. Pour observer la panne et la reprise contrôlées, exécuter
   `npm run test:e2e -- tests/e2e/elyes/EL-08/integrated-flows.spec.ts --headed`.
   Le navigateur montre successivement la pagination, les champs conservés,
   le succès de soumission malgré l'erreur d'historique, puis sa récupération.
2. Pour la date, exécuter
   `npm run test:e2e -- tests/e2e/elyes/EL-02/civil-dates.spec.ts --headed`.
   Les contextes Paris et New York doivent afficher la même date civile.
3. Elyes refait personnellement une panne et une date ; Leandro relit les
   assertions et leur capacité à détecter le défaut. Hugo peut ensuite suivre
   le scénario. Ces validations humaines restent à renseigner par leur auteur.

Ne pas couper le réseau de toute la machine. Les interceptions se limitent aux
requêtes utiles dans le contexte navigateur de chaque test.

## Résultats et limites

État de préparation au 25/10/2026 : les suites EL-01 à EL-06 sont livrées dans
les branches existantes ; EL-05 est la PR #29, base de cette consolidation.
Les résultats locaux et la référence du commit validé sont ajoutés après
exécution. La recette finale sur le SHA de remise et la relecture Leandro ne
sont pas acquises par la rédaction de cette page.

Le contrôle négatif ponctuel doit réintroduire un défaut dans une copie de
test, obtenir un échec de l'assertion concernée, restaurer le fichier puis
rejouer le cas. Cette mutation n'est jamais committée. Un import cassé ou
« aucun test trouvé » ne prouve pas que le scénario détecte une régression.

## Trame orale de 90 secondes

« Une panne pouvait perdre la confiance dans une soumission. Le formulaire
conserve maintenant les champs et la même intention de reprise. Je montre
l'erreur, la reprise, puis le test qui exige la même clé et interdit un POST
supplémentaire. Le succès reste affiché même si l'historique ne se recharge
pas immédiatement. La pagination utilise les totaux du serveur. Les dates
sont vérifiées dans deux fuseaux et l'OCR tardif ne remplace pas une saisie.
Ces tests rendent les comportements de l'interface reproductibles ; les
tests serveur, la restauration et la revue humaine apportent les preuves
complémentaires. »
