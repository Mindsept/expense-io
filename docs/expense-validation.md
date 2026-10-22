# LE-01 — Validation et tri, intégration d'acteur encore attendue

État : tranche indépendante implémentée ; ticket incomplet et PR en brouillon
tant que HA-02 n'est pas disponible dans main. `auth()` identifie encore l'acteur
selon le comportement existant. Aucune garantie de révocation immédiate d'une
session, de changement de rôle/entreprise ou de RLS réelle n'est annoncée ici.

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
  bissextiles vérifiées par le validateur partagé. Aucune interdiction de date
  future inventée en l'absence de règle PO-01.
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
manifest/lockfile ni fichier d'un autre propriétaire n'est modifié.

Le contrôle de poids intervient **après** `request.formData()` : il ne borne pas
la lecture HTTP avant matérialisation. LE-05 conserve ce chantier. La séquence
note vide → S3 → UPDATE hors scope reste celle de départ ; LE-02 doit la remplacer.
Pas d'idempotence ou de nettoyage automatique ajoutés ici.

L'intégration finale doit remplacer l'autorité du JWT par le contrat HA-02
publié et validé par son propriétaire. Le contrat observé dans la PR #4 est
`withCurrentActor(requiredRole, callback(client, actor))` ; il n'est ni copié ni
importé depuis un fichier absent de main. Lire le corps avant la transaction,
consommer ce contrat dans les parcours personnels puis vérifier avec de vraies
sessions les suppressions/changements de droits et l'absence de lecture/écriture
refusée. Le brouillon HA-02 signale aussi une correction de verrous attendue de
HA-06. Aucun de ces critères n'est remplacé par un test ignoré ou un faux succès.
