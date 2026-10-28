# Couverture des tests unitaires

## Exécution et rapports

Avec les versions Node/npm du dépôt :

```sh
npm ci
npm run test:coverage
```

Cette commande exécute les mêmes suites que `test:unit`, avec le fournisseur
officiel `@vitest/coverage-v8`, épinglé à la même version que Vitest.
`npm run verify` comprend lint, typage et cette mesure, sans doubler les tests
unitaires. `npm run test:ci` réutilise `verify` puis exécute les tests API/E2E.

Les rapports sont générés dans `coverage/unit/` :

- `index.html` : navigation par fichier, lignes exécutées et branches manquantes ;
- `lcov.info` : format standard pour les outils compatibles LCOV ;
- `coverage-summary.json` : totaux et résultats par fichier ;
- résumé texte dans le terminal et tableau dans le résumé GitHub Actions.

Dans GitHub Actions, télécharger l'artefact `unit-coverage-<run>-<tentative>`,
le décompresser et ouvrir `index.html`. Les fichiers sont conservés 14 jours.
Ils sont ignorés par Git et ESLint. Aucun service externe de couverture ni
secret supplémentaire n'est requis.

## Périmètre et interprétation

Le dénominateur comprend le JavaScript/TypeScript applicatif de `src/` et les
scripts opérateur de `scripts/`, **y compris les fichiers non importés par les
tests**. Les déclarations de types `.d.ts`, `.d.mts` et `.d.cts` sont exclues.
Les fichiers de tests/support, configurations, dépendances, sorties générées,
CSS et migrations SQL ne font pas partie de cette mesure.

Les tests API et E2E ne sont pas instrumentés par cette commande. Leur
couverture fonctionnelle reste décrite par leurs scénarios et leurs preuves.
Les processus enfants démarrés par un test ne contribuent pas automatiquement
à la mesure V8 du processus Vitest. Un fichier à 0 % ici peut donc être testé
par une suite API/E2E ou un processus séparé : il faut vérifier ces preuves
avant de conclure qu'il n'est jamais testé.

Une ligne exécutée ne prouve pas qu'une assertion vérifie correctement son
résultat. Un pourcentage élevé ne démontre ni l'isolation RLS, ni l'absence
de défaut, ni l'acceptation métier. Les branches indiquent les chemins
conditionnels exécutés ; elles aident à chercher des cas d'erreur manquants.

Vitest nettoie `coverage/unit/` à chaque mesure. Il tente aussi de produire un
rapport lorsque des tests échouent. Le statut des tests reste bloquant et doit
toujours accompagner les chiffres ; un rapport issu d'une exécution interrompue
ou filtrée ne constitue pas une référence complète.

## Seuils

`vitest.config.mts` impose un minimum global de **90 % pour chacun des quatre
indicateurs** : lignes, instructions, fonctions et branches. Un résultat inférieur
fait échouer `test:coverage`, donc aussi `verify` et `test:ci`. Ce seuil est global,
pas un minimum imposé séparément à chaque fichier. Il ne réduit pas le périmètre.

Référence observée le 28 octobre 2026 sous Windows, Node 24.22.1 et Vitest/V8
5.0.5 : **81 fichiers de tests, 1 390 tests réussis**. Le code applicatif est celui
de `main` à `1a381b6` ; seuls les tests, leur configuration et leur documentation
ont été enrichis. La première mesure du 26 octobre portait sur 748 tests.

| Mesure | Première mesure | Exécuté / total actuel | Couverture actuelle |
| --- | ---: | ---: | ---: |
| Lignes | 36,93 % | 3 080 / 3 095 | 99,51 % |
| Instructions | 32,58 % | 4 234 / 4 373 | 96,82 % |
| Fonctions | 39,35 % | 668 / 709 | 94,21 % |
| Branches | 37,37 % | 2 913 / 3 106 | 93,78 % |

Le rapport conserve les **141 fichiers et les mêmes dénominateurs**. Les tests
ajoutés couvrent les interfaces employé/manager/RH, les invitations, les droits
courants, l'idempotence, les transactions, les notifications, la réconciliation
et les commandes d'exploitation. Ils vérifient succès, refus, pannes et reprises.
Les dépendances externes (SQL, S3, réseau, processus et fichiers des commandes)
sont simulées dans ces suites ; les véritables intégrations restent vérifiées
séparément par API/E2E. Ces chiffres sont une référence datée, pas une promesse
pour les futurs commits ni une preuve de qualité à eux seuls.

Les tests React utilisent jsdom, Testing Library et `NODE_ENV=test`, défini
uniquement dans les workers Vitest. Cela permet d'utiliser `act` même lorsque
`test:ci` est lancé avec un environnement parent de production ; le build et
les tests navigateur continuent à utiliser l'application en production.

Le contrôle négatif du seuil a été vérifié en exécutant une seule suite avec
la couverture complète du dépôt : les assertions passent, mais le processus
renvoie le code 1 parce que les quatre métriques sont inférieures à 90 %.
Pour travailler sur une suite seule, utiliser `npx vitest run <fichier>` sans
couverture ; seule une campagne complète produit une référence comparable.

Références : [guide Vitest](https://vitest.dev/guide/coverage.html) et
[configuration de couverture](https://vitest.dev/config/coverage).
