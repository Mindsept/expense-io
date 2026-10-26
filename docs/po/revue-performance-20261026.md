# ARLA-43 — revue des preuves paginées, 26 octobre 2026

Intention de la PR #17 : fournir une référence reproductible compatible avec les listes paginées, sous le vrai rôle web limité, sans modifier l'optimisation métier. Cette revue est une **relecture assistée des artefacts publiés**, pas une nouvelle campagne ni une réception signée par Leandro.

Publication examinée : [`ae7d7dc1e72ce04db4cef8fa1c1bdaee67b0df10`](https://github.com/Mindsept/expense-io/tree/ae7d7dc1e72ce04db4cef8fa1c1bdaee67b0df10). Code mesuré : `ad51a01445765e47a6e914dbbe7ecddf9b108e79`. Le diff entre ces deux commits contient uniquement des documents/résultats et le support de restitution ; le code des mesures n'y change pas.

Sources : [protocole v4](https://github.com/Mindsept/expense-io/blob/ae7d7dc1e72ce04db4cef8fa1c1bdaee67b0df10/docs/performance/paged-20261025.md), [résumé et liens vers les bruts](https://github.com/Mindsept/expense-io/blob/ae7d7dc1e72ce04db4cef8fa1c1bdaee67b0df10/docs/performance/results/paged-20261025/README.md), fichiers `http.json`, `conditions.json`, `sql-plans.json`, `ocr.json` des deux volumes.

## Contrôles effectués

- JSON lus via `git show` sur les objets locaux récupérés du fork, sans appel à une cible de données.
- Recalcul des six médianes et p95 à partir des 90 tentatives mesurées de chaque rôle/volume : concordance avec le résumé, à une tolérance flottante de 10⁻⁷ ms.
- Comptage par phase : chaque volume contient 270 mesures, 9 échauffements et 1 diagnostic anonyme ; aucune erreur parmi les mesures. Les 401 intentionnels restent hors des 540 requêtes mesurées.
- Conditions : trois passages, trente requêtes par rôle/passage, concurrence quatre, page 1 de taille 100 ; vérification stricte des totaux et agrégats prévue par le protocole.
- Identité publiée : `current_user = session_user = expense_web`, non-superutilisateur, sans BYPASSRLS/CREATEDB/CREATEROLE/INHERIT ; garde d'isolation réussi. Préparation administrative séparée.
- Neuf plans par volume et vingt-quatre reconnaissances OCR par volume, distinctes des trois initialisations de worker. La reproduction du jeu de 1000 notes publie des condensats identiques.

| Notes | Rôle | Mesures | Médiane recalculée | p95 recalculé |
| --- | --- | --- | --- | --- |
| 1000 | Employé | 90 | 7,7500 ms | 12,004 ms |
| 1000 | Manager | 90 | 21,9630 ms | 29,477 ms |
| 1000 | RH | 90 | 19,3945 ms | 32,969 ms |
| 10000 | Employé | 90 | 9,9805 ms | 15,684 ms |
| 10000 | Manager | 90 | 196,8610 ms | 383,343 ms |
| 10000 | RH | 90 | 128,6080 ms | 175,896 ms |

## Conclusion et limites

Aucune incohérence bloquante trouvée dans les compteurs, médianes/p95 et rattachements de source examinés. Les échauffements/refus sont correctement séparés, les résultats historiques préservés et la portée des métriques est explicitée. Le dossier constitue une référence exploitable pour comparer une future mesure faite avec **le même protocole**.

Il ne permet pas de calculer un gain face aux anciennes listes complètes, de promettre une capacité de production, de certifier une matrice RLS exhaustive ni d'évaluer le pool OCR HTTP. La machine est partagée, son activité concurrente non inventoriée ; le second passage manager est plus lent que les premier/troisième, ce qui doit rester visible. L'OCR porte sur un petit corpus synthétique. L'exécution elle-même a été faite par l'auteur de la campagne ; cette revue vérifie la cohérence de ses bruts, pas une reproduction indépendante du benchmark.

La réception technique nominative Leandro reste distincte de cette revue. Les tests/relectures autonomes autorisés par Hugo le 26 octobre peuvent être consignés comme tels, sans usurper l'identité d'un relecteur. La clôture et l'intégration sont à rapprocher de la preuve finale du candidat retenu.
