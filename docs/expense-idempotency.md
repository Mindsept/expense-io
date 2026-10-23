# LE-03 — Intention durable et réconciliation ciblée

Ticket : [ARLA-21](https://mindsept.atlassian.net/browse/ARLA-21). Base : main
`aa2720b` après LE-02. Contrat HTTP OpenAPI 2.2.0. Aucun package, service,
endpoint public, changement de runner ou de rôle d'application ajouté.

## Contrat client

Le POST `/api/expense-notes` accepte facultativement `Idempotency-Key`, un UUID
normalisé en minuscules. Il identifie une intention, dans le périmètre
**utilisateur courant + entreprise courante + expense.create**. Ne pas générer
une nouvelle clé à chaque retry. EL-04 adoptera cet en-tête ; il reste facultatif
pendant cette transition, et les requêtes sans clé gardent les limites LE-02.

Le fingerprint SHA-256 versionné comprend le montant décimal canonique, la date
civile, la description validée/trimée, le MIME, le poids et le hash des octets
exacts. Un nom de fichier différent ne change pas l'intention. Le registre ne
conserve ni fichier ni nom original, mais le résultat nécessaire au rejeu contient
les données métier de la note et exige les mêmes protections de conservation.

| État de l'intention | Réponse / reprise |
| --- | --- |
| Nouvelle ou tentative échouée | Réserver une nouvelle tentative durable, puis upload et insertion complète ; 201, `Idempotency-Replayed: false` |
| En cours, lease de deux minutes valide | 409 `idempotency_in_progress` ; le client peut attendre puis réessayer avec la même clé et le même contenu |
| Lease expiré | Retirer l'ancienne tentative et réserver une nouvelle clé de reçu ; l'ancienne ne peut plus commiter |
| Terminée, même contenu | Recharger l'acteur et vérifier la propriété de la note, puis retourner le DTO de création original avec 201 et `Idempotency-Replayed: true`, sans upload |
| Même clé, contenu différent | 409 `idempotency_conflict`, sans mutation de la première intention |
| Fenêtre de sept jours expirée | 409 `idempotency_expired` ; consulter l'historique avant une nouvelle intention |

La fenêtre commence à la première réservation et ne glisse pas à chaque retry.
Les clés expirées ne sont jamais automatiquement recyclées. **Aucune purge du
registre n'est livrée** : opérations, résultats et tombstones restent en base.
Une future politique d'archivage/suppression doit préserver l'interdiction de
rejouer une ancienne mutation et les références nécessaires au nettoyage.
Les FK empêchent aussi la suppression directe d'une note, d'un utilisateur ou
d'une entreprise encore référencés ; aucun parcours de suppression correspondant
n'existe actuellement. Décider et migrer ce cycle de vie avant de l'ajouter.

Le résultat de rejeu est la représentation de création, même si la note a depuis
été décidée ; les GET métier donnent son état courant. Le requestId HTTP est celui
de la requête courante. Les codes statiques utilisent le catalogue HA-07 commun.
Une suppression/désactivation de compte refuse le rejeu ; changer d'entreprise
rend l'ancienne portée invisible, même avec un cookie antérieur.

## Atomicité et clôture des tentatives

La contrainte unique PostgreSQL et un verrou de ligne court coordonnent tous les
processus. Ni Map locale, ni verrou SQL pendant S3. Chaque tentative reçoit un
UUID serveur et une clé de reçu exclusive, enregistrés **avant PUT**. Une lease
permet de récupérer un processus mort ; elle ne constitue pas une permission de
commiter après expiration. L'INSERT de note, le cache de réponse et l'état
committed de la tentative sont commités dans une transaction HA-02 unique après
nouveau contrôle d'acteur. Le pointeur vers la tentative courante clôt les
anciennes tentatives : elles ne peuvent pas écraser le résultat ni utiliser le
reçu d'une reprise. Le cache n'est jamais écrit après le commit de la note.

LE-02 reste responsable des compensations et de la prudence face à un COMMIT
incertain. Un résultat incertain conserve son objet ; un retry consulte le
registre. Si la mise à jour d'échec est elle-même indisponible ou l'acteur révoqué,
la référence durable préalable suffit à une intervention ultérieure et un code
statique `operation_state_unconfirmed` est journalisé. Il n'y a pas de promesse de
transaction distribuée/exactly-once pour les clients sans clé ou hors contrat.

## Migration et isolation

Appliquer `1792749600000_leandro_expense_submission_registry.sql` avant de déployer
le code. Elle ajoute deux tables, des contraintes et un index de référence exacte
sur `expense_notes.receipt_key`. Elle ne réécrit pas la migration initiale. Le
rollback retire uniquement ces ajouts, mais perd la mémoire des intentions et du
nettoyage : sauvegarder les tables et revenir à un code compatible avant rollback.
Ne pas réactiver ensuite le protocole avec un registre vide sans traiter ce risque.

Les deux tables ont ENABLE/FORCE RLS, policies SELECT/INSERT/UPDATE de propriétaire
avec acteur actif et entreprise actuelle, aucun DELETE/TRUNCATE autorisé. Les
FK composites lient l'identité de la tentative à celle de son opération. Les tests
utilisent un véritable LOGIN non propriétaire sans SUPERUSER/BYPASSRLS et prouvent
les accès autorisés et refusés. **L'application conserve son rôle bootstrap actuel** ;
ce test ciblé ne prouve pas l'activation globale HA-04. HA-04 doit intégrer ces
nouvelles tables dans son inventaire et ses grants explicites avant de basculer
l'application ; le présent ticket n'effectue aucun changement de rôle.

## Commande privée

Exécuter depuis la racine avec une connexion de maintenance dédiée explicitement
injectée dans `LE03_MAINTENANCE_DATABASE_URL` et les paramètres S3 explicites
`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (région
facultative, défaut us-east-1). Aucun chargement de .env ni fallback DATABASE_URL.
Le login et current_user doivent tous deux être SUPERUSER ou BYPASSRLS ; employer
un compte d'exploitation dédié avec les droits SQL requis, jamais celui de l'app.

```sh
node scripts/leandro/LE-03/reconcile.mjs --company-id "$LE03_COMPANY_ID" --dry-run --limit 25 --min-age-ms 300000 --max-duration-ms 30000
node scripts/leandro/LE-03/reconcile.mjs --company-id "$LE03_COMPANY_ID" --apply --limit 25 --min-age-ms 300000 --max-duration-ms 30000
```

La simulation est le défaut et n'écrit ni base ni S3. Portée obligatoire : une
entreprise ; limite 1..100 (défaut 25), âge minimal 5 min..30 jours (défaut 5 min),
budget 1..120 s (défaut 30 s). Le budget est vérifié entre les éléments, pas une
deadline dure du processus : une dernière phase SQL bornée à 3 s ou S3 à 5 s peut
le dépasser. L'acquisition de connexion expire à 3 s. Ne pas lancer cette commande
en continu sans un ordonnanceur d'exploitation explicitement choisi.

Le registre, pas une liste partielle de notes ou un inventaire de bucket, fournit
les candidats. L'application vérifie âge, état, portée, clé UUID/extension exacte
et toute référence de note ; elle ignore les tentatives committed/référencées.
En mode apply, elle verrouille sans attendre, recontrôle et clôt la tentative
expirée dans une transaction courte. **DELETE S3 n'arrive qu'après confirmation du
COMMIT de clôture**, hors verrou SQL. Une incertitude SQL conserve l'objet. Une
nouvelle tentative a une autre clé et son reçu ne peut pas être supprimé par ce
nettoyage. Les échecs de suppression restent disponibles pour un passage suivant.

Les tombstones sont conservés et tournent par date de contrôle, y compris après
DELETE réussi : un PUT ancien peut arriver après ce DELETE. Repasser après
quiescence permet de retirer cet objet tardif sans toucher le gagnant. Aucun
passage unique ne garantit l'absence définitive d'upload réseau tardif ; aucune
réparation aveugle d'anciens objets LE-02 non enregistrés n'est réalisée.

La sortie JSON ne contient que mode, compteurs, budgetExhausted et références
opaques/extensions/statuts statiques. Codes de sortie : 0 pour succès/simulation/
élément occupé ignoré ; 1 pour référence invalide, nettoyage ou état incertain ;
2 pour configuration/connexion/privilège invalide. Ni exception brute, URL,
identité, clé client ou contenu métier n'est imprimé. Conserver les sorties selon
la politique d'exploitation ; aucun collecteur ni rétention externe n'est ajouté.

## Décision

Un registre SQL avec cache atomique et tentative clôturable résout la réponse
perdue et la reprise entre processus avec les services existants. Un verrou en
mémoire n'accorde pas plusieurs serveurs ; une transaction SQL tenue pendant S3
bloque les révocations et ne résout pas une panne distribuée. Une lease avec
simple réutilisation du même objet exposerait le reçu gagnant à un DELETE tardif ;
les clés distinctes et le pointeur atomique évitent ce risque (cours C3/C1–2).
