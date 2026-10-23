# LE-05 — Preuves du 23 octobre 2026

Base main `0dd9476aca5263022d43a94fc17436e1594a1cbe`. Le SHA du head et le commit
de fusion sont consignés dans la PR liée à ARLA-23. Diff relu, aucun package,
workflow, script npm ou support de test partagé modifié.

## Validation complète

Node 24.19.0 : **520 unitaires, 147 API, 13 E2E**, tous passés sans retry.
Lint/typecheck/collecte, services PostgreSQL/LocalStack jetables, préparation,
build de production, API, navigateur et cleanup : tous code de sortie 0.
OpenAPI v3 validé contre le schéma officiel OpenAPI 3.0 ; `git diff --check` propre.

Commande : `node /tmp/arla-le10-ci-webpack.mjs` avec PATH Node24 et npm_execpath
explicites. Cette copie extérieure du runner utilise ses mêmes modules de
support et ne change que l'option `--webpack` du build : la restriction IPC locale
empêche Turbopack. GitHub Actions est désactivé sur le dépôt ; **aucune CI distante
verte ou relecture humaine indépendante n'est revendiquée**. Le nettoyage des
services/processus propres à la validation a réussi.

## Scénarios

Les tests unitaires nouveaux couvrent les octets effectivement lus avec en-tête
absent, faux inférieur et invalide, refus déclaré précoce, multipart borné,
lecture bloquée et annulation. Les tests utilisent de vrais Request/ReadableStream,
pas un mock qui retourne simplement un formData déjà alloué. Les limites pixels
et conteneurs sont vérifiées sur PNG/JPEG progressif/WebP avec/sans perte réels.
Les valeurs de configuration invalides sont refusées sans réflexion du contenu.

Le pool est testé avec des processus possédés réels : réutilisation du même PID,
concurrence et file bornées, attente expirée, annulation en file et en cours,
initialisation bloquée, thread imbriqué bloqué, sortie/erreur, fermeture et arrêt
après inactivité. Le PID ancien doit être réellement absent avant la reprise.
Une exception de terminaison conserve le slot en quarantaine ; le test restaure
puis arrête uniquement ce processus. Ces workers synthétiques démontrent la
mécanique OS, distinctement de la reconnaissance réelle ci-dessous.

Les tests de route sur doubles vérifient le rechargement d'acteur avant lecture
et avant admission, aucun travail sur refus/révocation, absence de verrou SQL
pendant le calcul, et les codes distincts 499/502/503/504 au lieu d'un succès vide.
Le pont de parseur LE-04 conserve toutes ses assertions de résultat, son double
porte désormais sur le pool réutilisable au lieu d'exiger un nouveau worker par
appel. Les autres tests LE-04, dont corpus réel et huit réponses HTTP, passent.

Huit nouveaux tests API utilisent de vraies sessions Auth.js/PostgreSQL et Next
production :

- Vraie image française avec suggestions, puis vraie image vide : 200 `{}`
  uniquement pour une analyse réussie sans suggestion.
- PDF réel : 415 ; fichiers vide, incohérent, dupliqué, trop gros : refus explicite.
- **Flux HTTP chunked réellement sans Content-Length**, OCR >5 MiB et création
  >10 MiB : 413 Problem Details reçu, aucune note. Le test exige la vraie réponse,
  jamais EPIPE/socket fermé comme résultat acceptable. La lecture cesse à la borne
  et la connexion se ferme après l'envoi, pour éviter qu'une annulation immédiate
  d'IncomingMessage coupe la réponse avant le client.
- Requête HTTP volontairement inachevée : 408 au délai de lecture.
- Trois requêtes concurrentes, capacité un et file zéro, délai 100 ms : deux 503,
  un 504 pendant la vraie initialisation Tesseract ; requête suivante à nouveau
  admise puis 504, prouvant la libération après arrêt et non un busy permanent.
- Compte supprimé/inactif avec ancien cookie : 401 ; changement courant de rôle
  et d'entreprise : parcours autorisé en manager puis RH.
- JPEG structurellement borné mais décodage invalide : vrai 502 moteur, puis vraie
  image valide 200 et suggestions correctes depuis le pool rétabli.

La longueur mensongère inférieure est testée directement au niveau Request : un
serveur HTTP applique aussi ses propres règles de framing, qui ne doivent pas
être contournées par un faux Content-Length réseau. L'absence de longueur est
prouvée sur le réseau réel. Le framing HTTP malformé n'est pas un scénario de
request-smuggling livré par ce ticket.

## Mesure de ressources

Commande : `node scripts/leandro/LE-05/measure.mjs`, Node24. Les trois passages
des huit images synthétiques donnent **24 analyses en 1885 ms**, pic un processus,
RSS enfant échantillonnée maximale **165445632 octets** (~157.8 Mio), parent
**52117504 octets** (~49.7 Mio). Après fermeture : zéro worker/actif/file/RSS enfant.
Données : [resource-measure.json](LE-05/resource-measure.json).

Ces échantillons incluent init et reconnaissance de ce corpus local, pas un SLA,
un maximum absolu de mémoire, une charge multi-instance ou un benchmark de reçus
personnels. Le heap V8 n'est pas toute la RSS/WASM. Le détail des limites par
requête/pool/processus et du packaging se trouve dans
[le contrat de ressources](../ocr-resource-limits.md).

## Adaptations nécessaires

La lecture bornée est réutilisée par LE-01 en création pour couvrir le point de
matérialisation restant ; le DTO et les validateurs LE-01 restent inchangés. Les
codes statiques sont ajoutés au seul catalogue HA-07 ; aucun helper DB ni cas
d'usage HA-03 modifié. L'instrumentation Next vérifie la configuration au démarrage,
les deux route files appliquent la fermeture contrôlée des uploads refusés.
OpenAPI v2.2 reste une archive ; v3 et les tests courants publient la rupture PDF/
échecs OCR explicites et les nouvelles erreurs de lecture. L'UI et les runners
restent aux propriétaires actuels.
