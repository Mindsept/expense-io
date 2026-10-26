# ARLA-6 / PO-01 — règles, contrats et responsabilités

État documentaire au 26 octobre 2026. Les décisions des 22 et 25 octobre viennent de [PO-01 dans Jira](https://mindsept.atlassian.net/browse/ARLA-6). La présente relecture est assistée ; elle ne prétend pas être une approbation personnelle d'Hugo, Hamza ou Leandro. Le code examiné est la base `888a74ddae9db28378596adc7709358798986e49` du fork Mindsept.

## Décisions produit déjà validées

| Sujet | Règle retenue | Contrat ou preuve de réalisation à consulter |
| --- | --- | --- |
| Note ordinaire | Une décision du manager direct actif suffit. Recours RH lorsqu'aucun manager éligible n'existe ; aucune double validation systématique. | [Autorisation courante](../authz-current-actor.md), [hiérarchie](../management-hierarchy.md) |
| Note RH / absence de valideur | Autre RH éligible de la même entreprise ; auto-approbation toujours interdite. Si aucun valideur n'est éligible, note en attente et raison visible. | [Notifications et routage](../notifications-runtime.md) ; ARLA-18 et ARLA-36 |
| Plusieurs RH | Tous les RH actifs éligibles sont notifiés, hors auteur. La première décision validée en base gagne ; les autres voient le traitement. | [Décision atomique](../adr/HA-03-atomic-decisions.md), [contrat courant HA-09](../notifications-runtime.md) |
| Changement d'organisation | Le nouveau manager récupère les notes en attente ; l'ancien perd ses droits. Les événements de décision passés restent conservés. | [HA-06](../management-hierarchy.md) |
| Rôle / désactivation | Droits rechargés à chaque opération. Compte désactivé inutilisable ; notes et historique conservés et traitables selon le circuit courant. | [Acteur courant](../authz-current-actor.md) |
| Affiliation | Invitation RH liée à l'entreprise et à l'adresse vérifiée, expirante et à usage unique. Aucun transfert implicite d'un compte existant. | [HA-05](../invitation-enrollment.md) |
| Création d'entreprise | Bootstrap initial par administrateur, premier RH explicite ; les RH gèrent ensuite leur entreprise. Pas de suppression/désactivation du dernier RH sans remplacement. | [Bootstrap](../invitation-enrollment.md), [organisation](../management-hierarchy.md) |
| Notifications | Attribution au valideur et décision à l'auteur dans l'application. Une panne de livraison n'annule pas la décision ; reprise sans doublon visible. Emails de notification secondaires. | [HA-09 runtime](../notifications-runtime.md) |
| OCR | Préremplissage facultatif, synchrone et borné ; contrôle/correction par l'utilisateur. Échec ou délai : réessai ou saisie manuelle sans perdre le formulaire. Pas de jobs OCR durables dans cette version. | [ADR LE-06](../adr/LE-06-bounded-ocr.md), [bornes](../ocr-resource-limits.md) |

Ces décisions ne sont pas remises en discussion par un ancien paragraphe de préparation encore présent dans une preuve historique.

## Compléments validés par Hugo le 26 octobre

Hugo a répondu explicitement **« Valider ces règles »** à la proposition dans la conversation du 26 octobre. Le tableau consigne ces choix et leur lien avec le code ; il ne vaut pas réception des parcours de l'application. La limite dite « 10 Mo » dans la question correspond ici à la limite technique existante, **10 MiB = 10 485 760 octets**.

| Sujet | Fait vérifié | Décision validée pour cette remise | Effet d'un changement ultérieur |
| --- | --- | --- | --- |
| Dates futures | [Validation](../../src/lib/expense-input.ts) : vraie date civile, sans borne « aujourd'hui ». Des tests existants conservent une date future. | **Dates futures acceptées**, en conservant les contrôles de date civile. | Interdire les dates futures impose une règle de fuseau/date de référence, une correction API/UI et les tests correspondants ; ne pas l'ajouter seulement dans l'écran. |
| Justificatifs | PNG, JPEG, WebP et PDF non vides, au plus **10 MiB = 10 485 760 octets**, MIME et conteneur contrôlés. OCR a ses propres limites et n'est pas promis pour tout justificatif. | **Ces quatre formats et cette limite sont retenus** pour le dépôt. | Réduction de formats ou taille : modifier aide, contrat et tests ensemble ; ne pas retirer silencieusement l'accès aux anciens reçus. |
| Total affiché | [Pagination](../pagination.md) : total de tout l'ensemble autorisé et filtré ; indépendant de la page. Personnel : tous statuts ; manager/RH : notes en attente actuellement éligibles. | **Total de tout l'ensemble autorisé et filtré**, et non de la seule page ; garder l'indication du périmètre. | Un montant « à rembourser » ou « de la page » serait un autre agrégat, à nommer et tester explicitement. |
| Récupération de compte | Aucun parcours de récupération en libre-service livré dans les routes examinées. | Hors périmètre de cette remise ; conserver comme amélioration priorisée, sans prétendre qu'une procédure administrative est implémentée. | Nouveau cycle de vie de jetons, preuve d'adresse, révocation et tests nécessaires. |
| Modification / annulation de note | Aucun parcours public de modification, suppression, réouverture ou annulation de note. La décision terminale est unique ; historique et registre d'idempotence sont conservés. | **Hors périmètre de cette remise**, conservé au backlog ; aucune procédure de correction supplémentaire n'est annoncée comme livrée. | Exige une décision sur historique, justificatifs, idempotence et droits ; ne pas proposer un DELETE direct. |
| Expiration d'invitation | `ENROLLMENT_INVITATION_TTL_SECONDS` obligatoire, de 60 à 604800 secondes, aucun défaut runtime. Les tests à 3600 secondes sont des fixtures. | **48 heures = 172800 secondes**, valeur explicite du modèle `.env.example`, usage unique. | La plage 60 secondes–7 jours reste une borne de sécurité technique ; elle ne remplace pas la règle produit de 48 heures. Une autre durée opérationnelle demande un nouvel arbitrage. |
| Preuve d'adresse | Lien privé envoyé à l'adresse exacte par un bridge de livraison ; deux secrets dont seuls les condensats sont en base ; contrôle de possession et consommation atomique. | **Lien privé délivré au destinataire exact**, usage unique et expiration de 48 heures. Le fournisseur réel et sa configuration restent distincts de la boîte de test locale. | Aucun email réel ni assurance de livraison fournisseur ne découle des tests `.test`. |

Ces arbitrages sont clos. Pour activer une livraison réelle, fournir séparément et en privé `AUTH_URL`, `ENROLLMENT_DELIVERY_URL` et `ENROLLMENT_DELIVERY_BEARER` ; aucune URL de fournisseur ni clé n'est déduite de la décision. Le runtime continue à refuser une configuration absente ou invalide. La récupération de compte et la modification/annulation restent des améliorations futures, pas des défauts bloquant cette version.

## Contrats communs effectifs

| Frontière | Source de vérité | Règle de compatibilité |
| --- | --- | --- |
| Acteur, entreprise, rôle | [current-actor.ts](../../src/lib/current-actor.ts), [HA-02](../authz-current-actor.md) | Recharger l'acteur ; ne pas faire autorité avec rôle/entreprise soumis par le client ou anciens claims. |
| Erreur HTTP | [errors.ts](../../src/lib/errors.ts), [HA-07](../api-errors.md) | Erreur lisible, code stable et corrélation ; pas de SQL, secret ou objet d'exception dans le navigateur. |
| Note publique | [DTO partagé](../../src/contracts/expense-note.ts), [mapper](../../src/adapters/expense-note-mapper.ts) | Date civile préservée ; instant ISO UTC distinct ; auteur limité à id/nom d'affichage quand l'accès le permet. |
| Listes | [OpenAPI v5](../openapi/expense-io.v5.json), [pagination](../pagination.md) | `{items,pagination,totals}` pour tous les appels ; défaut 20, maximum 100, ordre stable. Les versions v1–v4 sont historiques. |
| Intention de soumission | [LE-03](../expense-idempotency.md) | Même clé et même contenu après résultat incertain ; pas de nouvel upload/mutation pour un rejeu achevé et autorisé. |
| Cohérence DB / S3 | [LE-02](../expense-submission.md), [LE-03](../expense-idempotency.md) | La transaction SQL ne couvre pas S3. Décrire compensation, état incertain et réconciliation, sans promettre une transaction distribuée. |
| Décision | [HA-03](../adr/HA-03-atomic-decisions.md) | Transition conditionnelle, audit et intention de notification dans la transaction ; décision concurrente perdante en conflit. |
| Notifications | [HA-09 courant](../notifications-runtime.md) | Web et worker DB séparés ; règles courantes à l'affichage comme à la livraison ; pas de canal externe dans la transaction métier. |
| Invitations | [HA-05](../invitation-enrollment.md) | TTL explicite et livraison privée ; refus sûr si configuration manquante ; aucune affiliation par domaine d'email. |
| Schéma et accès DB | [HA-04 runtime](../security/HA-04/runtime-isolation.md) | Migrations ordonnées, administrateur de préparation séparé, web/worker limités, droits des nouvelles tables testés. |

## Matrice de propriété et transferts

| Zone | Responsable du contrat | Transfert / relecture |
| --- | --- | --- |
| Authentification, acteur, erreurs, DB/RLS, décisions, organisation, inscription | Hamza | Les consommateurs importent ces contrats ; tout changement de droits reste explicite et relu. |
| API personnelle, soumission/reprise, stockage, OCR, DTO, OpenAPI | Leandro | DTO consommé par Hamza/Elyes ; API modifiée avec fixtures et consommateurs compatibles. |
| GET manager/RH et annuaire | Leandro depuis intégration HA-06 → LE-07/LE-11 | Les décisions/affectations restent Hamza ; pas deux modifications concurrentes du même contrat. |
| Écrans, pagination, erreurs réseau et accessibilité | Elyes | Relecture des contrats avec Leandro ; pas de contournement d'autorisation dans l'UI. |
| Manifests, lockfile, CI, runners/support, seed et exploitation | Mathis | Besoins de dépendances transmis à Mathis ; tests métier conservés chez leurs auteurs. |
| Règles produit, index de preuves et soutenance | Hugo | Relecture technique des auteurs ; l'assistance IA et ses limites sont explicites. |
| Migration nouvelle | Auteur du ticket / domaine concerné | Nom préfixé réservé ; pas de réécriture concurrente d'une migration déjà livrée. |

Les tests suivent `tests/{unit,api,e2e}/{owner}/{ID}`. Les transferts se font dans l'ordre après intégration, avec contrat, SHA, tests et limites. Le fait que Codex exécute une revue ou un scénario ne vaut pas signature personnelle du responsable.

## Suivi documentaire et réception

- [x] Hugo a validé les compléments par « Valider ces règles », le 26 octobre 2026.
- [ ] Le relecteur confirme la cohérence technique des contrats / propriétaires.
- [x] Candidat testé `f6592bc` identifié ; preuves détaillées centralisées par l'intégrateur dans [MATH-04](../recette-finale.md).
- [x] Aucun test professeur non fourni ni validation humaine absente n'est annoncé comme exécuté.

Choix architectural expliqué : garder un monolithe modulaire et les transactions locales réduit le coût d'intégration pour cette remise. Les ports sont utilisés là où ils isolent un cas d'usage réel ; une distribution en microservices et une file OCR durable sont écartées faute de besoin mesuré justifiant leur exploitation. Références : cours 1–2, diapositives 20, 32, 47–49 ; [audit et preuves](audit-et-preuves.md).
