# LE-06 — Conserver l'OCR synchrone borné

Décision technique du 23 octobre 2026, [ARLA-24](https://mindsept.atlassian.net/browse/ARLA-24).
Le ticket autorise explicitement sa clôture sur une décision négative mesurée.
La variante de jobs durables n'est pas retenue pour le comportement livré.

## Problème et contexte

`POST /api/expense-notes/receipt-suggestion` aide à préremplir une note. L'utilisateur
peut saisir ses champs sans OCR ; la suggestion ne crée ni ne valide une note.
La page `src/app/expenses/page.tsx` ignore les réponses obsolètes et préserve les
champs édités pendant l'analyse. LE-05 a isolé Tesseract dans un processus réutilisable dont
l'arrêt est effectif, avec une file et des délais bornés. « Synchrone » décrit
ici la durée de vie de la requête HTTP, pas un calcul bloquant dans le thread
JavaScript du serveur.

[PO-01](https://mindsept.atlassian.net/browse/ARLA-6), relu le 23 octobre, ne fixe
aucun volume, SLO OCR ou besoin de reprise après redémarrage. Il réserve un
arbitrage spécifique à la variante asynchrone. Cette ADR tranche le choix
technique conservateur sur le périmètre existant ; elle ne constitue ni une
approbation produit de cette variante ni une validation de capacité en production.
Une clarification a été demandée à Leandro sur le besoin de continuation après
déconnexion/redémarrage ; aucune réponse n'est supposée acquise.

## Mesures reproductibles

Source exécutée : `139c848a92d4f7f1ca7fdc5eaac4fa41ad5e0514`, Node 24.22.1,
macOS arm64. Commande depuis la racine :

```sh
node scripts/leandro/LE-06/measure.mjs
```

Huit images synthétiques LE-04, 24 demandes par scénario, par vagues de concurrence
fixe. Chaque scénario crée un pool froid : un worker, deux places d'attente,
attente 3 s, analyse 20 s, inactivité 30 s. Le temps d'une analyse réussie inclut son
attente et, si nécessaire, l'initialisation. La sortie ne contient aucun texte
OCR ni reçu personnel. [Résultat brut](../evidence/LE-06/resource-measure.json).

| Concurrence locale | Succès / demandes | Refus busy | Durée totale ms | p50 / p95 succès ms | Pic RSS enfant échantillonné octets |
| --- | --- | --- | --- | --- | --- |
| 1 | 24 / 24 | 0 | 2158 | 64 / 101 | 145883136 |
| 3 | 24 / 24 | 0 | 2131 | 156 / 400 | 163479552 |
| 6 | 12 / 24 | 12 | 1040 | 159 / 453 | 161169408 |

Chaque scénario reste à un worker actif et au plus deux demandes en attente.
Après fermeture : zéro worker, actif, attente et processus en arrêt. Aucun
timeout ni échec moteur observé dans ces trois passages. Les refus de saturation
restent des refus, exclus des percentiles de succès. La capacité débordée n'est
donc pas un succès rapide. Les échecs moteur, arrêts, annulations et délais sont
vérifiés séparément par les tests LE-05, décrits dans sa preuve.

Ce petit corpus chaud/froid ne représente pas les photos réelles, un débit
continu, le réseau, le multipart, l'authentification, le démarrage Next ou une
charge multi-instance. Le pic RSS est échantillonné, pas une limite absolue.
La résolution du moniteur de boucle parent est 10 ms : ce n'est pas une mesure
de réactivité HTTP sous charge. Ces observations ne fixent aucun SLA et ne
remplacent pas le benchmark HTTP MATH-05. Le volume produit absent reste à définir.

## Choix et compromis

| Aspect | Requête actuelle bornée — retenue | Job durable — alternative écartée à ce stade |
| --- | --- | --- |
| Expérience | Suggestion immédiate ou erreur explicite ; saisie manuelle disponible | Retour 202 puis suivi d'état et reprise du suivi dans l'UI |
| Déconnexion / redémarrage | Travail annulable, pas de promesse de conservation ; utilisateur relance si nécessaire | Travail persistant et récupérable, si c'est un besoin produit confirmé |
| Saturation | Admission locale explicite ; 503 lorsque la capacité est épuisée | Une file absorbe temporairement la pointe ; quotas, vieillissement et capacité de consommation restent nécessaires |
| Exploitation | Pool local existant, arrêt réel, délais et compteurs déjà livrés | Stockage durable du reçu, table/jobs, worker supervisé, récupération après crash et nettoyage |
| Cohérence / accès | Acteur courant avant lecture et admission ; aucune note créée par OCR | Propriété acteur/entreprise, droits de consultation/annulation, idempotence et livraison au moins une fois à définir et tester |
| Coût | Garde la connexion pendant l'analyse et limite la capacité par instance | Ajoute polling, transitions, retries/backoff, déduplication et rétention ; ne rend pas la reconnaissance moins coûteuse |

Les mesures montrent une enveloppe locale utile avec saturation contrôlée ; elles
ne démontrent ni une capacité illimitée ni la nécessité de conserver des tâches.
Ajouter une file durable à la seule lecture d'un cours déplacerait le problème
sans établir le besoin. Le choix réduit l'état et l'exploitation supplémentaires
pour cette aide facultative. Le cours C1–2 s37–40,48 / C3 s19–21,28 motive l'étude
du compromis ; il n'impose ni broker ni architecture distribuée.

## Conséquences et réouverture

Le contrat reste une réponse finale 200 contenant des suggestions facultatives ;
`{}` signifie uniquement une analyse réussie sans suggestion. Les erreurs LE-05
restent distinctes : notamment 503 saturation, 504 délai actif, 502 moteur, 499
annulation. Aucun 202, jobId, polling, reprise après crash, table ou broker n'est
livré. EL-03 continue d'utiliser son comportement actuel de protection contre les réponses obsolètes
et de saisie manuelle ; aucune fixture de suivi de job ne lui est nécessaire.

Les limites restent celles de [LE-05](../ocr-resource-limits.md) : corps et pixels
bornés, capacité par processus, timeout et arrêt réel ; la concurrence HTTP
globale et la mémoire totale nécessitent un réglage du déploiement. L'absence de
durabilité est un compromis explicite : une interruption peut perdre le calcul.

Réouvrir cette décision si le PO confirme une continuation après déconnexion ou
redémarrage, si des reçus représentatifs dépassent le budget d'attente fixé, ou
si la latence et les 503 mesurés en HTTP dépassent un SLO produit défini. Fixer
d'abord charge, budget, rétention et droits ; comparer alors le minimum durable
(par exemple table PostgreSQL et worker) au besoin, avec reprise, doublons et
isolation réelle. Ces conditions sont des critères de réexamen, pas des seuils
de production inventés. La clarification ouverte peut conduire à ce réexamen.
