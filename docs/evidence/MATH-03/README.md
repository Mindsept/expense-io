# ARLA-41 / MATH-03 — preuves et limites

Implémentation sur `codex/arla-41-safe-demo-seed`, depuis main `0265bd5`. Approche validée par Mathis le 24 octobre 2026. Aucun changement de route, migration, policy, Compose de développement ou Makefile. Les commandes et la configuration figurent dans [docs/demo.md](../../demo.md).

## Résultat

- Initialisation non destructive : aucune mise à jour des comptes existants, y compris rôle, entreprise, nom, manager et hash du mot de passe. Identité dans une autre entreprise refusée.
- Deux notes fictives strictement identifiées par acteur, marqueur et UUID ; doublons/candidates ambiguës et clés étrangères refusés avant mutation de reçu. Les anciens textes non marqués restent à faire examiner ; aucune adoption automatique.
- Contrat `SubmitExpense` LE-02 réutilisé, upload avant INSERT complet et conservation en cas de COMMIT incertain. La réparation est une opération explicite et ne réinitialise ni comptes ni décisions.
- S3 : 404 distingué de 401/403 et des pannes ; lecture/commandes bornées et trois tentatives maximum. PNG sain contrôlé sans réécriture ; création conditionnelle. Fichiers privés créés exclusivement, sans suivre un alias ou écraser un fichier existant.
- Démo reproductible via la stack MATH-02, serveur sous le véritable LOGIN limité `expense_web`, secrets privés et reset explicitement confirmé. Le serveur ne reçoit pas sa connexion administrateur.

## Campagnes réellement exécutées

| Preuve | Source | Observation |
| --- | --- | --- |
| [Défaut avant correction](before.json) | `529c35e`, ancien seed identifié par SHA-256 | PostgreSQL et LocalStack réels : 3 comptes / 2 notes / 2 objets ; le second passage écrasait manager et nom modifiés. |
| [Démo réelle](live-demo.json), [smoke navigateur](demo-smoke.log) | `8b03c59`, empreintes consignées | Trois connexions HTTP, listes et véritables PNG ; `expense_web`, superuser=false, bypassrls=false ; 3 comptes / 2 notes / 2 objets et 3/3 smokes navigateur existants. |
| [Relance 1](seed-first-rerun.log), [relance 2](seed-second-rerun.log) | Même campagne de démo | Zéro compte/note créés et zéro upload ; objets sains conservés. |
| [Arrêt terminal corrigé](terminal-stop.json) | Correctif `35864e0`, empreinte du helper conservée | Ctrl+C libère le port du seul serveur lancé ; handlers conservés face aux signaux répétés et filet de fermeture du groupe possédé. |
| [Reset](reset.json), [journal](demo-reset.log), [nettoyage](demo-down.log) | `35864e0` | Sans confirmation : sortie 1 ; après arrêt, reset explicite sortie 0, ancien projet retiré et nouvelle fixture 3/2/2 ; suppression finale limitée à ce nouveau projet. |
| [Validation finale](validation.json), [étapes/codes/durées](final-summary.json) | `2c943d75743c62317014940c791d3536362b5fcc` | Sortie 0 : lint, typage, collecte, **672 unitaires / 234 API / 25 E2E**, production et nettoyage. |

Les suites MATH-03 représentent **17 cas unitaires et 11 cas API**. Les tests API sont collectés par la commande commune ; aucune assertion de tests d'un autre auteur n'est modifiée. Les interruptions DB/S3 sont injectées par un callback de test **entre des opérations sur PostgreSQL/LocalStack réels**, sans option de panne dans le CLI. Elles ne sont pas présentées comme des coupures physiques. Le contrôle 403/503 repose sur des doubles unitaires identifiés.

## Vérifications rouges conservées

