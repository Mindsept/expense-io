# ARLA-44 / MATH-06 — preuves du 25 octobre 2026

Implémentation dans le fork **Mindsept/expense-io**, branche `codex/arla-44-local-operations`. Aucun changement de migration, policy, privilège métier, route ou écran. Le correctif de portabilité Windows OpenAPI de Mathis est conservé dans le commit séparé `0b2cf21` (cherry-pick de `5b7c992`). [Runbook et commandes](../../exploitation-locale.md).

## Campagne réellement exécutée

Poste Windows, Node **24.22.1**, npm **11.19.1**, Docker Desktop **4.96.3**, moteur **29.9.2**, PostgreSQL **16**, LocalStack **3.8.1**. TLS vérifié via le magasin système Windows ; la variable héritée désactivant la vérification a été retirée avant l'installation effective. Aucun service de développement ni projet d'un autre travail n'a été adopté ou nettoyé.

Les preuves applicatives se rattachent à `0b2cf21e9e5fc5993d785cfe55b3b05535585cd1`. Les modules MATH-06 étaient les changements en cours de ce ticket : leur empreinte exacte, incluant `package.json` et le Compose de test, est `12629c27d826f457bb2e2ea7d6efdc7379d5a80921ba2512c29c2e67ceb6632e`. Ce n'est pas une prétention que MATH-06 était déjà présent dans le seul commit applicatif. Les migrations et les contrats partagés étaient inchangés ; le garde de révision le vérifie.

| Contrôle | Résultat réellement observé |
| --- | --- |
| `docker compose config --format json` avec projection expurgée | Code 0 ; les deux publications du Compose local résolvent `127.0.0.1`, ports 5433 et 4567 ; services/volumes/healthchecks inchangés. Aucune pile de développement redémarrée. |
| `npm ci` avec versions épinglées | Code 0, lockfile inchangé. L'avis d'audit npm existant n'a pas été traité par un changement de dépendances hors périmètre. |
| `npm run verify` final | Code 0 : lint, typecheck et **687 tests / 45 fichiers** passent. Une alerte lint préexistante `deliverOneAssignment` inutilisé dans HA-09 reste un warning. |
| Tests unitaires MATH-06 | **23 cas**, dont diagnostic en lecture seule, pannes DB/S3 simulées, mauvais noms de cible, secrets absents des messages/environnement web, WebP, chemins de reçus et limites d'archive. |
| Préparation fictive | Trois comptes et deux notes via MATH-02 ; login `expense_web` provisionné via le helper HA-04. Projets/ports uniques, configuration privée ignorée par Git. |
| [Export final](backup-summary.json) | Code 0 en **1 290 ms**, 3 comptes, 2 notes et **3 objets**. Deux PNG liés aux notes et un véritable fichier WebP de fixture LE-01 supplémentaire dans le bucket. Statut `exported-unverified` conservé. |
| [Restauration finale](restoration-windows.json) | Code 0 en **22 743 ms**, nouvelle cible vierge. Toutes les tables/comptages/empreintes et les 3 objets restaurés concordent. Le WebP a été relu et comparé comme les PNG. |
| Parcours après restauration | Vrai login PostgreSQL `expense_web`, 3 authentifications HTTP et pages/listes autorisées ; **2 reçus distincts** téléchargés via les routes et URL signées puis comparés. Serveur de cette vérification arrêté. |
| [Préservation de la source](source-preservation.json) | Toutes les tables et tous les objets/empreintes de la source finale restent identiques au manifeste après restauration et diagnostic. |
| [Diagnostic réel](doctor-windows.json) | Tout disponible : code 0 / 289 ms. Configuration absente : code 1 / 290 ms. Bucket absent : code 1 / 250 ms. PostgreSQL suspendu : code 1 / 2 756 ms. LocalStack suspendu : code 1 / 2 792 ms. Suspension/reprise des seuls conteneurs de cette fixture ; compteurs/objets inchangés. |
| [Refus réels](refusals-windows.json) | Base de développement, confirmation absente, sortie existante, archive incomplète, dump corrompu, port occupé : code 1, nouvelles sorties non créées et archive existante intacte. Le garde de projet existant a aussi refusé la pile déjà présente en lecture seule. |
| [Nettoyage](cleanup-windows.json) | Suppression explicite limitée aux trois projets neufs de cette campagne. Aucun conteneur/volume/réseau de ces projets ne reste. Archives/configurations privées conservées sous `.ci-output/math06`, hors Git. |

## Essais intermédiaires et limites conservés

Le premier lancement de préparation a retourné 1 avant création de services : l'environnement enfant Windows trop réduit empêchait Docker de trouver son plugin Compose (`unknown shorthand flag: 'p'`). Les répertoires système Windows requis ont été ajoutés à la liste autorisée. Un nouveau dossier/projet a ensuite été préparé ; aucun état existant n'a été écrasé.

Une première restauration réelle a réussi avec deux PNG (35 883 ms). La revue a ensuite trouvé l'oubli de WebP et durci la limite cumulée et l'attachement du manifeste/dump à la preuve. La campagne finale ci-dessus a été rejouée sur ces corrections ; les résultats historiques ne sont pas renommés en résultats du code final.

