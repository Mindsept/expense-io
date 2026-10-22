# LE-10 — Contrat HTTP livré

Le fichier [expense-io.v1.json](expense-io.v1.json) décrit les réponses réellement
livrées sur `main` **b6bf206**, après HA-02 et HA-03 (22 octobre 2026). Version du contrat :
**1.0.0**, format [OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3).
Ce contrat initial est publiable indépendamment des autres refontes.

Les requêtes utilisent l'origine de l'application. L'authentification est la
session opaque Auth.js obtenue par CSRF puis Credentials avec le même cookie jar,
jamais un jeton Bearer inventé. Auth.js gère les cookies HTTP/HTTPS, leur éventuel
fractionnement, les redirections et ses propres erreurs. Le catch-all est
inventorié comme délégation ; les intégrations JSON `csrf`, `session` et le
callback Credentials sont décrites séparément. Les server actions inscription,
connexion et déconnexion ne sont pas des routes métier REST supplémentaires.
Aucun cookie, mot de passe ou reçu réel ne figure dans les exemples.

## Inventaire courant

Chaque opération porte `x-source`. Le test d'inventaire confronte ces chemins et
les méthodes exportées aux **15 fichiers** `src/app/api/**/route.ts`.

| Fichier sous `src/app/api/` | Méthodes | Comportement livré |
| --- | --- | --- |
| `auth/[...nextauth]/route.ts` | GET, POST | Délégation Auth.js ; pas d'enveloppe HA-07 |
| `expense-notes/route.ts` | GET, POST | Notes propres, tableau sans pagination ; création multipart 201 |
| `expense-notes/receipt-suggestion/route.ts` | POST | OCR français synchrone, suggestions facultatives, `{}` possible |
| `expense-notes/[id]/receipt-url/route.ts` | GET | Reçu du propriétaire actif, même après décision |
| `expense-notes/[id]/history/route.ts` | GET | Historique pour propriétaire/valideur courant, événements ordonnés, `{items: []}` possible |
| `manager/expense-notes/route.ts` | GET | Notes en attente des subordonnés directs éligibles, ordre croissant |
| `manager/expense-notes/[id]/approve/route.ts` | POST | Approbation d'une note en attente |
| `manager/expense-notes/[id]/reject/route.ts` | POST | Rejet d'une note en attente, sans motif dans le corps |
| `manager/expense-notes/[id]/receipt-url/route.ts` | GET | Même périmètre d'éligibilité manager |
| `hr/expense-notes/route.ts` | GET | Notes en attente du périmètre RH, ordre croissant |
| `hr/expense-notes/[id]/approve/route.ts` | POST | Approbation du périmètre RH |
| `hr/expense-notes/[id]/reject/route.ts` | POST | Rejet du périmètre RH |
| `hr/expense-notes/[id]/receipt-url/route.ts` | GET | Reçu du périmètre RH |
| `hr/users/route.ts` | GET | Employés/managers de l'entreprise, comptes inactifs inclus, tri par nom |
| `hr/users/[id]/manager/route.ts` | PUT | `managerId` UUID ou `null` explicite ; autres champs ignorés |

HA-02 recharge les droits courants ; un compte supprimé/inactif perd sa session.
Le manager actif voit uniquement un auteur non RH de son entreprise qui lui est
actuellement rattaché, sans auto-validation. Les RH actifs peuvent traiter une
note d'un autre RH de l'entreprise, ou d'un auteur non RH sans manager actif et
éligible de cette entreprise ; ils ne peuvent pas traiter leur propre note.
Les notes d'auteurs inactifs restent traitables. Voir le contrat détaillé
[HA-02](../authz-current-actor.md). L'éligibilité RH ne choisit pas un destinataire
parmi plusieurs RH pour les notifications.

## Représentations et erreurs

`amount` est un **nombre JSON** positif ; `expenseDate` une date civile réelle
`YYYY-MM-DD`, sans conversion de fuseau ; les identifiants sont des UUID et
`createdAt` un instant ISO. Les requêtes actuelles n'émettent pas `author` ou
`decidedAt` : ces extensions facultatives du [DTO partagé](../contracts/expense-note.md)
seront documentées avec leur intégration. Les schémas de réponses métier ferment
les propriétés pour détecter une fuite accidentelle de colonnes privées.

