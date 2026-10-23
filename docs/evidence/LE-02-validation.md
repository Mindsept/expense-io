# LE-02 — Preuve de soumission complète

Base main `1bcebdb03c61597671133fb5447f5d2db61996d9`, 23 octobre 2026.
Protocole, limites et décision : [expense-submission.md](../expense-submission.md).

Une première campagne complète sur le protocole et les six cas HTTP réels passe :
457 tests unitaires, 126 API, 13 Chromium E2E, lint/types/collecte, services jetables,
préparation, build Webpack et nettoyage, toutes étapes code 0 (Node 24.19.0).
Les nouveaux tests comptent alors 19 cas unitaires et six cas API. Le contrôle
explicite d'une référence vide à la frontière de persistance et les compteurs
réseau/assertions pendant le PUT retenu complètent ensuite cette preuve ; la
campagne finale et son SHA sont consignés dans la PR et le commentaire ARLA-20.

Le pipeline temporaire externe réutilise `tests/support/ci.mjs` sans changement
de logique, en remplaçant seulement `npm run build` par
`npm run build -- --webpack` et en résolvant ses deux imports de support vers les
mêmes fichiers du checkout. Aucun fichier de runner, workflow ou manifest n'est
modifié. Le build Turbopack local reste soumis à la restriction IPC connue.
GitHub refuse le lancement manuel d'Actions (HTTP 422, dépôt désactivé) ; aucune
validation distante du nouveau code n'est annoncée ni aucun paramètre global modifié.

Reproduction standard quand GitHub Actions est disponible : `npm ci`, installation
Chromium, `npm run test:ci`. Les suites propriétaires se trouvent dans
`tests/unit/leandro/LE-02` et `tests/api/leandro/LE-02`. Pour les lancer seules,
préparer explicitement les mêmes services `_test`/bucket `-test` isolés et la cible
HTTP via le socle commun ; aucun fallback vers une base de développement.

Les six scénarios API réels sont :

1. Upload → INSERT complet unique → présignature → téléchargement exact des octets.
2. Lecture/téléchargement d'une clé ancienne sans conversion.
3. Refus PUT HTTP injecté devant LocalStack, sans nouvelle note ni objet final.
4. CHECK PostgreSQL temporaire refusant l'INSERT synthétique après PUT 200, puis
   DELETE 204 réel confirmé par les compteurs du proxy et état initial restauré.
5. INSERT refusé et DELETE indisponible : aucune note ajoutée, un objet orphelin,
   référence/corrélation retrouvée dans le seul événement de nettoyage autorisé,
   nettoyage ciblé puis état restauré. Aucun SQL, secret ou reçu dans la réponse/log.
6. PUT réel stocké mais accusé retenu : aucun INSERT encore visible ; désactivation
   PostgreSQL possible sous timeout 2000 ms, donc aucun verrou tenu pendant S3 ;
   après libération, 401, compensation, notes/objets revenus à l'état initial.

Les pannes réseau sont injectées via un proxy loopback possédé par la suite,
qui transmet les opérations réussies à LocalStack ; PostgreSQL n'est pas remplacé
par un double. La perte d'accusé COMMIT est un test de frontière sur double, pas
une panne physique PostgreSQL prétendue : il vérifie que le reçu potentiellement
référencé n'est jamais supprimé, que le diagnostic est exploitable et que l'échec
principal est conservé. Les anciens tests de révocation suivent la nouvelle
insertion unique et exigent désormais zéro INSERT après révocation.

Les contraintes, comptes, entreprises, objets et processus privés sont nettoyés.
Le rôle de bootstrap privilégié ne prouve pas la RLS effective. Les orphelins après
arrêt brutal, journaux non collectés et retries après réponse perdue restent LE-03.
Aucun test ignoré, assertion retirée, retry de test ou faux succès ajouté.
