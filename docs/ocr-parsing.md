# LE-04 — Suggestions OCR et abstention

Le parsing pur est dans `src/lib/ocr-parser.ts`, appelé immédiatement par
`suggestFields` après Tesseract. Le contrat HTTP reste `{amount?, expenseDate?}`.
Une analyse réussie sans information fiable retourne `{}` ; aucun montant nul,
date du jour ou score de confiance n'est inventé.

## Montant

Le parseur examine toutes les lignes. Il compare les valeurs au niveau de
priorité le plus élevé présent :

1. TTC, total final/TTC/à payer, net ou montant à payer ;
2. total ou montant total ;
3. montant ;
4. ligne contenant uniquement une somme et sa devise EUR/€, uniquement si aucun
   libellé de montant n'apparaît ailleurs dans le texte : un retour à la ligne
   OCR ne doit pas transformer une somme HT ou un sous-total en total final.

HT, total HT, TVA, sous-total, remise et monnaie rendue ne sont pas des totaux
finaux. Des labels compacts comme `HT100` et `TTC120` sont reconnus. À priorité
égale, des valeurs différentes entraînent une abstention ; les répétitions de
la même valeur sont acceptées. Un label prioritaire dont la valeur est illisible
entraîne également une abstention, sans se rabattre sur un sous-total.

Les sommes acceptées sont positives et compatibles NUMERIC(10,2). Entiers,
virgule ou point décimal à deux chiffres, regroupements français par espace
(y compris insécable) ou point sont admis. Exemples : `1234,56`, `1 234,56`,
`1.234,56`, `1234.56`. Les regroupements américains par virgule, exposants,
suffixes et valeurs négatives ne sont pas interprétés. Une ambiguïté dans la
syntaxe n'est pas corrigée par un parseFloat partiel ou un arrondi.

## Date

Les formats historiques JJ/MM/AAAA (aussi points/tirets), AAAA-MM-JJ, JJ/MM/AA
et mois français textuels sont conservés. Les années à deux chiffres désignent
2000–2099, comme auparavant. La validation civile partagée de LE-12 contrôle les
jours, mois et années bissextiles sans conversion de fuseau. Plusieurs dates
valides différentes provoquent une abstention sur la date seulement ; aucune
interdiction de date future n'est ajoutée en l'absence de décision PO-01.

## Décision et limites

Séparer le parsing de la reconnaissance rend les erreurs de sélection
reproductibles sans appeler un moteur OCR. Prendre le maximum ou la première
ligne contenant « total » est écarté : cela choisissait 40 au lieu du total
après remise de 35. Des heuristiques prudentes privilégient une saisie manuelle
à une suggestion injustifiée ; il ne s'agit pas d'un moteur comptable universel.

Le formulaire garde ses champs montant/date éditables et annonce explicitement
la saisie manuelle lorsqu'une réponse est vide. Les changements d'Elyes fusionnés
dans `9adbd6e` ajoutent la protection des saisies concurrentes pendant l'OCR
(code EL-03 et ses tests unitaires), distincte du parseur LE-04.
LE-04 ne change ni le frontend, ni les droits,
ni les formats de dépôt PNG/JPEG/WebP/PDF. Les bornes de corps, de concurrence
et de durée ainsi que la distinction panne/timeout/résultat vide restent LE-05.
Le traitement existant des exceptions du moteur reste inchangé.