Un premier scénario de diagnostic utilisait arrêt/redémarrage LocalStack. Avec `PERSISTENCE=0`, cet arrêt efface les objets mémoire : la comparaison finale a échoué avec `NoSuchBucket`. Cette campagne n'est **pas** présentée comme une preuve de non-mutation. Sa pile fictive a été supprimée explicitement. La campagne finale utilise suspension/reprise de processus, laquelle rend le vrai service indisponible tout en conservant la fixture. Cela teste les délais/diagnostics, sans prétendre qu'un arrêt de LocalStack conserve les données.

Les tests HTTP ne sont pas des clics dans un navigateur. Les contrôles complets RLS/autorisation sont ceux du chantier HA-04 ; cette tâche réutilise ses migrations et le login réel. La procédure de capture requiert l'arrêt de tous les producteurs S3 : le double contrôle d'empreintes n'est pas une transaction distribuée. Aucun engagement RTO/RPO, aucune architecture de production et aucune archive de données réelles ne sont fournis.

**Encore attendus :** revue Hamza de la méthode de restauration des rôles/owners et des protections de chemins/ACL ; parcours navigateur humain avec Hugo ou un autre membre. Les cases Jira correspondantes restent ouvertes. Aucune réception humaine n'a été inventée.

## Données délibérément exclues du dépôt

Pas de `runtime.json`, dump, octets de reçus sauvegardés, fichier `.env`, mot de passe, cookie ou URL signée. Les JSON présents ici sont les résultats expurgés et les compteurs. La preuve de restauration identifie son manifeste par SHA-256 ; celui-ci et l'archive restent privés localement.

## Requalification du 25 octobre sur main actuel — macOS

La branche a intégré **main 888a74d** : EL-04 corrigé par Elyes, pagination obligatoire LE-11 et index LE-09. Sur **c48feff0a61c6ad51b09eac6abb5184aa691bae3**, la chaîne locale passe : **701 unitaires / 242 API / 29 E2E**, lint, typage, collecte, build et nettoyage. [Résultats, codes, durées et empreintes](current-main-macos.json). Ces chiffres ne réétiquettent pas les campagnes Windows antérieures.

Nouvelle capture et restauration réelles sous macOS arm64 / Node 24.22.1 / npm 11.19.1 : deux projets neufs, **3 comptes / 2 notes / 2 PNG**, toutes les empreintes concordent ; trois authentifications HTTP sous expense_web, pages/listes paginées et deux vrais reçus téléchargés. Diagnostic source/cible et nettoyage des deux seuls projets : code 0. Ces consultations sont HTTP ; les 29 E2E de la chaîne commune constituent une campagne distincte, pas des clics sur la cible restaurée.

Le corpus WebP et les contrôles négatifs réels restent ceux de Windows. Relecture Hamza et parcours humain Hugo toujours attendus. Le relevé publié utilise une liste explicite de champs ; il a été comparé à 11 valeurs privées et contrôlé contre les formats URL DB, cookies, URL signées et chemins de configuration : aucune occurrence. Aucun journal brut, archive ou fichier de configuration n'est publié.

## Qualification Windows et revue assistée du 26 octobre

[Restauration réelle](current-main-windows-20261026.json) et [comparaison des métadonnées de sécurité](security-parity-windows-20261026.json), code applicatif `349c77e4c2ceb8df83b428f85fd59e2be3e77244` (main `888a74d`, PR #27 et #33 intégrées localement). Aucun correctif de code n'a été nécessaire dans cette revue.

- Source créée par le guide MATH-03 et arrêtée avant capture ; 3 comptes / 2 notes / 2 PNG. Capture **2 364 ms**, restauration **45 169 ms** dans une nouvelle cible. Ces durées locales ne constituent pas un engagement de service.
- Comptages et empreintes de toutes les tables et des deux objets identiques. Vrai login `expense_web`, trois authentifications HTTP/pages/listes et deux reçus signés téléchargés et comparés. Les serveurs de vérification sont arrêtés.
- Comparaison supplémentaire source/restauration : propriétaires, ACL et indicateurs RLS des **14 tables** publiques (dont **13 protégées par RLS**), **44 policies**, propriétaires/ACL/définitions des **37 fonctions** publiques et attributs des **4 rôles expense_*** identiques. Aucun hash de mot de passe de rôle n'a été lu ni publié. Cette comparaison ne remplace pas les tests comportementaux d'autorisation HA-04/HA-09.
- Diagnostic source et cible réussi ; source relue après restauration, toutes ses empreintes et ses deux objets inchangés avant son nettoyage explicite. Seul le projet source a été retiré, pour libérer ses ports ; la cible restaurée a été conservée pour la campagne navigateur séparée.
- Revue des gardes : projet/labels/ports loopback, refus de cible existante, vérification des octets d'archive avant création, propriétaires et policies conservés par `pg_restore`, migration technique dans une base distincte et environnement serveur limité au login web. Aucun changement de privilège, policy, route ou dépendance.
- ACL Windows observées : compte utilisateur, SYSTEM et Administrateurs ; groupe local CodexSandboxUsers en lecture héritée dans le workspace. Les archives/configurations restent dans le répertoire ignoré, sous cette frontière locale de confiance. Ne pas présenter `mode:0600` comme une isolation ACL Windows ni publier ces fichiers.

La revue technique ci-dessus est assistée ; elle n'est pas signée au nom d'Hamza. Le parcours navigateur et l'acceptation métier ne sont pas déduits des consultations HTTP de cette campagne. Les preuves conservent le SHA testé, distinct de la version finale combinant aussi le frontend et les autres PR.
