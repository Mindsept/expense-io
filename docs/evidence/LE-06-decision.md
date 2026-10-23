# LE-06 — Mesures et décision du 23 octobre 2026

[ADR et comparaison](../adr/LE-06-bounded-ocr.md),
[ticket ARLA-24](https://mindsept.atlassian.net/browse/ARLA-24).

## Source et expérience

Le script a été commité avant exécution :
`139c848a92d4f7f1ca7fdc5eaac4fa41ad5e0514`, base main `eceb158`.
Commande réelle `node scripts/leandro/LE-06/measure.mjs`, code de sortie **0**, avec
Node **24.22.1** et npm **11.19.1**, macOS arm64. Le JSON versionné
[resource-measure.json](LE-06/resource-measure.json) conserve ce SHA et les SHA256
du pool et du worker réels. Ce commit demeure dans l'historique ; LE-07 a ensuite
été intégré à la branche par merge, sans réécrire la provenance de l'expérience.

Soixante-douze demandes sur le corpus synthétique de huit images : **60 succès,
12 refus de saturation**, aucun timeout, abandon ou échec moteur. À concurrence
1 et 3 : 24/24 réussissent dans chaque scénario. À concurrence 6 : 12/24
réussissent, 12 sont refusées. Les deux slots d'attente et l'unique worker restent
bornés ; après chaque fermeture, tous les compteurs d'occupation sont à zéro.
Les refus ne sont pas inclus dans les percentiles de succès. Le script échoue si
un processus ou une attente subsiste, si les bornes sont dépassées, ou en cas
d'échec moteur/abandon de l'expérience. La borne globale d'annulation de scénario
complète les délais de la file et des tâches.

Il s'agit du vrai pool et du vrai moteur Tesseract en processus enfant, pas d'un
double qui répond immédiatement. Il ne s'agit **pas** d'une campagne HTTP, d'une
preuve de débit soutenu, de charge de production ou d'isolation SQL/S3. Le script
n'appelle aucun serveur, ne crée aucune note et ne persiste aucun reçu. Son
résultat n'enregistre ni texte reconnu ni identifiant personnel. Les durées,
ressources échantillonnées et limitations sont détaillées dans l'ADR.

## Décision et périmètre

Conserver le contrat HTTP synchrone borné pour l'aide facultative actuellement
livrée. Le résultat attendu et l'étape 8 du ticket autorisent cette conclusion
avec mesures et compromis. Les états et tests conditionnels de jobs ne sont
pas applicables : aucun job, 202, polling, reprise durable ou nouveau service
n'est annoncé comme implémenté. Une interruption peut perdre le calcul.

PO-01 ne fixe pas de volume/SLO OCR et réserve un arbitrage spécifique au besoin
asynchrone. Cette absence est explicite, pas présentée comme un accord produit
ou une recette de capacité. Un besoin confirmé de continuation après déconnexion
ou redémarrage, ou une inadéquation mesurée à un SLO défini, doit faire réexaminer
la décision. La clarification posée à Leandro n'est pas supposée approuvée.

Diff : script d'expérience, résultat agrégé, ADR, présente preuve et lien depuis
le contrat de ressources. Aucun code applicatif, schéma, droit SQL, dépendance,
workflow, runner partagé ni écran modifié. Aucun test artificiel ajouté pour
recopier le contenu d'une ADR ; les comportements du pool et de la route restent
exercés par les tests existants LE-04/05/08.

## Validation

Pipeline standard local `npm run test:ci`, après merge de main `bafa33c` :
**652 unitaires, 223 API, 19 E2E**, tous passés. Lint/types/collecte, services
jetables, préparation, build Turbopack, API, navigateur et nettoyage : tous les
codes de sortie à zéro. [Résumé assaini](LE-06/ci-summary.json). `git diff --check`
propre. Le résumé qualifie la base générale de bootstrap privilégié : sa réussite
ne vaut pas à elle seule preuve RLS. Les suites HA-04 et LE-07 dédiées utilisent
séparément le vrai rôle restreint. L'expérience OCR n'a aucun accès base.

La PR et le commentaire Jira de clôture consignent le head validé, le résultat
de la CI distante et le SHA de fusion. Aucune relecture humaine indépendante
n'est revendiquée par les tests automatisés.