Le premier contrôle de Ctrl+C a laissé le serveur enfant actif. Le reset a refusé la suppression ; [ce refus](demo-reset-refused-active-server.log) est conservé. Le processus de cette session a été [identifié avant récupération](owned-process-recovery.json) par son répertoire, son groupe privé, les identifiants fictifs générés et ses connexions ; aucun processus choisi seulement par son port n'a été arrêté. Le gestionnaire d'arrêt a été corrigé puis revérifié.

Une campagne intermédiaire a échoué sur le code du diagnostic d'une note ancienne et, après redémarrage du worker, sur l'installation du bucket dépendante du premier test. [Résumé rouge](validation-intermediate-failed.json), [journal API](validation-intermediate-api.log). Le code classe désormais explicitement la note ancienne et la fixture prépare son bucket indépendamment du scénario. Les assertions de refus restent strictes ; aucun skip, retry, test.fail ou continue-on-error ajouté. La campagne finale locale ci-dessus est verte.

## Limites et réception attendue

Le runner commun garde sa déclaration de baseline privilégiée. La preuve d'application limitée de cette tâche vient de la démo séparée et des suites HA-04 de leur auteur ; une CI verte ne démontre pas à elle seule l'isolation exhaustive.

La démo trois rôles et le reset conservent leurs SHA historiques dans les preuves. Le correctif de création privée exclusive est couvert sur le code final par les tests ; la matrice de seed/réparation complète est rejouée sur la source finale. Les versions et empreintes ne sont pas réétiquetées rétroactivement.

**Encore attendus :** revue Hamza des droits/du script, validation Hugo du parcours et passage du guide par un autre membre sur base vierge. Les commandes PowerShell ont été écrites avec leur syntaxe native mais n'ont pas été exécutées sur Windows ; les validations locales sont sous macOS arm64 / Node 24.22.1 / npm 11.19.1, services sous Colima. Aucune case humaine cochée automatiquement. Le Makefile historique reste à coordonner avec son propriétaire ; la procédure livrée est `demo:*`.

Les anciens reçus de démo sans nouveau marqueur demandent une revue ; aucune donnée personnelle de développement n'est modifiée. Les archives et fichiers de configuration privés ne font pas partie de ces preuves. La CI distante de la tête publiée est liée dans Jira et dans la PR.

## Première CI Linux publiée

[Run 40035296311, tentative 1](https://github.com/Mindsept/expense-io/actions/runs/40035296311/attempts/1), source publiée `aceedd97d7f24530c325d9334760e10a35083125`, fusion de contrôle `f4ffae388c8000c216170eeb41fff62b320f3e46` : lint, typage, production, **672 unitaires et 234 API passent** ; **24 E2E passent et un échoue**. Les trois smokes MATH-01 passent. Nettoyage réussi.

L'assertion d'Elyes dans `tests/e2e/elyes/EL-04/submission-intent.spec.ts:93` sélectionne tous les rôles `status` ; au moment du contrôle, le message de succès et le chargement de l'historique coexistent. Playwright refuse les deux correspondances. C'est un indice d'instabilité du sélecteur, pas une preuve d'absence de régression. Aucun code métier ni test d'Elyes n'a été modifié ; un seul rejeu de la même source a été effectué. Les deux échecs restent consignés ; la fiabilisation reste à examiner avec Elyes.

[Rejeu de la même source, tentative 2](https://github.com/Mindsept/expense-io/actions/runs/40035296311/attempts/2) : **672 unitaires / 234 API / 24 E2E passent**, un autre scénario EL-04 échoue avec le même sélecteur ambigu, cette fois à la ligne 63 du même fichier. Le scénario de la ligne 93 passe. Les trois smokes Mathis passent et le nettoyage réussit. La CI reste **rouge** ; aucun nouvel essai manuel pour chercher un résultat vert. [Relevé initial](ci-linux-attempt-1.json), [relevé du rejeu](ci-linux-attempt-2.json). Ces constats ne remplacent pas la campagne locale finale verte et ne sont pas présentés comme une validation Linux complète.
