# LE-01 — Validation stricte, tri fermé et acteur courant

HA-02 et HA-03 sont intégrés sur main. LE-02 remplace désormais la séquence de
soumission décrite dans les preuves historiques LE-01 : voir
[le protocole courant](expense-submission.md). Cette version consomme réellement
`withCurrentActor`, sans copier son contrat ni faire autorité avec les anciennes
revendications de rôle/entreprise de la session. La RLS reste une preuve séparée.

## Contrat réellement appliqué

GET personnel accepte exclusivement les six valeurs exactes de `sort` :
`created_at ASC`, `created_at DESC`, `amount ASC`, `amount DESC`,
`expense_date ASC`, `expense_date DESC`. L'absence ou la valeur vide conserve
`created_at DESC`. Plusieurs paramètres `sort` sont refusés. La table est une
Map dont les valeurs sont des fragments SQL constants ; aucun texte client ne
devient un fragment arbitraire. L'écran actuel ne transmet aucun paramètre de tri.
La pagination et son second critère déterministe restent LE-07.

POST exige exactement une occurrence de chaque champ requis :

- `amount` : chaîne décimale positive, 1–8 chiffres entiers, point et 1–2 chiffres
  décimaux facultatifs, sans espace, signe, exposant ou suffixe. Maximum
  `99999999.99`, compatible NUMERIC(10,2). La chaîne validée est liée à SQL sans
  parseFloat ni conversion intermédiaire en flottant.
- `expenseDate` : vraie date civile `YYYY-MM-DD`, années 0001–9999 et années
  bissextiles vérifiées par le validateur partagé. Les dates futures sont
  acceptées, choix validé par Hugo le 26 octobre dans [PO-01](po/regles-et-contrats.md).
- `description` : texte trimé non vide, maximum technique de 4000 unités UTF-16,
  sans contrôles C0/DEL hors tabulation/retours de ligne. Ce plafond borne le
  champ applicatif ; ce n'est pas une règle produit présentée comme approuvée.
- `receipt` : File non vide, au plus 10 MiB, MIME PNG/JPEG/WebP/PDF reconnu et
  cohérent avec son conteneur. L'extension provient du MIME validé, jamais du nom
  client. Le buffer est validé avant toute insertion ou upload.

Les erreurs 400/401 et les échecs techniques utilisent `withApiHandler` HA-07,
son contrat `error/detail/requestId` et son en-tête de corrélation. Les erreurs
asynchrones, transaction comprise, restent attendues dans cette frontière.

## Justificatifs : portée du contrôle

`receipt-validation.ts` contrôle signature et bornes de conteneur : PNG
(IHDR/IDAT/IEND, dimensions et CRC), JPEG (marqueurs, taille des segments,
présence d'une frame/scan et fin), WebP (RIFF/WEBP, longueurs et données image),
PDF (version, objet et fin de fichier). Il refuse les erreurs de type évidentes
et conteneurs tronqués. Il ne décode pas les pixels ni les objets PDF : ni
antivirus, ni suppression de contenu actif, ni garantie de validité exhaustive.
Cette frontière conserve une validation courte sans nouveau décodeur en runtime.

Références primaires du conteneur : [PNG/W3C](https://www.w3.org/TR/png-3/),
[WebP/Google](https://developers.google.com/speed/webp/docs/riff_container),
[PDF/ISO 32000-1 publié par Adobe](https://developer.adobe.com/document-services/docs/assets/35e4369068f86065372c18787171a17e/PDF_ISO_32000-1.pdf).

## Décision, suites et limites

Une Map fermée et des fonctions réellement appelées par la route remplacent
la concaténation libre et parseFloat. Écarter un ORM, une nouvelle bibliothèque
de validation et un décodage complet garde ce correctif proportionné ; aucun
manifest/lockfile ni support partagé de tests n'est modifié. Les deux anciens
tests de non-authentification de Mathis migrent vers le contrat HA-07 exact,
sans retirer leurs assertions de refus et d'absence de DB.

Le contrôle de poids intervient **après** `request.formData()` : il ne borne pas
la lecture HTTP avant matérialisation. LE-05 conserve ce chantier. Le POST valide l'entrée avant le cas d'usage de soumission. LE-02 vérifie
l'acteur, envoie S3 hors transaction puis insère une note complète sous l'acteur
rechargé ; une révocation après upload empêche l'INSERT et compense l'objet.
Le GET résout l'acteur courant, applique le tri constant et le filtre propre.
Les opérations personnelles restent permises aux trois rôles actifs ; retirer
un rôle RH retire ses droits RH sans lui interdire ses propres notes.
Les champs supplémentaires `userId/companyId/role` ne font jamais autorité.

Les tests de routes utilisent aussi le vrai contrat HA-02 avec un client DB double
pour vérifier qu'un acteur supprimé/inactif n'atteint aucune requête de notes.
Les preuves HTTP utilisent des sessions Auth.js réellement signées : suppression,
désactivation, changement RH→employé et d'entreprise, refus RH après retrait du
droit et dépôt personnel encore autorisé sous les droits courants. PostgreSQL et
la liste des objets S3 sont inchangés après les requêtes refusées.

Le contrat [OpenAPI courant v2](openapi/expense-io.v2.json) accompagne le changement
de tri et de format/média d'erreur ; v1 reste une archive historique. Aucun nouveau
contrat concurrent d'erreurs n'est ajouté. Les limites pré-matérialisation et
la reprise durable DB-S3 restent respectivement LE-05 et LE-03.
