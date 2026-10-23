# LE-03 — Preuves du 23 octobre 2026

Base main `aa2720b2b5fe9d6797b9eb4b6958cd78ec2cad2b`. Le commit testé et la
fusion sont consignés dans la PR liée à ARLA-21 pour éviter une référence de SHA
circulaire dans ce fichier. Voir [le protocole](../expense-idempotency.md).

Pipeline local complet sous Node 24.19.0 : **486 unitaires, 139 API, 13 E2E**,
aucun retry. Lint, typecheck, collecte, PostgreSQL/LocalStack jetables, migrations,
seed, build de production, API, navigateurs et cleanup : tous code de sortie 0.
Commande exécutée : `node /tmp/arla-le10-ci-webpack.mjs` avec le runtime Node24 et
npm_execpath explicites ; copie extérieure du runner partagé dont seul le build
reçoit `--webpack`. Les imports de support pointent vers les mêmes modules du
checkout. Le runner, les scripts npm, le lockfile et les workflows sont inchangés.

Le build Turbopack de cette machine ne peut pas ouvrir son IPC ; le build Webpack
réussit. GitHub Actions est désactivé au niveau du dépôt (dispatch HTTP 422 observé
pendant LE-01/02) : **aucune validation distante verte n'est revendiquée**. Les
preuves sont locales ; le dernier pipeline standard Linux antérieur ne valide
pas ce diff. Pas de contournement de règle de branche. Le nettoyage final des
services et processus propres aux tests a réussi.

## Preuves nouvelles

28 tests unitaires : UUID facultatif et en-têtes invalides/répétés, fingerprint
canonique/champs/octets, sélection/rejeu autorisé, lease/expiration/conflit,
clôture d'ancienne tentative, cohérence du cache, transaction note+résultat,
COMMIT incertain, bornes de maintenance et absence de fallback/secret dans sa
sortie. Les doubles explicitent l'ordre et les cas d'échec ; ils ne constituent
pas la preuve réseau/SQL ci-dessous.

13 tests API supplémentaires utilisent PostgreSQL et LocalStack réels, deux
processus Next de production et des sessions Auth.js Credentials réelles :

- Requêtes simultanées sur les deux processus : premier PUT retenu, second 409,
  puis un seul résultat 201 et un rejeu sans second PUT/INSERT.
- Proxy qui coupe réellement la réponse 201 après commit ; retry depuis l'autre
  serveur retrouve le cache durable sans upload supplémentaire.
- Conflit de champs ou d'octets valides ; équivalence du montant/trim/nom ; même
  UUID chez un autre utilisateur/entreprise indépendant.
- Comptes révoqués/supprimés et changement d'entreprise avec cookies antérieurs :
  aucun accès à l'ancien résultat ni upload après révocation.
- Expiration sept jours et mauvais en-têtes sans mutation.
- CHECK SQL sur le cache final : rollback atomique de la note et du résultat ;
  DELETE S3 refusé laisse une référence durable ; reprise avec une nouvelle
  tentative puis nettoyage de l'ancienne sans supprimer le reçu gagnant.
- Simulation puis apply bornés par âge/entreprise/limite, échec réel de stockage,
  préservation des objets récents, étrangers et référencés par une vraie note.
- Véritable LOGIN restreint : current_user=session_user sans SUPERUSER/BYPASSRLS,
  accès positifs propres, refus lecture/INSERT/UPDATE étrangers, entreprise
  historique du même propriétaire invisible, aucun DELETE/TRUNCATE, contexte
  absent/inactif refusé. Cette preuve concerne les deux nouvelles tables,
  indépendamment du rôle bootstrap du runner principal.
- Migration up/down/up dans un schéma isolé, lignes métier de base conservées.
- Ancien PUT retenu, lease expirée et clôture de maintenance, nouvelle tentative
  commitée depuis l'autre processus, puis ancienne réponse libérée : l'ancienne
  ne commite pas et sa compensation conserve l'objet gagnant.
- Arrêt brutal du premier processus entre PUT effectif et accusé de réception :
  registre survivant, simulation sans suppression puis nettoyage ciblé, deuxième
  serveur et processus partagé conservés.

Les fixtures sont synthétiques et leurs rôles, objets, contraintes, schémas et
processus sont nettoyés. Aucun test n'efface un bucket ou un schéma public entier.
Aucun test navigateur supplémentaire n'est nécessaire : ce ticket ajoute un
contrat serveur facultatif ; les 13 parcours navigateur existants passent.

## Reproduction

`npm run verify`, `npm run test:collect`, `npm run test:ci` avec les dépendances et
variables isolées du support commun. Pour la limitation IPC locale, transmettre
`--webpack` au build dans une copie externe du runner sans modifier le dépôt.
Les suites nouvelles sont sous `tests/unit/leandro/LE-03` et
`tests/api/leandro/LE-03`; leur harness HTTP est sous `tests/contracts/leandro/LE-03`.
La validation OpenAPI officielle et `git diff --check` complètent ces contrôles.

Limites : absence de CI distante et de relecture humaine indépendante revendiquée,
clé encore facultative, rétention du registre sans purge, budget de maintenance
souple entre phases, possibilité de PUT tardif nécessitant un nouveau passage,
activation RLS globale HA-04 encore distincte. Le nouveau catalogue d'erreurs
central et l'extraction de l'INSERT LE-02 sont des adaptations nécessaires du
contrat partagé, sans refonte des helpers HA-02/DB ni du cas d'usage HA-03.
