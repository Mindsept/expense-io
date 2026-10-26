# ARLA-42 / MATH-04 — recette du candidat intégré

**État au 26 octobre 2026 : campagne finale technique réussie sur `e0125da`, 748 unitaires / 254 API / 42 E2E ; zoom natif à 200 % vérifié sur les trois écrans.** Hugo a ensuite répondu **« Je valide la réception »** : [décision PO-03 et périmètre accepté](po/reception-20261026.md). La répétition collective (PO-04) reste à réaliser. Les [règles PO-01](po/regles-et-contrats.md) sont également validées.

Le périmètre demandé par Hugo réunit les livrables restants des PR #17/#27/#30/#31/#32/#33, exclusivement dans le fork [Mindsept/expense-io](https://github.com/Mindsept/expense-io). Le correctif #30 est déjà inclus dans l'ascendance de #31. L'assistant a choisi le candidat dans cette autorisation ; aucun nouvel arbitrage de la liste des PR n'est attendu. Les résultats ci-dessous n'affirment ni publication ni fusion sur main.

## 1. Versions et résultats

| Campagne | Version et état de source | Résultat | Portée |
| --- | --- | --- | --- |
| Première campagne intégrée Windows | `f6592bcc53ddceb77038bccda43072355673a54c`, branche `codex/arla-final-integration`, checkout propre | **748 unitaires, 254 API, 42 E2E réussis ; 8 étapes à code 0** | [Métadonnées](evidence/MATH-04/windows-integrated-20261026/metadata.json), [résumé](evidence/MATH-04/windows-integrated-20261026/summary.json) |
| Parcours navigateur réel sur la cible restaurée | Application `f6592bc` ; données fictives de restauration, puis manipulations décrites au §3 | Soumission/reçu, approbation manager, recours RH et refus RH observés | Exécuté par l'assistant via le navigateur, sans interception réseau ; ce n'est pas une réception d'Hugo |
| Rejeu après correction de libellé RH | `ebef48dcff5a303f58578580359b5a01951e445a`, contient le correctif `8cb3208` | **748 unitaires et 254 API réussis ; 41 E2E réussis / 1 échoué** | EL-07 ligne 53 cherche encore la région avec l'ancien libellé. Assertion de focus conservée dans le correctif suivant. [Échec archivé](evidence/MATH-04/windows-label-failure-20261026/e2e.log), corrigé et rejoué dans la campagne suivante. |
| Campagne finale après correction EL-07 | `e0125dac546b55f535dcd7fd1c963610206c3c1f`, checkout propre au lancement | **748 unitaires, 254 API, 42/42 E2E dont 10/10 EL-07 ; 8 étapes à zéro** | [Métadonnées](evidence/MATH-04/windows-final-20261026/metadata.json), [résumé](evidence/MATH-04/windows-final-20261026/summary.json), [E2E](evidence/MATH-04/windows-final-20261026/e2e.log) |

La campagne finale s'est déroulée de 18:36 à 18:43 (Europe/Paris). Les commandes, durées et versions de cette campagne sont dans [la fiche structurée](evidence/MATH-04/final-campaign.json).

La première campagne s'est déroulée du **26 octobre à 16:53:02.3181606Z au 26 octobre à 17:00:17.2340926Z**, soit 17:53–18:00 en Europe/Paris (UTC+01:00). La durée de fenêtre est d'environ 7 min 15 s ; les durées de sous-commandes sont relevées séparément dans le résumé.

Environnement réellement consigné : Windows NT 10.0.26200.0, x64, Node 24.22.1, npm 11.19.1, Docker Engine 29.9.2, Compose 5.6.1. Projet jetable `arla-ci-086d9f19c2fb`. Les digests des images PostgreSQL et LocalStack sont conservés dans les métadonnées ; aucune URL privée de connexion n'est publiée.

Un changement de code, de migration, de dépendance ou de configuration impose de préciser les preuves concernées et de les rejouer. Une campagne antérieure conserve son SHA : elle n'est pas renommée comme preuve d'une version ultérieure.

## 2. Commandes, collecte et assertions exécutées

La commande d'entrée est `npm run test:ci`. Les textes npm ci-dessous sont les équivalents lisibles des invocations Node/npm du [runner](../tests/support/ci.mjs). Le projet Compose est celui des métadonnées. Aucun temps d'installation non relevé n'est ajouté.

