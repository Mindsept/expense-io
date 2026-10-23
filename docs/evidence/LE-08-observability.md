# LE-08 — Preuves du 23 octobre 2026

Base main `2f77990093e96f62b616b059986fe6723a7a89a7`. Le head validé et le commit
de fusion sont consignés dans la PR liée à ARLA-26. Diff relu ; aucun package,
workflow, runner partagé ou migration modifié. `lib/errors.ts`, `lib/db.ts` et
`application/decide-expense.ts` sont strictement inchangés.

## Validation

Pipeline complet local Node24.19 : **532 unitaires, 150 API, 14 E2E** passés,
zéro retry. Lint/typecheck/collecte, services PostgreSQL/LocalStack jetables,
préparation, build de production, API, navigateurs et cleanup : tous code0.
`git diff --check` propre. La production utilise la même enveloppe OpenAPI v3,
aucun nouveau endpoint ou type de réponse métier.

Commande : `node /tmp/arla-le10-ci-webpack.mjs` avec runtime Node24 et npm_execpath
explicites, copie extérieure du runner qui utilise ses mêmes modules et ajoute
seulement `--webpack` au build. La restriction IPC locale Turbopack reste présente.
GitHub Actions est désactivé au niveau du dépôt ; **aucune CI distante verte ni
relecture humaine indépendante n'est revendiquée**. Cleanup réussi.

## Preuves de comportement

Douze nouveaux tests unitaires : mille requestIds/noteIds/emails uniques gardent
une seule série pour la même opération ; propriétés sensibles/labels inconnus
écartés ; native HA-07/HA-03 correctement normalisés ; histogrammes/snapshots
copiés ; durées invalides rejetées et durées très longues explicitement plafonnées
sans perdre leur compteur ; vide/timeout distincts ; capacité validée ; panne de
console/classifieur isolée et erreur primaire identique ; UUID de support valide
seul affiché avec le message serveur sûr. L'export réel est lancé en processus
séparé : ligne trop longue et bruit ignorés, agrégat sans IDs, corrélation limitée,
erreur de lecture statique sans fuite du chemin.

Trois nouveaux scénarios API avec vrais comptes/session Auth.js, PostgreSQL,
LocalStack et processus Next de production :

1. Proxy S3 privé refuse effectivement PUT. Le POST renvoie 500 et le requestId
   correspond au Problem Details/en-tête, puis l'export retrouve storage_upload_failed
   et http_5xx par ce même ID, sans données de fixture. Aucun INSERT. Après reprise
   de S3 : 201, storage.upload success et expense.persist success après commit.
2. Vraie note et vraie approbation manager : 200 puis 409 au second essai ; les
   événements natifs HA-03 portent success/conflict et les IDs courants. L'export
   agrège ces deux catégories sans série par note. Le service est composé avec
   son hook publié ; les autres tests HA-03/HA-02 manager/RH restent passants.
3. Vraie image vide : 200 et ocr_empty/success ; un autre processus avec délai
   d'initialisation100ms : vrai 504 et ocr_timeout/error. Les échantillons de
   capacité montrent le worker sain inactif, puis zéro worker après timeout.

Un nouveau navigateur réel passe par le formulaire, avec une panne S3 réelle :
500, en-tête Problem Details, référence UUID affichée, champs/date/fichier conservés,
aucune note. La recherche utilise **le texte effectivement lu dans l'alerte** et
retrouve la phase interne et le statut HTTP, sans email/mot de passe/description/
fichier/URL signée/SQL. Le client conserve son traitement sûr des 5xx sans lire
leur corps ; le test navigateur exerce ce chemin en-tête-vers-écran, tandis que
les tests API prouvent l'égalité corps/en-tête. L'assertion exacte de l'ancien
parcours LE-01 inclut désormais la référence, sans retirer ses contrôles de
conservation, DTO, SQL ou octets S3.

Le test de flux HTTP LE-05 a été stabilisé sur la borne effective **+1 octet**, en
chunked sans longueur, pour OCR et création. Une écriture de plusieurs mégaoctets
encore pendante après refus provoquait une course TCP ECONNRESET indépendante du
contrôle de taille. Le client de test respecte la backpressure et continue
**d'exiger une vraie réponse HTTP413**, jamais un reset/EPIPE comme succès. Les
tests de flux unitaires et de fichier excessif restent inchangés dans leur portée ;
aucun retry ou assouplissement de statut n'a été ajouté au runner.

## Export mesuré et portée

Commande réellement exécutée :
`node scripts/leandro/LE-08/export.mjs --input .ci-output/production.log`.
Le [résultat agrégé](LE-08/local-metrics.json) ne contient aucun requestId, userId,
companyId ou noteId. Il correspond uniquement au log du serveur partagé de ce
pipeline ; les serveurs privés des tests de faute ont leurs propres captures
assainies utilisées par les assertions, et ne sont pas inventés dans cet export.
Ce résultat n'est ni un SLO, ni une promesse de collecte persistante multi-instance.

Voir [le contrat opérationnel](../observability.md) pour les codes, unités,
cardinalité, commande de recherche, rétention non installée, limite300s des valeurs
et portée des jauges instantanées. Le traitement métier ne dépend pas de l'export.

## Justification du raccordement

Quatre imports de handlers approve/reject pointent vers un module Leandro qui
compose `createDecideExpenseService({observe})` ; aucune modification de leur
logique de validation/transaction n'est faite. Le helper client-errors ajoute
uniquement la référence UUID au message existant afin de satisfaire la preuve
utilisateur. L'instrumentation de phases est dans les modules Leandro ; les hooks
HA-03/HA-07 et leur logger restent propriétaires du diagnostic natif, sans double
log HTTP/décision. Les tests nouveaux restent dans les dossiers LE-08.
