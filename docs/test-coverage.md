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

Première référence observée le 26 octobre 2026 sous Windows, Node 24.22.1,
Vitest/V8 5.0.5, sur le code applicatif de `main` à `a8b70ef` avec
l'instrumentation de cette PR : **53 fichiers de tests, 748 tests réussis**.
Les exécutions `test:coverage` et `verify` ont donné les mêmes résultats :

| Mesure | Exécuté / total | Couverture |
| --- | ---: | ---: |
| Lignes | 1 143 / 3 095 | 36,93 % |
| Instructions | 1 425 / 4 373 | 32,58 % |
| Fonctions | 279 / 709 | 39,35 % |
| Branches | 1 161 / 3 106 | 37,37 % |

Le rapport répertorie 141 fichiers, dont 62 avec des lignes exécutables à 0 %.
Par exemple, l'écran `src/app/expenses/page.tsx` reste visible à 0 % dans la
mesure unitaire ; ses parcours Playwright sont des preuves distinctes. Ces
chiffres sont une référence datée, pas une promesse pour les futurs commits.

Cette première instrumentation publie la mesure sans imposer de pourcentage
arbitraire. Aucun fichier applicatif n'est retiré pour augmenter le résultat.
Un futur seuil doit partir de la référence complète et des risques métier,
avec un périmètre stable ; il pourra être ajouté sans modifier les assertions.

Références : [guide Vitest](https://vitest.dev/guide/coverage.html) et
[configuration de couverture](https://vitest.dev/config/coverage).