| Étape | Commande du runner | Code | Durée première campagne | Preuve |
| --- | --- | --- | --- | --- |
| Vérification | `npm run verify` : lint, typecheck, unitaires | 0 | 63 477 ms | [verify.log](evidence/MATH-04/windows-integrated-20261026/verify.log) |
| Collecte | `npm run test:collect` | 0 | 7 572 ms | [collect.log](evidence/MATH-04/windows-integrated-20261026/collect.log) |
| Services | `docker compose -p arla-ci-086d9f19c2fb -f docker-compose.test.yml up -d --wait --wait-timeout 180` | 0 | 10 132 ms | [services.log](evidence/MATH-04/windows-integrated-20261026/services.log) |
| Préparation | `npm run test:prepare` | 0 | 4 710 ms | [prepare.log](evidence/MATH-04/windows-integrated-20261026/prepare.log) |
| Production | `npm run build` | 0 | 35 434 ms | [build.log](evidence/MATH-04/windows-integrated-20261026/build.log) |
| API | `npm run test:api` | 0 | 222 648 ms | [api.log](evidence/MATH-04/windows-integrated-20261026/api.log) |
| Navigateur | `npm run test:e2e` | 0 | 84 213 ms | [e2e.log](evidence/MATH-04/windows-integrated-20261026/e2e.log) |
| Nettoyage ciblé | `docker compose -p arla-ci-086d9f19c2fb -f docker-compose.test.yml down --volumes --remove-orphans` | 0 | 4 432 ms | [cleanup.log](evidence/MATH-04/windows-integrated-20261026/cleanup.log) |

La collecte a trouvé **53 fichiers unitaires** (Elyes, Hamza, Leandro, Mathis), **23 API** (Hamza, Leandro, Mathis) et **16 E2E** (les quatre auteurs). Elle n'exécute pas les assertions ; les résultats 748/254/42 viennent des journaux d'exécution. Les 42 E2E de l'équipe ont tous réussi dans cette campagne, sans échec ni test ignoré recensé. Aucun scénario enseignant séparé n'a été fourni : ce résultat ne certifie pas la conservation de tests absents.

| Exigence / tickets | Responsable des scénarios | Preuve exécutée et résultat | Limite |
| --- | --- | --- | --- |
| C1/C9 : collecte, build, isolation et nettoyage — ARLA-40/42 | Mathis | Les huit étapes ci-dessus passent ; propriétaires/niveaux dans le collecteur | Une collecte ou un build seuls ne démontrent pas les comportements métier |
| Cycle employé → décision → historique/reçu — HA-04, LE-01, ARLA-42 | Hamza, Leandro ; assemblage Mathis | API HA-04 réelle sous rôle limité, soumission navigateur LE-01 et smokes trois rôles réussis ; parcours réel §3 | Les smokes seuls ne prouvent que connexion/écran ; ne pas extrapoler le détail non observé d'une histoire complète |
| Rôle web réel, absence de contexte, droits courants — ARLA-13 | Hamza | HA-04 API et enrôlement navigateur réussis | Le serveur commun bootstrap reste privilégié ; seuls les scénarios dédiés démontrent les logins limités |
| Notifications et cinq tables ajoutées — ARLA-18 | Hamza | HA-09 API et navigateur réussis, dont le contrôle direct des cinq tables peuplées sans acteur/avec acteur étranger | Tous les couples mutation/colonne/rôle ne sont pas testés ; aucun email fournisseur réel n'est certifié |
| Panne ciblée et reprise — EL-01/04 | Elyes | Scénarios de réponse perdue, champs conservés, même clé de reprise et confirmation persistante réussis dans les 42 E2E | Routes interceptées dans ces tests : preuve d'UI, distincte de la persistance réelle |
| Compensation et idempotence DB/S3 — LE-02/03 | Leandro | Suites API réelles, registre sous login limité et rejeu HA-04 réussis | PostgreSQL et S3 ne deviennent pas une transaction distribuée |
| Seed relançable — ARLA-41 | Mathis | 11 scénarios API MATH-03 passent dans les 254 ; qualification [Windows MATH-03](evidence/MATH-03/windows-20261026.json) distincte | Reproduction autonome par un autre membre non attestée |
| Pagination, date civile, OCR, focus et réponse périmée — EL-02/03/05/06/07/08 | Elyes | Scénarios correspondants présents et réussis ; retour de focus aussi observé au clavier dans §3 | Largeur 320 CSS couverte automatiquement ; zoom natif 200 % observé séparément dans Chrome sur `e0125da` |
| OCR synchrone borné — LE-04/05/06 | Leandro | Parseur, bornes et erreurs dans les suites livrées ; aucun job durable ajouté | Pas de file OCR durable ni garantie de reconnaissance universelle |
| Performance — ARLA-43 / LE-09 | Mathis, Leandro | [Revue des bruts](po/revue-performance-20261026.md) : six groupes recalculés sans incohérence ; tests des outils exécutés par CI | Bench lourd non relancé sur ce candidat ; mesures 540/0 restent rattachées à `ad51a01`, aucune réception Leandro inventée |
| Sauvegarde/restauration — ARLA-44 | Mathis | [Cycle Windows](evidence/MATH-06/current-main-windows-20261026.json) et [parité](evidence/MATH-06/security-parity-windows-20261026.json), puis navigateur §3 | Cycle technique initial sur `349c77e` ; navigateur sur `f6592bc`. Ne pas fusionner les SHA en une preuve unique |

