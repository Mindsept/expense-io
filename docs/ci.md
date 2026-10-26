# CI — MATH-02 / ARLA-40

La même commande exécute la validation locale et GitHub Actions :

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:ci
```

Prérequis : Node 24 (`.nvmrc`), Docker avec Compose et ports loopback 55440
(PostgreSQL), 45740 (S3), 3199 (application) et 3198 (serveur privé HA-01) libres.
Sous Windows, `npx playwright install chromium` suffit si les dépendances du
navigateur sont déjà présentes. Le lanceur fonctionne sans shell Bash.

## Séquence et isolation

1. Construire une configuration de test en mémoire avec secrets aléatoires.
   Valider le marqueur `isolated`, la cible loopback, les ports distincts,
   la base `expense_io_test`, le bucket `receipts-ci-test` et le projet Compose
   neuf `arla-ci-<identifiant>`. Refuser tout port occupé avant préparation.
2. Exécuter `verify` (lint, types, unitaires avec couverture V8) puis `test:collect`, qui vérifie
   la présence des suites et de leurs exemples connus sans les faire passer
   pour des tests exécutés.
3. Démarrer `docker-compose.test.yml` avec une attente santé de 180 secondes.
   Les images sont celles du dépôt : PostgreSQL 16 Alpine, LocalStack 3.8.1.
   Les volumes appartiennent uniquement au projet de cette invocation.
4. Exécuter `test:prepare` : précontrôle, migrations existantes via API explicite,
   création du bucket, seed sur la base vide. Aucun `.env` personnel n'est lu
   par la préparation ; le seed ne publie pas ses identifiants.
5. Construire avec `next build`, démarrer avec `next start`, attendre HTTP
   pendant au plus 60 secondes, exécuter toutes les suites API puis E2E.
6. En `finally`, arrêter les processus possédés et supprimer seulement les
   volumes du projet de test explicitement nommé, après un nouveau précontrôle.
   Un échec de nettoyage fait échouer la commande. Une VM GitHub annulée est jetée.

Les variables des suites déjà livrées et des drafts HA-02/03/04/05/06 et LE-01
sont mappées vers cette cible isolée. HA-04 reçoit une seconde base vide
`expense_rls_test` dans le même cluster jetable : il prépare lui-même son schéma.
Les comptes des trois rôles utilisent
le domaine fictif `expense.test`. Aucun état de connexion n'est réutilisé entre
les tests navigateur.

La référence utilise encore le rôle bootstrap privilégié. **Cette CI ne prouve
pas l'isolation RLS** : l'intégration du rôle applicatif et de la matrice de deux
entreprises reste à HA-04. Aucune policy ni migration n'est assouplie pour obtenir
un résultat vert. La mise à jour des dépendances signalées par HA-08 reste MATH-07.

## PR et relance des branches existantes

`pull_request` n'a aucun filtre de branche cible et inclut les brouillons, lorsque
le workflow est présent dans l'arbre de fusion de la PR. Les pushes sur `main`
sont aussi vérifiés. Aucun filtre de chemins, `skip`, retry automatique ou tolérance
d'échec n'est utilisé. `forbidOnly` interdit un test exclusif en CI.

Ajouter un workflow ne déclenche pas rétroactivement les PR existantes. Après
fusion de la CI, Actions → CI → Run workflow, branche **main**, permet de saisir
`pr_number`. Le lancement récupère le SHA exact de la PR et celui de `main`, puis
fusionne les deux dans le checkout éphémère du runner. Cela inclut les commits
parents des PR empilées ; un conflit échoue explicitement. La branche de l'auteur
et la PR ne sont pas modifiées. Le statut **CI / integration with main** est
publié sur le SHA de la PR, avec le lien vers les résultats et les SHA testés.
Ce résultat certifie cette combinaison avec `main`, pas la branche historique
isolée ni un futur SHA non exécuté.

Pour une PR empilée dont la base et la branche ne contiennent pas encore ce
workflow (actuellement #7 et #11, basées sur HA-02), refaire ce lancement manuel
après chaque nouveau push. L'exécution automatique de ces PR commencera lorsque
leur arbre de fusion contiendra la CI, par exemple après mise à jour de leur base
avec `main`. Les branches des auteurs ne sont pas modifiées par cette livraison.

Le job qui exécute le code possède uniquement `contents: read`, ne reçoit aucun
secret du dépôt et ne conserve pas les identifiants Git du checkout. La publication
du statut se fait dans un autre runner sans checkout ni exécution d'artefact de PR.
Il n'y a pas de `pull_request_target` exécutant le code d'une PR.

## Preuves et limites

La couverture unitaire est produite par `npm run test:coverage`, aussi appelé par
`verify`. Le résumé du job présente les lignes, instructions, fonctions et
branches couvertes. L'artefact `unit-coverage-<run>-<tentative>` contient les
rapports HTML, LCOV et JSON, conservés 14 jours. Les rapports sont aussi publiés
après un échec si Vitest a pu les produire ; ils ne remplacent pas le résultat
des tests. Voir [le périmètre et la lecture de la couverture](test-coverage.md).

`.ci-output/` contient les logs texte expurgés de chaque étape, les logs du serveur
et `summary.json` avec les codes de sortie. GitHub les conserve cinq jours, y compris
en cas d'échec. Les mots de passe générés, URL DB et liens de reçus signés sont
masqués avant écriture. Les rapports navigateur bruts, cookies, traces et captures
ne sont pas publiés. Le log E2E indique chaque scénario et son résultat.

Un run vert nécessite toutes les suites, la préparation et le nettoyage réussis.
Il ne remplace pas la revue métier et ne certifie pas les tickets encore partiels.
Pour reproduire la campagne depuis un état vierge, relancer `test:ci` : un nouveau
projet est créé, puis détruit à chaque invocation.

Références : [déclencheurs GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
[lancement manuel](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
