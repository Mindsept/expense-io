# Défauts, limites et historique

## État courant — 26 octobre 2026

La base publiée `888a74ddae9db28378596adc7709358798986e49` intègre HA-04/RLS, HA-09/notifications, LE-01/02/03, pagination LE-07/EL-05/LE-11, index LE-09, MATH-02 et les mises à jour MATH-07. **Les blocages d'intégration décrits le 22 octobre ci-dessous ne sont plus l'état courant.** Leurs constats restent conservés comme historique.

À la demande d'Hugo du 26 octobre de terminer les tickets, l'assistant prépare le candidat qui réunit les livrables des PR #17/#27/#30/#31/#32/#33 dans le fork Mindsept. Le correctif #30 est également présent dans l'ascendance de #31 : ne pas le dupliquer. L'intégrateur choisit et fige le SHA de test dans ce périmètre autorisé ; il n'est pas nécessaire d'attendre un second arbitrage du lot de PR par Hugo. Cette intégration locale n'est pas une déclaration de fusion sur main ni une recette finale réussie.

| Sujet restant au point documentaire | Action / preuve à rattacher |
| --- | --- |
| Compléments PO-01 | Réponse produit sur dates futures, formats/total, récupération/édition/annulation et TTL d'invitation. [Règles et propositions séparées](po/regles-et-contrats.md). |
| Campagne finale MATH-04 | Figer le candidat après corrections, exécuter les suites et parcours, consigner SHA, environnement et limites dans [final-campaign.json](evidence/MATH-04/final-campaign.json). |
| Portée RLS | [Matrice des assertions](po/matrice-rls.md) : distinguer contrôles structurels et refus réels par table ; toute assertion ajoutée doit être exécutée avant d'annoncer son résultat. |
| Seed / restauration | Rattacher la qualification Windows et le parcours de la cible restaurée ; ne pas présenter une CI Linux comme preuve Windows ou comme réception utilisateur. |
| Accessibilité / recette produit | Consigner les contrôles navigateur réalisables ; une approbation personnelle d'Hugo et une certification globale ne sont pas déduites des tests. |
| Performance | [Nouvelle référence et revue des bruts](po/revue-performance-20261026.md), sans gain calculé contre l'ancien protocole ni approbation nominative inventée. |
| Soutenance | [Déroulé et exercice préparés](po/soutenance.md) ; répétition collective et capacité de chacun à expliquer restent à observer. |
| E2E enseignants séparés | Référence non fournie ; conservation de leurs parcours non certifiable en leur absence. |

Les fonctionnalités hors version proposées dans PO-01 restent visibles dans le backlog produit, sans faux livrable. Aucune anomalie technique nouvelle n'est créée uniquement parce qu'une preuve est encore à produire. Tout échec réel doit garder étapes, attendu/observé, SHA, propriétaire et résultat de correction.

## Historique — constat du 22 octobre 2026

Ce registre ne remplace ni les tickets des auteurs ni leurs preuves. Le statut
« ouvert » signifie que la correction n'est pas intégrée et validée dans la
référence locale de MATH-01, basée sur `9adbd6e`. Les tests verts de MATH-01
ne constituent pas une résolution de ces sujets.

| Ticket / responsable | Constat vérifiable | Conséquence et condition de reprise |
| --- | --- | --- |
| ARLA-13 / HA-04 — Hamza | PR #8 en brouillon ; le rôle `expense_test` de la campagne a `rolsuper=true`, `rolbypassrls=true`. | Aucune preuve RLS revendiquée. MATH-03/06 attendent le contrat de rôles/schéma ; la recette finale attend les vrais parcours sous rôle limité. |
| ARLA-41 / MATH-03 — Mathis | `scripts/seed.mjs` réécrit rôle, entreprise, nom et manager d'un compte existant ; il abandonne une note existante sans vérifier son reçu et affiche les mots de passe. | Le seed n'est utilisé ici que sur une base neuve jetable ; logs expurgés. Reprise sûre et séparation initialisation/réparation à implémenter après validation du ticket. |
| ARLA-44 / MATH-06 — Mathis | Le Compose de développement publie 5433/4567 sans adresse loopback ; diagnostic et restauration DB+S3 non livrés. | La campagne MATH-01 a sa propre publication loopback. Le Compose principal reste à traiter dans son ticket après coordination HA-04. |
| ARLA-45 / MATH-07 — Mathis, qualification Hamza | Les versions de `package.json` restent celles d'avant les correctifs prescrits dans `docs/security/HA-08/README.md`. | Revalider les versions/avis, puis appliquer les mises à jour ciblées après MATH-02. L'exception braces et la dette ESLint restent explicites. |
| ARLA-40 / MATH-02 — Mathis | La stack, les garde-cibles, la chaîne de production et GitHub Actions sont maintenant implémentés dans `fix general`. | Voir [le protocole CI](ci.md) et les runs de la PR ; le rôle limité et la preuve RLS restent à HA-04. |
| ARLA-19 / LE-01 — Leandro | Le GET personnel de la référence interpole encore le paramètre de tri ; la PR #12 est en brouillon. | Ne pas exposer ce serveur jetable hors loopback ; correction et preuves restent au propriétaire, sans modification métier dans MATH-01. |
| LE-02 — Leandro | Le POST insère la note, uploade S3 puis enregistre la clé hors transaction globale ; pas de reprise DB/S3 prouvée ici. | Les tests de connexion ne certifient ni atomicité DB/S3 ni reprise après panne. Le contrat de stockage final est nécessaire à la réparation du seed. |
| ARLA-42 / MATH-04 — Mathis | La campagne finale du SHA retenu, la matrice RLS et la panne/reprise navigateur d'Elyes ne sont pas exécutées dans MATH-01. | Réutiliser les preuves des auteurs après intégration. Chaque scénario absent restera « non exécuté ». |

Sources : descriptions Jira ARLA-39 à 45, fichiers cités sur la référence,
[PR #8](https://github.com/Mindsept/expense-io/pull/8),
[PR #12](https://github.com/Mindsept/expense-io/pull/12).


## Suivi complémentaire Mathis — 22 octobre 2026

- MATH-02 : la version intégrée via #14 reste la référence. La PR parallèle #15 est fermée comme remplacée ; ARLA-45 et ARLA-43 conservent les corrections de main.
- Portabilité macOS du test Hamza `tests/unit/hamza/HA-01/owned-node-process.test.ts` : `kill EPERM` dans le helper commun intégré. Reproduction locale sur Node 24.22.1 : 278 succès/1 échec ; Linux intégré : 279/279. Aucun changement du test tiers, pas de contournement. Voir [preuves ARLA-45](evidence/MATH-07-validation.md).
- Dépendances : correctifs intégrés dans la branche ARLA-45 ; audit production zéro alerte. Avis braces `GHSA-vfj7-8cjw-p6xm` toujours ouvert (développement), exception non acceptée, revue proposée 28 octobre 2026 ; ESLint 9 hors support reste une dette séparée. Requalification/OS de livraison à Hamza et acceptation à Hugo.
- MATH-03/06 : contrats HA-04 et validation de l’approche encore nécessaires. MATH-04 : campagne finale non exécutée sur le SHA de remise ; les campagnes de branches ne la remplacent pas.
