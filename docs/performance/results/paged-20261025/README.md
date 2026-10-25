# ARLA-43 — référence paginée du 25 octobre 2026

Source mesurée : `ad51a01445765e47a6e914dbbe7ecddf9b108e79`, base main `888a74ddae9db28378596adc7709358798986e49`. Protocole [v4](../../paged-20261025.md), première page de 100 éléments avec agrégats et total autorisé, vrai rôle `expense_web` sans superuser/BYPASSRLS.

| Volume | Mesures / erreurs | Médiane employé | Médiane manager | Médiane RH |
| --- | --- | --- | --- | --- |
| 1 000 notes | 270 / 0 | 7,75 ms | 21,963 ms | 19,3945 ms |
| 10 000 notes | 270 / 0 | 9,9805 ms | 196,861 ms | 128,608 ms |

Trois passages de 30 requêtes par rôle, concurrence 4. Voir [résumé et passages](summary.json), [reproduction du jeu](reproducibility.json) et [chaîne locale](local-ci.json) : 708 unitaires, 242 API et 29 E2E réussis. Les deux jeux neufs et la reproduction ont été nettoyés.

Chaque volume comprend séparément 9 échauffements et un contrôle anonyme refusé en 401, attendu et conservé. Les 540 requêtes mesurées ont 0 erreur ; ce total exclut ce refus intentionnel. 18 plans SQL via les vraies fonctions partagées, 48 reconnaissances OCR sur le petit corpus synthétique, toutes correctes. OCR hors HTTP, poste partagé ; aucune promesse de capacité ni comparaison directe avec les anciennes listes complètes.

Bruts relus (JSON uniquement, journaux serveur et configurations privées exclus) :

- [1 000 notes](../runs/2026-10-25T22-09-58-576Z-YV6YRM/1000/summary.json) : conditions, HTTP par tentative, plans SQL, OCR, résultat et résumé dans le même dossier.
- [10 000 notes](../runs/2026-10-25T22-11-03-929Z-Yz7yg8/10000/summary.json) : mêmes six fichiers.

Réception de Leandro encore attendue ; aucune route, migration, policy ou optimisation métier modifiée par Mathis.