Les douze handlers migrés HA-07 émettent un `X-Request-Id` sur succès et erreur.
Les erreurs ont le type média `application/problem+json`, `Cache-Control: no-store`,
un statut cohérent et le schéma partagé `type/title/status/detail/error/requestId`.
L'extension temporaire `error` égale `detail`. Les textes/codes statiques sont
vérifiés ; une exception SQL, une URL signée ou une donnée soumise ne peut pas se
substituer au détail. Voir [HA-07](../api-errors.md).

- **401** : identité absente, supprimée ou inactive.
- **403** : rôle courant incompatible avec une opération manager/RH.
- **404** : ressource absente ou invisible, auto-validation, ou clé de reçu vide.
  Le corps ne distingue pas ces cas. Une URL signée est valable par défaut
  300 secondes ; la présignature ne vérifie pas l'existence de l'objet S3.
- **409** : note déjà décidée, manager invalide ou affectation occupée par une
  autre transaction. Aucun retry automatique n'est promis.
- **400** : JSON/affectation invalide ; pour les deux fichiers personnels encore
  anciens, les validations précoces restent `{error: string}` en JSON normal.
- **500** : échec technique assaini. Un UUID de chemin malformé atteint encore
  PostgreSQL : ne pas promettre un 400 qui n'existe pas.

Les GET/POST personnels et le POST OCR retournent encore des erreurs précoces
`{error: string}` sans corrélation garantie. Leurs erreurs attrapées passent par
`respondError` et utilisent Problem Details. Les extensions `x-error-contract`
matérialisent cette transition ; aucun `oneOf` permissif ne masque la différence
entre les réponses effectivement attendues pour une opération/statut.

