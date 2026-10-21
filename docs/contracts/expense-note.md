# LE-12 — Contrat partagé des notes de frais

Le DTO public est `src/contracts/expense-note.ts`. Son adaptateur PostgreSQL est
`src/adapters/expense-note-mapper.ts`. GET et POST `/api/expense-notes` le consomment
immédiatement ; les auteurs des routes manager/RH et des écrans peuvent l'importer
dans HA-03/HA-06/EL-06. Leurs conversions locales restent à migrer par leurs auteurs.

La réponse existante est conservée : `id`, `userId`, `amount` numérique,
`expenseDate`, `description`, `receiptKey`, `status`, `createdAt`.
`expenseDate` est une vraie date civile `YYYY-MM-DD` (années 0001–9999), sans
conversion de fuseau. `createdAt` et l'extension facultative `decidedAt` sont des
instants ISO UTC. L'adaptateur accepte les Date renvoyées par pg ou une chaîne ISO
avec fuseau explicite. Un montant positif compatible NUMERIC(10,2) est converti
entièrement ; une valeur invalide n'est ni tronquée ni remplacée par zéro.
La validation des entrées HTTP reste le chantier LE-01.

`author?: {id, displayName}` est une extension facultative. Le mapper ne fait pas
de jointure et ne déduit pas l'auteur des colonnes privées d'une ligne : seul le
code ayant déjà autorisé la requête peut lui transmettre ce couple. Il recopie
uniquement ces deux propriétés, jamais email, rôle, entreprise ou mot de passe.
Les requêtes personnelles actuelles ne demandent pas cette extension.

Décision : un type HTTP et un adaptateur réellement importé évitent les conversions
divergentes sans déplacer PostgreSQL dans le domaine. Une refonte de toutes les
routes en une seule PR est écartée pour préserver les responsabilités de l'équipe.
Les données persistées incohérentes provoquent une erreur technique contrôlée par
la frontière HTTP existante ; aucune date ou somme n'est inventée pour les masquer.

Tests : `npm run test:unit -- tests/unit/leandro/LE-12` couvre les conversions,
années bissextiles, quatre fuseaux, données invalides et l'import dans le vrai GET
(doubles d'authentification/DB). Les tests HTTP dédiés complètent cette preuve sur
PostgreSQL. Aucun changement de droits, de schéma ou de pagination.
