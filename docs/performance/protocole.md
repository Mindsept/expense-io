# MATH-05 / ARLA-43 — référence avant optimisation

Responsable : Mathis. Relecture : Leandro. Proposition validée par Mathis ; réception/relecture Leandro attendues. Dossier destiné à LE-09 puis MATH-04. Aucun index, route ou algorithme OCR modifié. Cette référence ne dépend pas de la réalisation de LE-09.

## Questions et hypothèses

1. Combien coûtent les listes employé quand le volume croît ? Hypothèse : les lignes renvoyées, leur sérialisation et leur transfert augmentent le coût ; la route actuelle ne pagine pas.
2. Combien coûtent les files manager/RH ? Mesurer HTTP et les SELECT exacts avant de décider d’un index. Un temps HTTP inclut davantage que PostgreSQL.
3. Quel est le coût d’un vrai OCR français ? Séparer initialisation du worker, reconnaissance de pixels et parsing du texte. Le worker de la route applicative est créé pour chaque requête ; le worker réutilisé du diagnostic ne représente pas son comportement en production.

## Jeu déterministe et cible protégée

`math05-v2-main-seed-20261022` : une entreprise de benchmark, trois utilisateurs fictifs (employé, manager racine, RH), **1 000 ou 10 000 notes**. Les deux utilisateurs auteurs possèdent chacun la moitié des notes. Statuts : 70 % pending, 20 % approved, 10 % rejected. Les files contiennent respectivement 40 % du volume pour le manager et 30 % pour les RH. Montants calculés par formule fixe `100 + (i × 7919) modulo 99000` centimes ; dates et horodatages partent du 1er janvier 2026. La somme de contrôle des caractéristiques, hors UUID et identifiants aléatoires, doit être identique à chaque régénération. [Régénération indépendante de 1 000 notes vérifiée](results/reproducibility.json).

Le seed MATH-02 ajoute une entreprise, trois comptes et deux notes distincts : total DB 1 002 / 10 002 notes, deux entreprises et six comptes. Ces deux notes ne font pas partie des listes mesurées. Les lignes de benchmark ne créent **aucun reçu S3** ; leur clé est un marqueur sans objet et le parcours « voir le reçu » ne fait pas partie de cette mesure. Le corpus OCR est celui de Leandro, huit PNG synthétiques versionnés, licence CC0-1.0 et vérités terrain dans [son README](../../tests/fixtures/leandro/LE-04/README.md). Les tailles et empreintes réelles sont enregistrées par image.

Le script appelle le **précontrôle MATH-02 intégré dans main**, son Compose et sa fonction de préparation, sans les modifier. Projet aléatoire `arla-ci-bench-<id>`, DB `expense_io_test` sur 127.0.0.1:55440 et bucket `receipts-ci-test` sur :45740, serveur production sur :3210 ; ports réservés contrôlés avant démarrage. Une URL externe/de développement est refusée avant écriture ; socket Docker Unix local exigé, labels de propriété vérifiés avant nettoyage. Les secrets restent dans `.ci-output/benchmark/`, déjà ignoré ; aucun `.env` de développement chargé ou écrit. `bench:run` arrête son serveur et retire seulement sa stack, même après un échec ; `bench:down` permet la reprise après préparation interrompue. Si le précontrôle refuse la configuration, il refuse aussi le nettoyage.

## Exécution et conditions

```sh
# Node 24.22.1 / npm 11.19.1, Docker local et dépendances verrouillées
npm ci
npm run bench:prepare -- 1000
npm run bench:run
npm run bench:prepare -- 10000
npm run bench:run
# Reprise uniquement si une préparation est interrompue :
npm run bench:down
```

Chaque préparation exige une cible vierge, applique migrations/seed et construit la production ; statistiques rafraîchies uniquement sur les deux tables de test avec ANALYZE, aucun index ajouté. Les trois routes et les requêtes SELECT sont relevées dans le script et les plans ; Leandro doit les réaligner si ses routes changent.

Trois passages séquentiels par route ; 30 requêtes par passage ; concurrence maximale **4**, pas de retry. Chaque route reçoit trois requêtes d’échauffement conservées séparément. Pas de pagination, filtre ou tri ajouté : paramètres par défaut des routes actuelles. Temps jusqu’à réception complète et décodage de la réponse, taille, statut et erreur enregistrés par tentative ; timeout HTTP 10 s. Le débit est celui d’une charge fermée et locale ; il ne simule pas des arrivées indépendantes de production. Les caches OS/DB ne sont pas vidés. La concurrence DB du client de plans est 1 ; celle du serveur est celle du dépôt (pool max 20). Les listes sont mesurées dans l’ordre employé, manager, RH : un effet d’ordre reste possible.

Un diagnostic anonyme provoque **401** et reste dans `http.json` et `summary.diagnostic` avec une erreur sur une tentative. Il est séparé des listes authentifiées, où une réponse non 200, un mauvais volume ou un timeout reste dans le dénominateur et fait échouer la commande. Trois tests unitaires vérifient dénominateur, cas vide et quantile. Le p95 présenté est le rang empirique `ceil(0,95×n)`, affiché à partir de 30 observations ; ce seuil n’en fait pas une estimation fiable de la production. Les médianes par passage montrent le bruit au lieu de masquer la dispersion.

Neuf plans `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` par volume : trois SELECT, trois passages. Le contexte utilisateur est posé dans une transaction, puis rollback ; aucune mutation expliquée. Le rôle réellement observé est **expense_test, superutilisateur et BYPASSRLS**. Ce relevé ne prédit pas le coût des futures policies/rôle limité de HA-04.

OCR hors serveur : trois workers réellement créés, langue française locale, huit PNG reconnus dans chaque worker. Initialisation chronométrée séparément ; première reconnaissance et reconnaissances avec worker réutilisé distinguées. Résultats du parseur existant comparés aux vérités terrain et au parsing des textes sources ; texte réellement reconnu conservé. Temps CPU et maximum RSS du processus de diagnostic sont enregistrés : ils incluent ses contextes HTTP et ses workers Tesseract, **pas** PostgreSQL ni tout le serveur. Ce corpus imprimé proprement ne représente pas les photos de reçus ; aucune précision populationnelle ni p95 OCR annoncé.

Délais : opérations OCR bornées à 30 s, préparation enfant à 240 s, Docker à 180 s, campagne à 8 min avec arrêt forcé après 10 s supplémentaires. Un résultat partiel reste marqué failed dans `outcome.json` ; vérifier aussi le code de sortie et le nettoyage. SHA, état du dossier, empreintes du code/lock, Node/npm, DB, OS/CPU/mémoire disponible et charge sont dans chaque `conditions.json`. Le poste n’était pas exclusif (Colima, navigateur et aperçu des slides) ; aucune capacité de production n’en est déduite.

## Comparaison confiée à LE-09

Rejouer sur le SHA après correctif en conservant volumes, géométrie, concurrence, runtime, OS et caches comparables. Conserver les résultats avant dans un dossier de référence et publier les nouveaux SHA/conditions. Comparer les médianes des trois passages et les plans/buffers, pas uniquement le meilleur temps. Si les plages par passage se recouvrent et que l’écart reste dans la variabilité observée, conclure **non concluant** ; répéter sous conditions maîtrisées avant d’annoncer un gain. Toute modification de pagination, rôle RLS, payload ou corpus exige une comparaison séparée et déclarée. MATH-04 reprend ensuite ces preuves sur sa version finale.
