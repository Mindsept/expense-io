# Recette frontend — EL-08 / ARLA-38

Cette recette réunit les preuves EL-01 à EL-07 sans modifier leurs contrats
serveur. Le dépôt est **Mindsept/expense-io**. Les scénarios de panne utilisent
des réponses HTTP contrôlées dans Chromium ; la connexion utilise les comptes
fictifs du serveur local. Une simulation d'API ne prouve ni PostgreSQL, ni S3,
ni l'idempotence serveur, ni les refus d'accès entre entreprises.

## Relancer depuis une copie installée

Utiliser les versions Node/npm déclarées dans `package.json` et le lockfile,
Docker opérationnel et Chromium installé par Playwright. Aucun compte réel,
fichier `.env` de développement ou reçu personnel n'est nécessaire.

```sh
npm ci
npx playwright install chromium
npm run test:ci
```

La dernière commande appartient au socle MATH-02 : configuration éphémère,
projet Compose distinct, base `_test`, bucket `-test`, refus des ports occupés,
préparation des trois comptes, build, suites API/navigateur puis nettoyage des
seules ressources de cette campagne. Voir [CI](../ci.md). Elle conserve les
résultats expurgés dans `.ci-output/`. Les mots de passe sont générés à chaque
campagne et ne sont pas publiés dans cette recette.

Pour une démo déjà démarrée avec la configuration privée MATH-03, conserver
ses variables explicites `ARLA_TEST_ENV`, `ARLA_TEST_BASE_URL` et les trois
paires `ARLA_TEST_<ROLE>_EMAIL/PASSWORD`. Ne pas deviner un mot de passe ou
remplacer cette cible par le port de développement 3000.

```sh
npm run test:e2e -- tests/e2e/elyes --list
npm run test:unit -- tests/unit/elyes
npm run test:e2e -- tests/e2e/elyes
npm run lint
npm run typecheck
```

Dans la campagne complète, `test:collect` vérifie les fichiers réellement
découverts et les propriétaires avec toutes les variables API/DB/S3 de MATH-02.
La collecte ciblée ci-dessus ne nécessite que les variables de la démo UI.
Une collecte réussie ne signifie pas que les tests ont été exécutés. Il n'y a
pas de suite API Elyes artificielle : les assertions serveur restent chez
Hamza et Leandro. Aucun second runner ni nouvelle dépendance n'est ajouté.

## Matrice de reproduction

Les chemins ci-dessous sont relatifs à `tests/`. Les titres de tests décrivent
les assertions attendues ; le résultat observé doit venir d'une campagne datée
et identifiée, pas de la simple présence d'un fichier.

| Ticket | Action et résultat attendu | Preuve exécutable | Portée |
| --- | --- | --- | --- |
| EL-01 / ARLA-31 | Soumission interrompue : champs et reçu conservés, aucune nouvelle tentative automatique ; après 201 et GET échoué, succès conservé, historique récupérable | `e2e/elyes/EL-01/network-errors.spec.ts` | UI contrôlée ; connexion réelle |
| EL-01 | Décision manager 409 : ligne conservée jusqu'à l'actualisation explicite ; erreur RH d'annuaire indépendante des notes | Même fichier, scénarios manager et RH | UI contrôlée |
| EL-02 / ARLA-32 | Dates civiles valides/invalides et même date à Paris/New York | `unit/elyes/EL-02/civil-date.test.ts`, `e2e/elyes/EL-02/civil-dates.spec.ts` | Calcul pur + deux fuseaux Chromium |
| EL-03 / ARLA-33 | OCR B finit avant A ; A n'écrase ni B ni une saisie manuelle | `e2e/elyes/EL-03/ocr-suggestions.spec.ts` | Promesses contrôlées, aucun appel réel à l'OCR |
| EL-04 / ARLA-34 | Reprise explicite avec même clé/contenu/reçu ; formulaire changé ou page rechargée ne crée pas silencieusement une nouvelle intention | `e2e/elyes/EL-04/submission-intent.spec.ts` | UI ; le serveur est testé par LE-03 |
| EL-05 / ARLA-35 | Pagination et totaux serveur ; manager RH accessible au-delà de la page courante | `e2e/elyes/EL-05/pagination.spec.ts`, `unit/elyes/EL-05/pagination.test.ts` | UI + parseur de contrat |
| EL-06 / ARLA-36 | Auteur, circuit et historique de décision explicites | `e2e/elyes/EL-06/workflow-visibility.spec.ts` | UI ; droits serveur hors mock |
| EL-07 / ARLA-37 | Actions contextualisées, labels, chargement/erreur, focus, clavier et petite largeur | `e2e/elyes/EL-07/accessibility.spec.ts` | Scénarios ciblés, pas certification globale |
| EL-08 / ARLA-38 | Au clavier : page 2 puis page 1, soumission incertaine, reprise avec même clé, 201 suivi d'un GET500, récupération de l'historique et pagination mise à jour sans POST supplémentaire | `e2e/elyes/EL-08/integrated-flows.spec.ts` | Intégration des comportements UI EL-01/04/05/07 |