Le tri personnel utilise encore un fragment SQL libre. Le seul exemple conseillé
est `sort=created_at%20DESC` ; l'allowlist et le refus des tris invalides sont LE-01
(PR #12), encore non intégrés à cette version. Ne pas présenter cette faiblesse
comme un contrat sûr pour une valeur fournie par un utilisateur. Le multipart de
création accepte les MIME déclarés PNG/JPEG/WebP/PDF jusqu'à 10 MiB ; l'inspection
structurelle, les bornes strictes et le refus des fichiers vides relèvent de LE-01.
La séquence PostgreSQL/S3 actuelle peut laisser une note avec une clé vide après
un échec : LE-02 ne doit pas être présenté comme livré.

## Cible approuvée et transitions

[PO-01 / ARLA-6](https://mindsept.atlassian.net/browse/ARLA-6) a reçu sept décisions
le 22 octobre. Le statut global « En cours » n'annule pas ces décisions.

| Décision approuvée | Livré / travail restant |
| --- | --- |
| Validation simple par manager direct ; RH en secours sans manager actif | Éligibilité HA-02, décision concurrente atomique et historique HA-03 livrés |
| Note d'un RH traitée par un autre RH, jamais par lui-même | Éligibilité livrée ; explication visible lorsqu'aucun RH n'est éligible encore à intégrer |
| Nouveau manager reçoit les notes en attente, ancien perd ses droits | Prédicat courant livré ; historique durable HA-03 livré ; gestion complète du graphe HA-06 à intégrer |
| Rôles/désactivation prennent effet immédiatement, historique conservé | Révocation et colonne d'activation livrées ; endpoints de cycle de vie/gestion HA-06 à intégrer |
| Invitation entreprise + email vérifié, expirante et à usage unique | Cible HA-05 ; pas d'endpoint d'invitation livré dans ce contrat |
| Création entreprise/premier RH par administrateur ; dernier RH protégé | Cible HA-05/06 ; aucun endpoint d'administration initiale ou garde du dernier RH revendiqué |
| Notifications internes à l'affectation/décision, échec sans rollback, retry dédupliqué | Cible HA-09 ; aucun endpoint ni garantie de notification actuellement documentés |

Ne sont pas décidés par implication : attribution entre plusieurs RH, détails
sans valideur éligible, règles de dates futures/totaux, TTL exact des invitations,
récupération de compte, modification/annulation de note. Les formats acceptés
actuels décrivent du code ; ils ne constituent pas un nouvel arbitrage produit.

| Évolution | Contrat courant | Transition future |
| --- | --- | --- |
| Pagination LE-07 | Tableau complet, aucun curseur/compte total | Enveloppe et paramètres à publier avec le code, sans inventer leur nom |
| Idempotence LE-03 | Aucun en-tête ni résultat de rejeu promis | Ajouter clé, portée, expiration et conflits avec l'implémentation livrée |
| OCR LE-05/06 | Réponse synchrone 200 avec champs facultatifs ; PDF et échec peuvent produire `{}` ; pas de limite de taille dans cette route | Bornes/erreurs LE-05 d'abord ; 202/job/polling seulement si variante asynchrone décidée et intégrée |
| Décision HA-03 | Transition conditionnelle et événement atomiques ; GET historique `{items}` avec auteur figé à la décision | Intégration écran EL-06 ; aucune notification revendiquée |

## Validation et maintenance

`tests/contracts/leandro/LE-10/openapi.ts` charge le **fichier versionné**, résout
ses schémas/réponses et valide types, formats complets, bornes, propriétés, média,
statut et en-têtes. Le test réutilise Ajv 6 déclaré par ESLint et verrouillé dans
`package-lock.json`, résolu depuis ESLint pour ne pas dépendre du hoisting. Aucune
nouvelle dépendance ni modification des scripts de Mathis. La conversion du
sous-ensemble utilisé par OpenAPI 3.0 vers JSON Schema draft-07 traite explicitement
les références et les bornes exclusives booléennes ; `nullable` est activé.
Les mots-clés inconnus font échouer la compilation. Un changement de version
majeure d'Ajv exige une revue de cette intégration ; Mathis reste propriétaire de
tout ajout éventuel d'un validateur direct.

L’audit initial recensait 14 fichiers. HA-03 a ajouté la quinzième route pendant LE-10 :
l’inventaire, le contrat et les tests ont été rapprochés de cette intégration avant fusion.
L’historique expose uniquement ID événement, états, instant et auteur (`id/displayName`),
jamais email ou reçu ; les notes anciennes décidées ne reçoivent aucun événement inventé.

Les tests unitaires vérifient l'inventaire, les références/exemples, les formats et
un témoin négatif (`amount: "12.50"`). Les tests API consomment la cible isolée
commune via `readTestTarget`, créent deux entreprises synthétiques et de vrais
comptes PostgreSQL, puis s'authentifient par Auth.js. Ils valident chaque opération
métier sans session, les refus de rôle/périmètre, les listes, la création multipart
avec S3, les URLs signées, les décisions et leurs conflits, l'affectation et ses
refus. Une réponse HTTP réelle mutée avec un montant texte est refusée. Les refus
404 invisible/absent sont comparés, leurs corps recherchés pour les données des
fixtures et les lignes refusées vérifiées inchangées.

```sh
npm run verify
npm run test:collect
npm run test:ci
```

La dernière commande lance aussi les suites API/E2E existantes, les services jetables,
la préparation, le build et le nettoyage. Elle n'utilise pas la base de développement.
Pour une exécution API seule, les mêmes variables isolées explicites sont requises ;
il n'existe aucun fallback vers `.env`. Aucun nouveau test navigateur ne duplique
les tests de rôle existants pour cette modification documentaire/test.

Procédure pour chaque PR qui change une API : l'auteur met à jour son opération,
ses schémas/exemples et ses tests ; Leandro vérifie la cohérence éditoriale du
contrat. Une route ajoutée sans inventaire ou un type modifié sans schéma fait
échouer les contrôles. Déplacer une cible dans les opérations livrées seulement
avec le code intégré ; mettre à jour la base et ce tableau dans la même PR.

La version `info.version` décrit le contrat, pas la version du format OpenAPI.
Correction documentaire sans changement livré : patch ; ajout compatible : mineur ;
retrait/changement de type, enveloppe paginée ou suppression d'`error` : majeur avec
plan client et transition explicite. Les schémas fermés imposent de revoir même un
ajout compatible : le test doit suivre le DTO, sans supprimer les assertions de
confidentialité. Ne pas remplacer une réponse inconnue par un `default` permissif.

Décision (cours C3) : un contrat versionné directement utilisé par les tests rend
l'écart observable, sans toucher au code métier ou disperser des schémas locaux.
Une spécification idéale qui annoncerait déjà pagination, idempotence et OCR
asynchrone est écartée : elle ferait échouer les consommateurs du code livré.
La validation de forme ne prouve ni les règles métier complètes, ni la RLS, ni un
échec réel de stockage, ni la validité/décodabilité de tout document uploadé.
