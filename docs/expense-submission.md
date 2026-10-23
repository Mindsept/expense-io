# LE-02 — Soumission complète et compensation

Ticket : [ARLA-20](https://mindsept.atlassian.net/browse/ARLA-20). Base : main
`1bcebdb` (LE-01 et HA-02 intégrés). Aucun nouveau package, migration, endpoint,
service externe ou changement de policy RLS.

## Protocole et responsabilités

L'ancien parcours insérait une note avec `receipt_key=''`, envoyait le fichier,
puis faisait un UPDATE. Une panne intermédiaire rendait donc une note finale
visible sans justificatif. Le nouveau parcours n'insère qu'une note complète.

| Étape | Action | En cas d'échec |
| --- | --- | --- |
| Validation HTTP | Session rafraîchie, montants/date/description/conteneur LE-01 | Aucun upload ni SQL de notes |
| Autorité | `withCurrentActor` HA-02, transaction courte de contrôle | Aucun upload ni insertion |
| Upload | Clé `receipts/<UUID serveur>.<extension MIME validée>`, octets validés | Aucune insertion ; suppression prudente de cette seule clé, référence d'upload incertain |
| Insertion | Nouvel acteur courant, INSERT complet sous son scope, vrai mapper LE-12 | Avant COMMIT : compensation de l'objet |
| Commit | Le helper HA-02/DB termine la transaction avant le succès HTTP 201 | Si résultat incertain : conserver l'objet et signaler sa référence pour réconciliation |

`SubmitExpense` orchestre les ports réellement utilisés. Le port de stockage
existant et `S3ReceiptAdapter` sont étendus avec `remove`; il n'existe pas un
second stockage concurrent. `PostgresExpenseSubmissionAdapter` réalise la seule
insertion et refuse une référence vide. La route conserve l'authentification
précoce et les validateurs, puis appelle le service composé ; elle ne porte plus
l'enchaînement S3/INSERT et ne contient aucun UPDATE final.

Aucune transaction/verrou SQL n'est tenu pendant la lecture du multipart, PUT ou
DELETE S3. Le contrôle initial est terminé avant PUT ; l'insertion recharge et
verrouille l'acteur après l'upload. Une désactivation entre les deux refuse
l'insertion et compense le fichier. Les trois rôles actifs gardent les opérations
personnelles permises ; les champs `userId/companyId/role` du client ne décident
pas de l'auteur. Le compte/entreprise courants viennent exclusivement de HA-02.

Le montant validé reste du texte lié à PostgreSQL ; le reçu est associé dès
l'INSERT. Le mapper s'exécute avant COMMIT : une ligne incohérente provoque un
rollback au lieu d'un DTO inventé. Les extensions de noms dérivent du MIME validé,
jamais d'un nom fourni par le client. Les anciennes clés restent lisibles par
le même GET de présignature : aucun renommage d'objet existant n'est nécessaire.

## Compensation et résultat de commit incertain

Une erreur d'authentification, d'INSERT ou de mapping survenue avant la fin du
callback signifie que COMMIT n'a pas été tenté : le cas d'usage supprime l'objet
uploadé. La suppression utilise le même adaptateur et un signal d'abandon de
5000 ms. Une erreur de suppression ne remplace jamais l'erreur principale.

Une erreur après le retour du callback peut provenir de COMMIT ou de la perte de
son accusé de réception. Supprimer le fichier dans ce cas pourrait casser une
note déjà commitée. L'adaptateur distingue donc `not_committed` et `unknown` ;
une erreur inattendue du port de persistance est également traitée avec prudence.
Le résultat incertain conserve le fichier, remonte l'échec et journalise une
référence de réconciliation. Il ne retourne pas un succès supposé.

Une erreur de PUT peut aussi laisser un objet arrivé tardivement. La compensation
est tentée, puis une référence `upload_unconfirmed` est journalisée, même si
DELETE a répondu positivement. Aucun de ces cas n'est présenté comme exactly-once.

## Référence exploitable et confidentialité

Le journal stderr contient exclusivement :

```json
{
  "operation": "expense.submit.cleanup",
  "code": "cleanup_failed",
  "receiptRef": "11111111-1111-4111-8111-111111111111",
  "extension": ".png",
  "requestId": "22222222-2222-4222-8222-222222222222"
}
```

Codes bornés : `cleanup_failed`, `upload_unconfirmed`, `commit_unconfirmed`.
Le `requestId` vient du contexte normalisé HA-07, pas d'une nouvelle génération.
La référence opaque est créée par le serveur ; elle n'est ni un identifiant de
personne ni une URL signée. Elle permet de reconstruire la clé exacte sans
conserver nom de fichier, contenu, email, mot de passe, SQL ou exception brute.
Ces références sont des données de diagnostic, jamais des labels de métriques.
Le journal ne modifie pas `lib/errors.ts`/`lib/db.ts` et ne remplace pas le logger
HTTP. Les transports rejetés, levés ou bloqués ne changent pas la réponse métier.

Pour une intervention autorisée : retrouver l'événement via requestId, reconstruire
`receipts/<receiptRef><extension>`, puis vérifier sa référence en base avant toute
suppression. Un `commit_unconfirmed` peut correspondre à une note valide : ne pas
supprimer sur le seul statut HTTP 500. Pour un upload incertain, vérifier aussi
qu'aucune écriture n'est encore en cours. Le journal fournit la référence, pas
une autorisation d'effacement global ni une preuve durable de quiescence.

stdout/stderr doivent être collectés par l'exploitation pour conserver ces
événements. Aucun collecteur, rétention garantie ou file durable n'est ajouté.
Un arrêt brutal entre upload/INSERT ou avant collecte du journal peut laisser
un orphelin. Un commit réussi suivi d'une réponse perdue peut conduire à un
nouveau dépôt lors d'un retry. Registre durable, reprise, déduplication et
réconciliation automatique restent explicitement LE-03.

## Preuves

Les tests unitaires de LE-02 couvrent l'ordre des ports, le refus d'autorité,
la référence vide, PUT/INSERT/mapping/compensation en échec, le commit incertain,
la confidentialité, les transports de diagnostic défaillants et des exécutions
concurrentes dont une compensation ne supprime jamais le reçu de l'autre.

La suite API utilise PostgreSQL/LocalStack réels et un serveur Next de production
privé, lancé/arrêté via le support de processus existant. Un proxy HTTP loopback
appartenant au test injecte les refus PUT/DELETE ou retient uniquement l'accusé
de réception d'un PUT déjà effectivement stocké. Il ne remplace pas PostgreSQL
ou S3 par un double mémoire. Les compteurs de PUT/DELETE confirment les appels.
Un CHECK PostgreSQL temporaire sur une description synthétique UUID refuse
uniquement l'INSERT visé ; il est supprimé après la suite.

Pendant le PUT retenu, aucune nouvelle note n'est visible. Une désactivation
PostgreSQL avec `statement_timeout=2000ms` réussit avant la libération du PUT,
prouvant l'absence de verrou d'acteur tenu pendant ce réseau. Après libération,
l'API retourne 401, sans nouvelle note, et supprime l'objet. Les autres scénarios
vérifient 201 + octets identiques par URL signée, téléchargement d'une clé ancienne,
refus de stockage sans note, INSERT refusé suivi de DELETE réel et compensation
refusée avec référence exacte permettant le nettoyage du seul orphelin de test.

Les services, comptes, contraintes et objets sont strictement synthétiques et
isolés ; les processus et objets propres à la suite sont nettoyés. Les runners,
workflows et manifests de Mathis sont inchangés. Les assertions LE-01 suivent la
nouvelle insertion unique complète et renforcent l'absence d'INSERT après
révocation, plutôt que de conserver la séquence partielle désormais remplacée.

Décision : upload avant INSERT complet avec compensation et classification
prudente du commit. L'ancienne insertion vide rend un échec visible dans le
métier ; maintenir une transaction SQL pendant S3 augmente contention et durée
des verrous ; une transaction distribuée ou un broker ne se justifie pas pour
cette première tranche. Ce choix laisse le protocole durable à LE-03 et conserve
la séparation cas d'usage/ports/adaptateurs attendue au cours C1–2/C3.
