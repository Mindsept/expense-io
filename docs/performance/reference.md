# Référence mesurée — 22 octobre 2026

Code de mesure **c512b7eb7c889fb21d41b934f57c4cd0a6323d62**, après intégration du main `a0a0ab0` et patchs ARLA-45. Les deux volumes utilisent les mêmes empreintes de code ; les dossiers de résultats étaient non versionnés pendant la mesure, ce qui figure dans l’état du dossier. Aucun résultat de l’ancien arbre parallèle n’est mélangé ici.

| Notes benchmark | Liste | n | Médiane ms | p95 empirique ms | Médianes des 3 passages ms | Erreurs |
| --- | --- | --- | --- | --- | --- | --- |
| 1 000 | employee | 90 | 10.19 | 13.46 | 9.76–11.66 | 0/90 |
| 1 000 | manager | 90 | 8.55 | 11.52 | 7.72–9.41 | 0/90 |
| 1 000 | hr | 90 | 7.22 | 10.15 | 6.97–8.26 | 0/90 |
| 10 000 | employee | 90 | 46.45 | 64.64 | 46.31–48.34 | 0/90 |
| 10 000 | manager | 90 | 35.27 | 48.61 | 33.53–37.89 | 0/90 |
| 10 000 | hr | 90 | 28.29 | 38.88 | 27.56–29.13 | 0/90 |

**540 tentatives de listes authentifiées, zéro erreur** ; 18 échauffements conservés séparément et deux contrôles anonymes 401 conservés comme erreurs diagnostiques. Les payloads renvoient 500/5 000 notes employé, 400/4 000 manager, 300/3 000 RH : le volume transféré augmente avec le jeu. Les temps HTTP augmentent pour les trois listes ; cette observation ne prouve pas qu’un index seul améliorera le résultat. Les 18 plans SELECT bruts permettent à Leandro de distinguer scan, tri et buffers de la sérialisation/transmission.

**48 reconnaissances réelles sur huit PNG synthétiques**, 48 sorties conformes aux attentes du corpus ; contrôle du parseur sur textes sources également 48/48. Les durées individuelles, initialisations et ressources sont dans `ocr.json`. Ces chiffres décrivent exclusivement ce petit corpus ; ils ne constituent pas un taux de précision général. Le diagnostic réutilise un worker entre images, alors que la route actuelle en crée un par appel.

La régénération indépendante des 1 000 notes reproduit la même empreinte et les mêmes statuts. La cible de développement volontairement fournie au runner a été refusée (sortie 1), puis la campagne autorisée a réussi. Lint, typage et les trois tests de métriques passent. La CI intégrée complète est à lire dans la PR de ce ticket ; le blocage macOS du test Hamza `kill EPERM` reste documenté dans ARLA-45. Pas de correction d’un test tiers.

Limites : rôle DB bootstrap privilégié ; caches chauds non maîtrisés ; poste partagé ; absence de pagination ; aucun reçu S3 par ligne de liste ; pas de charge distribuée ; aucun index ou optimisation évalué après correctif. Relecture Leandro et réception de la référence restent attendues ; aucune case de contrôle humain n’est cochée automatiquement.

Données : [1 000 notes](results/1000/summary.json), [10 000 notes](results/10000/summary.json), [protocole et relance](protocole.md), [régénération](results/reproducibility.json), [refus de cible](results/unsafe-target.log). Chaque dossier contient conditions, requêtes HTTP, plans SQL, OCR et état de campagne.
