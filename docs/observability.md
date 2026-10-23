# LE-08 — Corrélation et mesures sans contenu métier

Ticket : [ARLA-26](https://mindsept.atlassian.net/browse/ARLA-26), base main
`2f77990` après LE-05. Pas de plateforme, fournisseur externe, endpoint public,
package ou migration supplémentaire. Le contrat HTTP reste OpenAPI v3.0.

## Du message à la cause

HA-07 reste l'autorité de corrélation : un X-Request-Id UUID valide est normalisé,
sinon remplacé ; le même identifiant est dans l'en-tête et le Problem Details.
Le helper client existant ajoute `Référence : <UUID>.` au message déjà affiché,
uniquement si cet en-tête contient un UUID valide. Les messages sûrs 401/403/5xx
et les valeurs de formulaire conservées restent inchangés. Une panne réseau sans
réponse ne reçoit pas un identifiant fictif.

Les événements de phases de Leandro réutilisent cet ID et le canal console JSON
existant. Le seul ajout de schéma est `expense.phase.v1`, avec opération, durée,
résultat, code statique, tentative et éventuellement capacité OCR. L'adaptateur
n'accepte ni exception ni corps de requête. Les observateurs HA-07 et HA-03
alimentent l'agrégateur **sans réémettre leurs événements**, déjà journalisés par
ces modules. Il n'y a pas un second logger HTTP ni un transport concurrent.

| Opération | Codes internes statiques / couverture |
| --- | --- |
| expense-notes.submit / list / receipt-suggestion | Événements HTTP natifs HA-07 ; compteurs/latences des trois handlers personnels |
| storage.upload / storage.remove | success, storage_upload_failed, storage_delete_failed ; upload de création et compensation LE-02/03 |
| expense.persist | success, persist_not_committed, persist_commit_unknown ; transaction complète, COMMIT inclus |
| ocr.recognize | ocr_suggested, ocr_empty, ocr_timeout, ocr_busy, ocr_failed, request_aborted |
| DecideExpense | decision_success, decision_conflict, decision_denied, decision_error ; hook et événement natifs HA-03 après fin de transaction |

`attempt: 1` désigne une invocation du traitement mesuré, sans retry automatique
ajouté par LE-08. Ce n'est ni le nombre d'essais internes AWS SDK ni l'ordinal
historique d'une clé idempotente ; ces valeurs ne sont pas fournies par leurs
interfaces. Les IDs client, UUID de reçu, UUID de note, acteur et entreprise ne
sont jamais des labels de métriques. Le journal LE-02 de références de nettoyage
reste distinct ; l'export LE-08 l'ignore, il ne copie pas ses références.

Les erreurs de stockage ont leur phase/cause technique bornée, sans message AWS,
URL ou clé d'objet. La persistance distingue rollback certain et commit incertain.
Ce diagnostic indique la phase et la catégorie, pas la cause SQL brute. Les
présignatures de lecture, jobs de maintenance privés, notifications et phases
SQL des autres propriétaires ne sont pas inventés comme instrumentés : ils ont
leurs enveloppes HTTP actuelles ou leur diagnostic propre. Ne pas déduire un
profil SQL exhaustif d'un total de transaction.

## Composition et propriété

`src/application/observed-decide-expense.ts` compose le hook `observe` publié par
HA-03. Les quatre handlers approve/reject manager/RH changent **uniquement leur
import** vers cette composition ; ni leur logique ni le cas d'usage HA-03 ne
changent. Les deux fichiers de routes personnels passent l'observateur à HA-07.
`lib/errors.ts`, `lib/db.ts` et `application/decide-expense.ts` sont inchangés.

Le seul point UI partagé adapté est `utils/client-errors.ts` : ajout de la
référence validée au message existant, nécessaire à la preuve utilisateur. Aucun
écran ou parcours de validation n'est réécrit. Ces raccordements étroits hors des
modules d'instrumentation détenus par Leandro sont justifiés dans la PR, sans
ajouter de fonctionnalité métier aux modules d'un autre auteur.

## Agrégation bornée

`ObservationRegistry` reconstruit les données à partir d'allowlists. Opérations,
codes et résultats ont un domaine fini (moins de cent combinaisons actuellement),
pas une Map indexée par requestId. Mille IDs uniques gardent une seule série pour
la même opération/code. Les champs arbitraires et labels inconnus sont ignorés.
Chaque série a count, somme de durées et histogramme cumulatif fixe en ms :
10, 50, 100, 500, 1000, 5000, 20000, 60000, 300000. Une durée >300s est comptée avec
valeur plafonnée et `durationCapped: true` dans l'événement exporté, jamais perdue
silencieusement. Les sommes/compteurs saturent à MAX_SAFE_INTEGER ; aucun tableau
par requête n'est conservé dans le processus.

Les jauges workers/active/queued/stopping sont échantillonnées à la fin des phases
OCR, y compris saturation/timeout. Elles décrivent cet instant, pas un maximum
continu ni un total global multi-instance. Le pool propose aussi ocrCapacity(),
et les mesures LE-05 prouvent séparément la réutilisation et la libération.

`observationSnapshot()` donne un snapshot privé du processus en cours : phases,
décisions et handlers personnels branchés. L'export hors processus peut aussi
agréger les événements HA-07 des autres handlers déjà présents dans son **entrée
explicite**. Une concaténation de logs de plusieurs processus additionne leurs
événements ; elle n'est pas un compteur partagé ni une garantie sans doublon si
le fichier d'entrée contient deux fois les mêmes lignes. Les redémarrages remettent
les compteurs mémoire à zéro. Les snapshots sont copiés avant restitution.

## Export local et recherche d'incident

Collecter le stdout/stderr existant vers un fichier privé selon l'environnement
d'exploitation, sans intégrer de justificatif ni nouvelle plateforme. Par exemple,
pour une session locale autorisée, avec chemin explicite et droits privés :

```sh
umask 077
npm start > /tmp/expense-io-incident.ndjson 2>&1
```

Dans un autre terminal, la commande privée ne modifie pas l'entrée et ne contacte
aucun service :

```sh
node scripts/leandro/LE-08/export.mjs --input /tmp/expense-io-incident.ndjson
node scripts/leandro/LE-08/export.mjs --input /tmp/expense-io-incident.ndjson --request-id "$SUPPORT_REQUEST_ID" --limit 20
```

`--input -` lit stdin ; aucun chargement de .env ni chemin par défaut. Le mode
agrégé omet tous les IDs. Le mode corrélation restitue seulement les événements
assainis du requestId demandé, limite 1..100, défaut20, avec indicateur truncated.
Les lignes non JSON, non reconnues ou >8192 octets sont ignorées ; la lecture par
chunks et le nombre de séries/résultats retenus sont bornés. La commande parcourt
l'entrée entière pour les compteurs, sa durée dépend donc du fichier ; elle n'est
pas un service continu. Succès : code0 ; options/lecture invalides : code1 avec
message statique qui ne révèle ni chemin, argument ni exception.

Le fichier brut peut aussi contenir des messages de framework hors contrat : il
reste privé et n'est pas rendu sûr par la simple présence de HA-07. **Partager
l'export filtré**, pas ce fichier brut. Le mode corrélation contient encore un
UUID de support, le mode agrégé l'enlève. Le test navigateur prouve qu'une vraie
panne S3 se retrouve depuis la référence effectivement affichée jusqu'au code
storage_upload_failed et au statut HTTP 500, sans nom/email/reçu/SQL/secret.

## Rétention et interprétation

Aucune rétention de production n'était définie et aucun collecteur/rotation n'est
installé par ce ticket. Le processus conserve seulement les compteurs finis et
la dernière jauge jusqu'à son arrêt. L'export n'écrit aucun fichier : l'opérateur
contrôle la destination et les droits. Les captures locales d'incident sont
temporaires, à supprimer après diagnostic ; toute conservation de production
exige une durée et un accès définis par l'équipe d'exploitation. Aucun engagement
de conservation durable, d'alerte livrée ou de récupération après crash n'est
revendiqué pour ces données de diagnostic.

Les durées utilisent performance.now(), une horloge monotone locale ; elles
incluent l'attente réelle dans le traitement mesuré. Additionner les durées de
phases et du handler compterait deux fois du travail imbriqué. Les requestIds
corrèlent des événements sans prétendre synchroniser les horloges de deux hôtes.
Les timestamps de collecte, leur rotation et les dérives d'horloge relèvent de
l'exploitation. Un histogramme local sur un corpus synthétique n'est pas un SLO
ou une mesure de percentile de production.

Actions utiles : storage_upload_failed → vérifier disponibilité/auth S3 avec la
référence, sans resoumettre aveuglément une écriture incertaine ;
persist_commit_unknown → consulter l'intention/historique avant retry ;
ocr_busy → examiner capacité/file et charge d'admission ; ocr_timeout → vérifier
ressources et corpus, saisir manuellement si nécessaire. ocr_empty est un succès
sans suggestion, pas une panne. Aucun déclenchement automatique d'alerte n'est
inventé à partir de ces catégories.

Décision (C1–2/C3) : hooks existants, canal JSON et export privé rendent les
incidents démontrables avec une cardinalité fixe. Un service de métriques externe
ou des séries par requestId augmenteraient coût et exposition sans besoin établi.
L'échec du diagnostic ne doit jamais modifier le résultat métier : callbacks,
classifieurs et transport console sont isolés ; le travail synchrone est court,
mais une console système bloquante peut encore retarder l'appel, comme HA-07.
