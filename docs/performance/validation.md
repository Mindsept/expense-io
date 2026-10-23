# Validation MATH-05 / ARLA-43

> Référence historique du 22 octobre. La [campagne sur le rôle limité](results/post-rls-20261023/reference.md) et son [protocole actualisé](post-rls.md) décrivent le runtime actuel ; les anciens résultats bruts sont conservés.

[PR #17](https://github.com/Mindsept/expense-io/pull/17), empilée sur [ARLA-45 #16](https://github.com/Mindsept/expense-io/pull/16), elle-même réalignée sur main après l’intégration #14.

- Mesures locales : code `c512b7eb7c889fb21d41b934f57c4cd0a6323d62`, deux volumes, trois passages, conditions et empreintes conservées dans les deux dossiers de résultats. États de campagne `passed`, nettoyage des stacks possédées réussi ; aucune configuration active restante.
- [CI intégrée Linux 39785747281](https://github.com/Mindsept/expense-io/actions/runs/39785747281) sur la source `33fc622298778b4e7f3b81b9f7bfa6fc4a59f216` (commit de fusion temporaire PR exécuté par GitHub), job `119848722764` : installation propre, lint, typage, collecte, **282 unitaires, 21 API et 12 E2E**, préparation, build production et nettoyage réussis.
- Les trois tests de métriques vérifient que les erreurs/timeouts restent dans le dénominateur et les latences, qu’aucun quantile n’est inventé pour un petit échantillon et que le rang empirique est correct. Un contrôle HTTP anonyme réel produit une erreur 401 conservée par volume ; la cible de développement proposée au runner est refusée avant écriture.
- Réexécution indépendante de la préparation 1 000 notes : caractéristiques et empreinte identiques ; [preuve](results/reproducibility.json).
- Restitution HTML : huit slides contrôlées dans le navigateur, navigation et une seule slide visible, absence de débordement et d’intersection entre sous-titres/contenu/pieds de page. Le titre de la slide des blocages a été raccourci après revue visuelle.

Le poste n’est pas dédié. D’autres projets Docker sont présents lors du contrôle après campagne ; leur activité exacte pendant les mesures n’a pas été inventoriée. Les mesures ne démontrent aucune capacité de production ni gain d’index. Le rôle reste privilégié et la matrice RLS est absente. Le problème local macOS `kill EPERM` du test Hamza est conservé dans les preuves ARLA-45 ; Linux passe sans modifier ce test.

Réception/relecture Leandro, validation sécurité Hamza/Hugo et recette finale MATH-04 restent attendues. Les contrôles humains ne sont pas cochés automatiquement. Les modifications ultérieures de restitution/validation sont documentaires ; la référence de mesure garde son SHA et ses empreintes d’origine.
