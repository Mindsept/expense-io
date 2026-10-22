# MATH-02 / ARLA-40 — validation

Référence : branche `codex/arla-40-isolated-test-ci`, empilée sur MATH-01,
commit de base `bf5835a`. Les campagnes locales comportaient les modifications
de MATH-02 dans le dossier de travail : [SHA et état exacts](MATH-02/run.json),
[empreintes de l'implémentation](MATH-02/implementation-sha256.json).

## Contrôles locaux réellement exécutés

Node 24.22.1 / npm 11.19.1 sur macOS ARM64. Installation propre par `npm ci`.
Les versions et chemins de tous les paquets du lockfile restent identiques
à MATH-01 ; seules les métadonnées engines et quelques marqueurs peer/dev
normalisés par npm 11 changent. Aucune dépendance applicative n'est mise à jour.

| Contrôle | Code | Résultat |
| --- | --- | --- |
| `npm run test:ci`, plusieurs stacks vierges indépendantes | 0 | 234 unitaires, 19 API/intégration et 3 E2E, sans cas ignoré ni flaky ; [répétabilité et commandes](MATH-02/repeatability.json) |
| `verify`, `collect`, `build`, `api`, `e2e` dans la campagne finale | 0 chacun | Ordre final : lint/types/unitaires et collecte avant services ; tests contre `next start`, pas `next dev` |
| Préparation avec URL DB de développement proposée | 1 attendu | Refus dans le précontrôle avant toute commande Docker/SQL ; [preuve](MATH-02/development-target-prepare.txt) |
| Nettoyage avec la même mauvaise cible | 1 attendu | Aucune destruction démarrée ; [preuve](MATH-02/development-target-down.txt) |
| Variable externe DATABASE_URL contradictoire | 1 attendu | Refus avant toute commande ; [preuve](MATH-02/external-target.txt) |
| Healthcheck PostgreSQL volontairement faux, attente choisie 5 s | 1 attendu | Échec services à 5,333 s, aucune migration, nettoyage du seul projet à 4,129 s ; [preuve](MATH-02/unhealthy-service.txt) |
| Nettoyage des campagnes positives et négative | 0 | Serveurs et seules stacks créées arrêtés ; [dernière sortie](MATH-02/cleanup.log) |

La configuration de santé a été restaurée octet pour octet après le contrôle
négatif et une campagne complète est ensuite repassée. Les fichiers de test
des autres auteurs, le Compose principal, les migrations et le code applicatif
sont inchangés. Les 24 tests unitaires MATH-02 couvrent cibles/refus, correspondance
des identités de préparation et des tests, moteur Docker local et expurgation.

## Rapports et sécurité des cibles

La dernière campagne réussie est copiée ici : [unitaires](MATH-02/verify.log),
[collecte](MATH-02/collect.log), [build](MATH-02/build.log),
[API](MATH-02/api.log), [E2E](MATH-02/e2e.log), [commandes et codes](MATH-02/commands.json).
Les secrets des fichiers privés générés ont été recherchés dans ces preuves :
aucune valeur n'y figure. Aucun `.env`, cookie, trace, vidéo, justificatif réel,
dump ou URL signée utilisable n'est commité. Le workflow n'archive que le sous-dossier
des rapports expurgés et les conserve trois jours.

Le rôle observé reste `expense_test`, superutilisateur et BYPASSRLS :
[constat](MATH-02/database-role.json). **Aucune preuve RLS ou fixture finale de deux
entreprises n'est revendiquée.** Hamza doit fournir et confirmer ce contrat.
Leandro doit relire l'orchestration avant fusion.

## Vérification distante

La CI GitHub et son contrôle volontairement rouge sont encore à exécuter au
moment de ce premier relevé local. Aucun résultat local n'est présenté comme
un run GitHub. Les liens et SHA distants seront ajoutés après observation.

Voir [le guide de relance](../ci.md) et [la restitution](../restitution-mathis.html).