La décision PO et [l'ADR LE-06](../adr/LE-06-bounded-ocr.md) retiennent un OCR
synchrone borné, facultatif, avec saisie manuelle. Il n'existe donc pas de
scénario de suivi d'un job OCR durable à ajouter à cette recette.

## Démonstration reproductible sans lire le code

Sur la démo isolée, ouvrir l'URL affichée par MATH-03 et se connecter avec son
compte fictif employé. Utiliser uniquement le reçu de test fourni.

1. Pour observer la panne et la reprise contrôlées, exécuter
   `npm run test:e2e -- tests/e2e/elyes/EL-08/integrated-flows.spec.ts --headed`.
   Le navigateur montre successivement la pagination, les champs conservés,
   le succès de soumission malgré l'erreur d'historique, puis sa récupération.
2. Pour la date, exécuter
   `npm run test:e2e -- tests/e2e/elyes/EL-02/civil-dates.spec.ts --headed`.
   Les contextes Paris et New York doivent afficher la même date civile.
3. Elyes refait personnellement une panne et une date ; Leandro relit les
   assertions et leur capacité à détecter le défaut. Hugo peut ensuite suivre
   le scénario. Ces validations humaines restent à renseigner par leur auteur.

Ne pas couper le réseau de toute la machine. Les interceptions se limitent aux
requêtes utiles dans le contexte navigateur de chaque test.

## Résultats et limites

Campagnes du 25/10/2026 sous Windows, Node **24.22.1**, npm **11.19.1**,
Docker Desktop **4.96.3**, moteur **29.9.2**, fuseau **Europe/Paris**. Le
dossier [EL-08](../evidence/EL-08/README.md) conserve les étapes rouges et le
passage positif séparément. Chaque ligne ci-dessous provient d'une exécution
de `npm run test:ci`, avec préparation et nettoyage des services jetables.

| Campagne | Résultat observé | Interprétation et preuve |
| --- | --- | --- |
| Application complète avant correction de l'en-tête | **37/40 E2E passent**, 3 échouent ; étape E2E code 1, nettoyage code 0 | Les trois cas EL-07 à petite largeur détectent le débordement de l'en-tête partagé, absent de l'aperçu des composants. [Résumé](../evidence/EL-08/windows-initial/summary.json), [échecs conservés](../evidence/EL-08/windows-initial/e2e.log). |
| Contrôle négatif volontaire, après correction de l'en-tête | **38/40 E2E passent**, 2 échouent exactement sur l'égalité de la clé de reprise EL-04 et EL-08 ; étape E2E code 1, nettoyage code 0 | Une nouvelle clé était temporairement générée à la reprise. Les tests atteignent l'assertion métier attendue ; ni erreur d'import ni absence de tests. [Résumé](../evidence/EL-08/negative-control/summary.json), [assertions rouges](../evidence/EL-08/negative-control/e2e.log), [portée de la mutation](../evidence/EL-08/negative-control/metadata.json). |
| Source restaurée, application complète | **673 unitaires, 239 API et 40/40 E2E passent**, sortie globale 0 et nettoyage code 0 ; E2E affichés en **41,7 s** | Source `02ec22e2392eb92458b63089da683da59dc1560e`. Les 28 scénarios Elyes passent, dont les 10 EL-07 et le scénario EL-08. [Résumé](../evidence/EL-08/windows-positive/summary.json), [E2E](../evidence/EL-08/windows-positive/e2e.log), [métadonnées et autres rapports](../evidence/EL-08/README.md). |

La correction `02ec22e` permet le retour à la ligne du conteneur d'en-tête et
de sa navigation, avec une largeur bornée. La mutation négative a ensuite été
retirée et le fichier restauré octet pour octet avant la campagne positive ;
aucune mutation n'est committée. Le checkout ne présentait alors aucun écart
applicatif ou de tests, seulement le dossier non suivi des preuves négatives.
Le contrôle négatif prouve la détection de cette régression précise, pas celle
de tous les défauts possibles.

La [collecte positive](../evidence/EL-08/windows-positive/collect.log) retrouve
45 fichiers unitaires (quatre propriétaires), 21 fichiers API (Hamza, Leandro,
Mathis) et 15 fichiers E2E (quatre propriétaires). Ces nombres de fichiers sont
distincts des nombres de cas exécutés. Lint et typage passent ; l'unique
avertissement lint HA-09 préexistant reste visible dans
[verify.log](../evidence/EL-08/windows-positive/verify.log).

La [CI GitHub 40205740218](https://github.com/Mindsept/expense-io/actions/runs/40205740218)
est également terminée avec `success` sur **le même SHA `02ec22e`**. Son statut
public a été relu ; les comptes de tests ci-dessus sont ceux de la campagne
Windows locale, sans les attribuer aux journaux distants non recopiés.

Le serveur commun reste la baseline bootstrap privilégiée ; les suites
HA-04/HA-09 ont leurs fixtures de véritables rôles limités. La réussite globale
ne démontre pas à elle seule une isolation exhaustive. Les cas Elyes utilisent
une connexion Auth.js réelle et des réponses métier contrôlées ; ils ne
remplacent pas les preuves PostgreSQL/S3 des auteurs serveur. La recette finale
MATH-04 sur le SHA de remise, la répétition personnelle d'Elyes, la relecture
Leandro, le lecteur d'écran et le zoom navigateur natif à 200 % restent séparés.

## Trame orale de 90 secondes

« Une panne pouvait perdre la confiance dans une soumission. Le formulaire
conserve maintenant les champs et la même intention de reprise. Je montre
l'erreur, la reprise, puis le test qui exige la même clé et interdit un POST
supplémentaire. Le succès reste affiché même si l'historique ne se recharge
pas immédiatement. La pagination utilise les totaux du serveur. Les dates
sont vérifiées dans deux fuseaux et l'OCR tardif ne remplace pas une saisie.
Ces tests rendent les comportements de l'interface reproductibles ; les
tests serveur, la restauration et la revue humaine apportent les preuves
complémentaires. »

## Complément du 26 octobre 2026 — blocage levé

Le sélecteur RH résiduel est corrigé dans `e0125dac546b55f535dcd7fd1c963610206c3c1f` sans retirer
l'assertion de focus. La campagne complète sur ce code passe : **748 unitaires,
254 API, 42 E2E, dont 10 EL-07**. Le [contrôle natif Chrome à 200 %](../evidence/EL-07-20261026/README.md)
a été réalisé sur employé, manager et RH, avec captures, navigation clavier,
défilement du tableau employé et contrôle de l'historique persisté. Cette preuve
complète les passages historiques ci-dessus ; lecteur d'écran et certification
globale ne sont pas revendiqués. L'acceptation personnelle ARLA-8 reste distincte.
