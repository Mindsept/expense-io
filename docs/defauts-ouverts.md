# Défauts et dépendances encore ouverts — constat du 22 octobre 2026

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

