# Corpus OCR synthétique LE-04, version 1

Provenance : textes originaux écrits pour Expense.io, rendus par
`scripts/leandro/LE-04/generate-corpus.mjs`. Aucun reçu personnel, scan tiers,
logo ou donnée de client. Textes, vérités terrain et images synthétiques de ce
répertoire sont disponibles sous CC0-1.0. Aucun fichier de police n'est distribué.
Le générateur utilise Arial installée sur la machine et sharp déjà installé via
Next. Des plateformes avec une autre police de substitution peuvent produire
des pixels différents ; les PNG versionnés sont la référence de la mesure.

`text-corpus.json` définit indépendamment 54 textes avec leur résultat attendu.
`images.json` décrit les lignes visibles et les valeurs attendues des huit PNG.
Quatre images ont un montant et une date ; les quatre autres attendent une
abstention (totaux contradictoires, image blanche, HT et sous-total séparés de
leur valeur par un retour à la ligne). Les textes et images doivent
être examinés quand la vérité terrain change ; les sorties de Tesseract ne sont
jamais utilisées pour définir rétroactivement le résultat attendu.

Les cas multilignes vérifient qu'une somme isolée avec devise ne contourne pas
un libellé HT, sous-total ou TVA placé ailleurs dans le texte. Un total final
explicitement libellé reste utilisable ; une date fiable reste proposée même
si le montant est ambigu. Sans association fiable entre lignes, le parseur
s'abstient plutôt que de rattacher arbitrairement la somme à un libellé.

Reproduction sous Node 24 :

```sh
node scripts/leandro/LE-04/generate-corpus.mjs
npm run test:unit -- tests/unit/leandro/LE-04
npm run test:api -- tests/api/leandro/LE-04/corpus.spec.ts
```

La dernière commande ne demande ni navigateur ni serveur. Elle utilise le vrai
Tesseract français et la langue versionnée dans `tessdata`, et imprime le texte
reconnu de chaque image synthétique. Les tests HTTP de `http.spec.ts` demandent
en plus `LE04_TEST_BASE_URL` et `LE04_TEST_DATABASE_URL` désignant une application
locale de test et une base locale migrée suffixée `_test`. Ils refusent les
autres cibles avant toute écriture, créent un acteur synthétique et ne soumettent
pas de note finale. Les exemples d'environnement LE-12 s'appliquent.

Ne pas ajouter de justificatifs de personnes réelles sans autorisation et
provenance/licence documentées. Ce petit corpus imprimé proprement ne mesure ni
les photos floues, ni les tickets froissés, ni la variabilité des commerçants.