## 3. Parcours réel dans le navigateur

L'assistant a utilisé l'application de la cible restaurée, avec les comptes et justificatifs fictifs. **Aucune interception réseau n'a été utilisée pour ce parcours.** Le navigateur, l'API, PostgreSQL et le stockage ont été sollicités ; les étapes ci-dessous relatent les observations transmises par l'intégrateur, sans prétendre à une présence d'Hugo.

| Rôle / action | Observation | Version / réserve |
| --- | --- | --- |
| Employé : connexion puis vraie soumission de 18,75 avec PNG | Soumission effectuée ; ouverture du justificatif affichant l'image 16 × 16 ; circuit manager visible | Application `f6592bc` |
| Manager : connexion et approbation au clavier | Décision confirmée, retrait de la note de la liste et focus ramené au titre | Application `f6592bc` |
| RH : retirer le manager de l'employé | La note en attente apparaît dans le recours RH | Application `f6592bc` ; données fictives |
| RH : rétablir le manager | La note quitte le recours RH ; droits courants recalculés | Application `f6592bc` |
| RH : refuser au clavier une note de manager | Refus confirmé et focus ramené au titre | Application `f6592bc` |
| Retour employé après redémarrage sur `e0125da` | Note de 18,75 € approuvée ; décision Manager du 26 octobre à 18:07 UTC+1 conservée | [Capture et protocole à 200 %](evidence/EL-07-20261026/README.md) |

La visite a révélé un libellé RH trop restrictif (« managers racine »), alors que la liste autorisée inclut aussi les employés sans manager. Le correctif **`8cb32081df35ebdbea9dac62e2a928e5b08c68e8`** rectifie le texte et adapte des sélecteurs sans retirer les assertions. Le rejeu complet sur `ebef48d` a révélé un sélecteur résiduel EL-07 ligne 53 utilisant `/en attente, tableau défilant/` : région non trouvée par l'assertion de focus. Cet échec est archivé. `e0125da` cible les noms exacts des deux régions sans retirer les assertions ; la campagne finale 748/254/42 réussit.

Limites d'accessibilité : la navigation au clavier et le retour de focus ont été observés. Le lecteur d'écran facultatif n'a pas été exécuté. Le navigateur intégré n'avait pas appliqué le raccourci ; un contrôle natif Chrome à 200 % a ensuite réussi sur les trois écrans avec navigation au clavier, tableau employé défilant et restauration du rattachement de test. Voir [les captures et limites](evidence/EL-07-20261026/README.md). Les trois scénarios automatisés à 320 CSS pixels restent une preuve de petite largeur, pas une preuve de zoom ni de conformité WCAG globale.

## 4. Isolation et portée RLS

La [matrice des 13 tables](po/matrice-rls.md) relie chaque table aux assertions existantes. Les résultats API observés comprennent le login limité réel sans propriété, le circuit HTTP/replay/historique sous `expense_web`, le nettoyage du contexte après commit/rollback, les privilèges du worker et les refus d'escalade.

Le scénario HA-09 ajouté dans `e415113` peuple **les cinq tables de notifications** avant les refus : `decision_notification_outbox`, `decision_inbox`, `expense_notification_routes`, `assignment_notification_outbox`, `assignment_inbox`. Quatre lectures sans acteur/avec acteur étranger doivent renvoyer zéro ligne ; l'outbox d'attribution refuse avec `42501` car le web n'a aucun grant SELECT. Des lectures autorisées positives empêchent un refus global de faire réussir le test. Il passe dans les 254 API.

