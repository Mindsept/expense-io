# LE-04 — Validation du 21 octobre 2026

Base : `9465225` (main après LE-12). Node 24.19.0, lockfile inchangé.

## Défauts reproduits avant correction

Six scénarios exécutés via le vrai `suggestFields`, avec double de Tesseract :
quatre échecs, deux succès sur l'ancienne implémentation.

| Texte | Avant | Attendu et après |
| --- | --- | --- |
| `TOTAL 1234,56` | 1234 | 1234.56 |
| `HT100` puis `TTC120` | aucune suggestion | 120 |
| sous-total 40, remise 5, total 35 | 40 | 35 |
| total 12 puis total 18 | 12 | abstention |

Ces mêmes scénarios passent après extraction du parseur pur, sans modifier les
assertions. Les deux autres cas (montant groupé, texte vide) restent valides.

## Contrôles exécutés

| Commande | Résultat |
| --- | --- |
| `npm run test:unit` | 189 tests réussis, dont 51 LE-04 |
| `npm run lint` | code 0 |
| `npm run typecheck` | code 0 |
| `npm run build -- --webpack` | code 0 |
| `npm run test:api` | 18 tests réussis |
| `git diff --check` | code 0 |

Les 51 tests LE-04 comprennent 44 textes à vérité terrain explicite, un contrôle
d'indépendance entre appels et six régressions dans la fonction de production.
Les 18 tests API comprennent les 11 régressions/DTO existants et sept LE-04 :
un passage direct de six PNG dans Tesseract français réel, puis six requêtes
multipart vers la route OCR du serveur Next de production, authentifiées par une
vraie session sur PostgreSQL de test. Aucune note n'est créée par la suggestion.
Environnement isolé décrit dans `LE-12-validation.md`, avec les variables
`LE04_TEST_BASE_URL` et `LE04_TEST_DATABASE_URL` désignant ces mêmes cibles.

## Mesure distincte texte/image

| Image synthétique | Vérité terrain montant/date | Parsing du texte source | Tesseract réel + parsing | HTTP réel |
| --- | --- | --- | --- | --- |
| large-total | 1234.56 / 2026-10-21 | conforme | conforme | conforme |
| tax | 120 / 2026-10-21 | conforme | conforme | conforme |
| discount | 35 / 2026-10-21 | conforme | conforme | conforme |
| leap-day | 12.5 / 2024-02-29 | conforme | conforme | conforme |
| ambiguous | abstention | conforme | abstention | abstention |
| blank | abstention | conforme | abstention | abstention |

Les six PNG ont été inspectés visuellement contre leurs lignes sources et leur
vérité terrain. Ils sont synthétiques, documentés avec provenance et licence,
sans justificatif personnel. Les sorties de reconnaissance sont imprimées par
`tests/api/leandro/LE-04/corpus.spec.ts` ; aucune erreur de montant/date et aucune
abstention inattendue n'ont été observées sur ces six images. Les deux abstentions
attendues sont conservées dans le bilan, pas comptées comme champs reconnus.
Cela ne donne aucune précision générale ni garantie sur les photos réelles.

## Relecture et limites

Le parseur est réellement appelé par `suggestFields`. Le moteur, son worker et
son `finally` restent dans `ocr.ts` ; le contrat de suggestion est conservé.
Les champs du formulaire restent éditables via leurs `onChange`, et la réponse
vide déclenche le message de saisie manuelle existant. Aucun frontend modifié.
EL-03 reste nécessaire pour éviter l'écrasement d'une saisie concurrente.

Les pannes moteur peuvent encore devenir une suggestion vide selon le traitement
historique : LE-05 doit distinguer ces erreurs et borner durée/capacité/corps.
Aucun job durable ni nouvelle infrastructure ajoutés. Aucune revendication de
performance en production, de RLS ou de recette humaine de l'équipe. Le script
E2E navigateur n'existe pas encore ; le build Turbopack est limité par son IPC
dans cet environnement, comme indiqué dans la preuve LE-12.
