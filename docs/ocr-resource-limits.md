# LE-05 — OCR borné et échecs explicites

Ticket : [ARLA-23](https://mindsept.atlassian.net/browse/ARLA-23), base main
`0dd9476` après LE-03. Aucun package ni service supplémentaire. Contrat courant
[OpenAPI 3.0.0](openapi/expense-io.v3.json), format OpenAPI 3.0.3.

## Lecture et validation

Les routes de création et OCR comptent les octets du flux **avant** formData,
y compris sans Content-Length ou avec un en-tête inférieur au flux réel. Une
longueur excessive permet seulement un refus anticipé ; elle n'autorise jamais
une lecture illimitée. La création conserve 10 MiB de fichier + 64 KiB de corps
multipart ; l'OCR utilise son maximum configurable + 64 KiB. Tous les champs,
entêtes de parties et fichiers supplémentaires consomment cette même enveloppe.
La validation LE-01 de chaque champ/fichier reste ensuite applicable.

Le lecteur ne conserve aucun chunk qui ferait dépasser l'enveloppe et cesse de
tirer des octets. La réponse 413 ferme la connexion après son envoi ; annuler
immédiatement le flux IncomingMessage Node couperait le socket avant ce refus. Le runtime/proxy peut déjà avoir alloué le chunk courant ou préchargé des
octets ; une borne applicative n'est pas une limite mémoire globale du serveur.
Le buffer borné, le parseur multipart et la copie de File peuvent coexister ; leur
mémoire est un multiple de l'enveloppe, pas exactement sa taille. Aucun délai
absolu de parseur multipart n'est revendiqué ; la quantité à parser est bornée.
Les lectures lentes expirent et les annulations libèrent le lecteur dans finally.
La création utilise un délai de lecture fixe de 10 s ; l'OCR est configurable.

Les images OCR doivent avoir un conteneur PNG/JPEG/WebP cohérent, une largeur et
hauteur non nulles <=16384 et un nombre de pixels admissible. PNG APNG et WebP
animés sont refusés. Ces contrôles de conteneur/en-tête précèdent le décodage et
n'en prouvent pas le succès ; une erreur du moteur reste une erreur, pas `{}`.
Le PDF reste accepté pour joindre une note mais son OCR est explicitement 415.

HA-02 recharge l'acteur avant lecture, puis avant mise en file : un ancien cookie
ne conserve pas de droit après suppression/désactivation. Les trois rôles actifs
restent autorisés pour leurs propres suggestions, selon l'entreprise courante.
Aucun verrou SQL n'est tenu pendant lecture, attente, Tesseract ou terminaison.
Une révocation après l'admission ne rappelle pas rétroactivement un calcul déjà
commencé ; elle n'autorise aucune création de note, qui recontrôle ses droits.

## Capacité locale et paramètres

Tous les paramètres sont des entiers décimaux. `src/instrumentation.ts` les
valide au démarrage Node et la route charge un snapshot immuable. Une valeur
invalide refuse l'initialisation, avec un message statique sans valeur reflétée.

| Variable | Défaut | Bornes / unité |
| --- | --- | --- |
| OCR_MAX_FILE_BYTES | 5242880 | 1024..10485760 octets |
| OCR_MAX_PIXELS | 12000000 | 1..32000000 pixels |
| OCR_WORKERS | 1 | 1..4 processus |
| OCR_QUEUE_LIMIT | 2 | 0..16 requêtes en attente |
| OCR_QUEUE_TIMEOUT_MS | 3000 | 100..10000 ms d'attente |
| OCR_TASK_TIMEOUT_MS | 20000 | 100..60000 ms, init+langue+reconnaissance |
| OCR_IDLE_TIMEOUT_MS | 30000 | 100..300000 ms d'inactivité avant arrêt |
| OCR_BODY_TIMEOUT_MS | 10000 | 100..30000 ms de lecture du corps |

Un processus Node enfant réutilisable par slot contient Tesseract et son
worker_thread. Le parent possède immédiatement le ChildProcess, avant que
createWorker ne résolve. Un timeout/abort/échec de protocole tue ce processus et
**attend son événement exit/close avant libération du slot**. Cela arrête aussi
ses threads, même pendant initialisation ou chargement de langue. Une exception
de kill garde la capacité en quarantaine, jamais faussement disponible. Le parent
ne transmet aucun secret d'application/base/S3, désactive l'héritage execArgv et
ignore stdout/stderr du moteur pour éviter la fuite d'exception ou de contenu.
Le child quitte aussi à la déconnexion IPC de son parent.

Les workers sains sont réutilisés et arrêtés après inactivité. La file FIFO et
son délai sont bornés, l'abandon d'une requête en attente retire son buffer. Le
délai actif commence avant l'envoi du premier job et inclut initialisation,
langue et reconnaissance ; il ne s'ajoute pas silencieusement par phase. La
terminaison effective peut ajouter un court délai système après l'expiration ;
un Promise.race qui laisserait le calcul continuer n'est pas utilisé.

Ces bornes concernent **un pool dans un processus Node**. Plusieurs instances
multiplient la capacité ; il n'y a ni file distribuée ni limite de débit globale.
Les requêtes HTTP concurrentes en cours de lecture ne font pas partie de la file
OCR : leurs enveloppes sont bornées individuellement, pas leur nombre global.
Configurer admission/concurrence HTTP au déploiement selon la mémoire disponible.
Le `--max-old-space-size=256` du child borne seulement le heap V8, pas la mémoire
WASM/native/RSS ; le poids/pixels, la concurrence et le timeout sont les bornes
applicatives, pas un cgroup mémoire inventé.

## Réponses et exploitation

Toutes les erreurs OCR utilisent HA-07, requestId compris. Le DTO de succès reste
facultatif (`amount`, `expenseDate`, `description`) ; `{}` signifie désormais
**analyse réussie sans suggestion exploitable**, y compris ambiguïté du parseur.

| Statut | Code partagé / sens |
| --- | --- |
| 400 | validation : multipart/image/champ invalide |
| 401/403 | acteur absent/inactif ou droits invalides |
| 408 | request_timeout : lecture du corps trop lente |
| 413 | payload_too_large ou ocr_image_too_large |
| 415 | unsupported_ocr_media : format non image / PDF |
| 499 | request_aborted : annulation ; le client déconnecté peut ne pas recevoir la réponse |
| 502 | ocr_failure : moteur/décodage/processus défaillant |
| 503 | ocr_busy : file pleine ou attente expirée |
| 504 | ocr_timeout : durée active expirée et processus arrêté |
| 500 | panne d'infrastructure imprévue assainie |

L'UI existante affiche l'erreur et conserve les valeurs saisies ; aucun retry OCR
automatique ni job durable n'est ajouté. Les clients doivent accepter ces statuts
et Problem Details au lieu de déduire qu'un 200 vide masque toute panne. Cette
rupture et la migration des erreurs précoces expliquent la **version majeure 3** ;
v2.2 reste archivée et le validateur courant charge v3 exclusivement.

L'exécution `npm start` depuis la racine nécessite `scripts/leandro/LE-05/ocr-worker.mjs`,
`tessdata/fra.traineddata` (ou l'archive existante) et les dépendances externes
Tesseract/core/worker-thread dans node_modules. Le build de production et les
tests utilisent ce parcours. Un empaquetage minimal/standalone doit explicitement
emporter ces ressources et conserver le cwd ; aucun support standalone absent
de la configuration actuelle n'est revendiqué. Pas de téléchargement de langue
à chaque requête : le langPath est le dossier local versionné, cache désactivé.

## Mesure et décision

`node scripts/leandro/LE-05/measure.mjs` traite trois fois les huit images
synthétiques LE-04, avec un seul processus réutilisé. Sa sortie agrégée ne contient
ni texte OCR ni reçu personnel. Elle mesure RSS parent/enfant, durée, pic de
workers et retour à zéro après fermeture ; la RSS inclut les threads de l'enfant,
le pic entre deux échantillons n'est pas mesuré. Résultats dans la preuve LE-05.
`ocrCapacity()` expose uniquement des compteurs bornés sans identifiant et n'est
pas une route publique. LE-08 peut l'exploiter sans scraper du contenu sensible.

Décision (C1–2/C3) : isoler le moteur dans un processus possédé rend son arrêt
possible dès l'initialisation et amortit le chargement avec réutilisation. L'API
createWorker actuelle ne rend le worker qu'après ses phases d'initialisation ;
une simple course de promesses ou l'appel de terminate sur un worker encore
inaccessible ne suffit pas. Une file distribuée ou un broker n'est pas nécessaire
pour ce ticket ; LE-06 évaluera séparément le besoin asynchrone sur les mesures.

Décision LE-06 du 23 octobre : [conserver le synchrone borné](adr/LE-06-bounded-ocr.md),
avec campagne reproductible, limites et conditions de réexamen. Cette décision
ne livre aucun job durable et ne fixe aucun SLO de production.