Cette preuve complète HA-04 pour les huit tables initiales. Elle ne démontre pas chaque mutation/colonne/combinaison de rôle. Le worker `expense_notifications` est autorisé à traiter les files de plusieurs entreprises dans son périmètre : un refus global interentreprises serait contraire à son contrat. Le serveur partagé bootstrap et les fixtures dédiées de logins limités restent distingués dans les rapports.

## 5. Historique et défauts corrigés

Les [anciens checks de branches](evidence/MATH-04/branch-checks.json), le [relevé actualisé](evidence/MATH-04/current-branch-checks.json) et le [relevé du 26 octobre](evidence/MATH-04/status-review-20261026.md) sont conservés. Leurs mentions de travail encore à faire décrivent leur date et leur SHA. Elles ne remplacent pas le présent résultat, et ne sont pas réécrites pour effacer les échecs précédents.

- Le défaut de réponse RH périmée est corrigé dans `f6592bc`, avec deux E2E de non-régression passant dans la première campagne.
- Le libellé RH est corrigé dans `8cb3208` ; sa campagne de confirmation reste distincte.
- Les anciens défauts du 22 octobre restent visibles dans le [registre](defauts-ouverts.md).
- La récupération de compte et la modification/annulation sont hors version conformément à PO-01. Le fournisseur réel d'envoi d'invitations demande une configuration privée ; les tests locaux ne certifient pas sa livraison.

Aucun test n'a été ignoré pour rendre la campagne verte. Toute nouvelle anomalie doit garder SHA, étapes, attendu/observé, propriétaire, impact et résultat de correction.

## 6. Reproduction et transfert

Depuis le même SHA dans le fork Mindsept, utiliser les versions épinglées et [le protocole CI](ci.md). Installation verrouillée et Chromium doivent être présents avant `npm run test:ci`. Sous Windows : `npm ci`, `npx playwright install chromium`, puis `npm run test:ci`. Ces commandes de reproduction ne sont pas ajoutées rétroactivement aux temps des huit étapes mesurées.

Le runner prépare des services jetables, n'utilise pas le `.env` personnel et nettoie son seul projet. Conserver source, état propre, versions, digests, codes, durées et journaux expurgés. La [fiche structurée](evidence/MATH-04/final-campaign.json) distingue campagne automatisée, parcours réel, références anciennes et réception humaine.

Les [captures de contrôle natif](evidence/EL-07-20261026/README.md) sont rattachées à `e0125da`. Une capture prouve un écran à un instant ; elle ne remplace pas les assertions. Ne publier ni secret, cookie, URL signée ni donnée personnelle.

**Script oral, environ 60 secondes :**

> Le candidat réunit les livrables autorisés dans le fork Mindsept. La campagne finale Windows a réussi ses huit étapes : 748 tests unitaires, 254 API et 42 E2E. Le navigateur réel a permis de soumettre une note, ouvrir son reçu, approuver au clavier et vérifier le recours RH après changement de manager. Cette visite a aussi révélé un libellé RH corrigé, dont nous conservons le rejeu séparément. Les preuves de rôle limité viennent des fixtures HA-04 et HA-09, pas du serveur bootstrap. Les pannes simulées d'interface restent distinctes des tests SQL/S3. Les règles et la réception produit sont validées par Hugo ; la répétition collective reste à faire.

## 7. Réception et transfert humain

- [x] Première campagne rattachée à son SHA, ses assertions, commandes, durées et journaux.
- [x] Collecte des propriétaires et niveaux vérifiée ; 42/42 E2E de l'équipe réussis.
- [x] Trois rôles et parcours réel décrits, avec les limites d'observation.
- [x] Véritables logins limités et contrôle des cinq tables de notifications exécutés ; portée non exhaustive explicitée.
- [x] Panne ciblée et reprise des tests Elyes réussies ; persistance réelle prouvée séparément.
- [x] Rejeu complet sur `e0125da` : 42/42 E2E ; zoom natif 200 % et retour employé après redémarrage observés.
- [x] Hugo accepte la livraison et ses limites par « Je valide la réception » : [décision PO-03](po/reception-20261026.md). Les tests et parcours exécutés par Codex restent attribués à Codex.
- [ ] Un autre membre reproduit le protocole et consigne son résultat.
- [ ] L'équipe répète la soutenance et l'exercice assisté (PO-04).

Aucun scénario enseignant séparé ni test lecteur d'écran non exécuté n'est marqué réussi. Les sources du cours et la préparation de soutenance sont reliées dans [PO-02](po/audit-et-preuves.md) et [PO-04](po/soutenance.md).
