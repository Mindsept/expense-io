# Démonstration relançable — ARLA-41 / MATH-03

Responsable : Mathis. Relecture du script et des droits : Hamza ; parcours : Hugo. Ce guide concerne **uniquement une démonstration fictive jetable**, distincte de la base personnelle de développement. Aucun correctif de route, policy, migration ou privilège métier n'est livré ici.

## Prérequis et cible

- Node **24.22.1**, npm **11.19.1** (versions du dépôt), installation complète des dépendances avec `npm ci` ; le compilateur TypeScript déjà présent sert seulement à charger le contrat de soumission existant dans l'outil local.
- Docker Compose et un Docker local accessibles. Ports loopback dédiés libres : **3215** application, **3216** réservé, **55440** PostgreSQL, **45740** S3. Aucun processus occupant ces ports n'est arrêté automatiquement.
- PostgreSQL 16 et LocalStack 3.8.1 fournis par `docker-compose.test.yml`. La préparation réutilise MATH-02, son précontrôle et ses labels ; aucun Compose de développement modifié.
- Démarrer les commandes à la racine du dépôt. Les commandes Node/npm/Docker ci-dessous sont les mêmes sous Bash et PowerShell. Le Makefile historique dépend de Bash : **`make dev` n'est pas une commande PowerShell native** et n'est pas la procédure validée par ce guide. Ses adaptations restent à coordonner avec Hugo.

Les clients DB de maintenance et le serveur sont distincts. L'outil prépare avec l'administrateur de sa nouvelle stack ; le serveur reçoit seulement le LOGIN **expense_web**, provisionné avec le helper HA-04 d'Hamza. Il ne reçoit aucune URL admin/migration, mot de passe bootstrap ou variable SEED. Le garde HA-04 reste actif. Les fichiers `.env` personnels ne sont pas écrits ; Next peut lire les fichiers habituels mais les paramètres critiques DB/S3/auth sont explicitement injectés et prioritaires.

## Lancer une démonstration neuve

Commandes communes aux deux shells :

```sh
node --version
npm --version
npm ci
npm run demo:prepare
npm run demo:start
```

`demo:prepare` crée un projet aléatoire `arla-ci-demo-<id>`, une base `expense_io_test`, le bucket `receipts-ci-test`, trois comptes et deux notes complètes avec PNG. Il applique les migrations et construit la production. Il refuse une préparation déjà active plutôt que d'écraser ses données. Le serveur est ensuite disponible sur **http://127.0.0.1:3215** ; `Ctrl+C` arrête uniquement le serveur de cette commande et conserve les données.

Identités fictives : `employee@expense.test`, `manager@expense.test`, `hr@expense.test`. Les mots de passe sont aléatoires par stack et ne sont jamais affichés. Pour la connexion manuelle, ouvrir localement le fichier privé `.ci-output/demo/seed.json` dans un éditeur : valeurs `SEED_EMPLOYEE_PASSWORD`, `SEED_MANAGER_PASSWORD`, `SEED_HR_PASSWORD`. Ce fichier contient aussi la connexion de maintenance ; ne pas l'insérer dans les preuves ou les captures. Les fichiers sont ignorés par Git et créés avec droits privés Unix ; sur Windows, conserver les ACL privées du dossier utilisateur.

## Trois opérations distinctes

| Intention | Commande | Effet |
| --- | --- | --- |
| Initialiser le manquant | `npm run seed -- --config <chemin-absolu-privé>` | Crée seulement comptes/notes absents ; préserve tous les attributs des comptes existants et les reçus sains. |
| Réparer les notes de démo identifiées | `npm run seed:repair -- --config <chemin-absolu-privé>` | Répare seulement une clé vide ou l'objet fictif attendu absent ; ne crée pas de nouveaux comptes/notes et ne remet pas les statuts à pending. |
| Réinitialiser la stack jetable | `npm run demo:reset -- --confirm-disposable` | Après arrêt du serveur, contrôle cible et labels, supprime seulement ses volumes, puis prépare une nouvelle stack et de nouveaux secrets. |

### Bash : relancer deux fois, puis réparer si nécessaire

Dans un second terminal, avec le runtime épinglé :

```bash
demo_config="$PWD/.ci-output/demo/seed.json"
npm run seed -- --config "$demo_config"
npm run seed -- --config "$demo_config"
# Seulement lorsqu'un reçu marqué est incomplet :
npm run seed:repair -- --config "$demo_config"
```

### PowerShell : commandes distinctes pour le chemin privé

```powershell
$demoConfig = Join-Path (Get-Location).Path '.ci-output\demo\seed.json'
npm run seed -- --config "$demoConfig"
npm run seed -- --config "$demoConfig"
# Seulement lorsqu'un reçu marqué est incomplet :
npm run seed:repair -- --config "$demoConfig"
```

La procédure PowerShell a été exécutée nativement le 26 octobre 2026 : préparation, deux relances sans doublon ni upload, 11 scénarios API sur PostgreSQL/LocalStack réels, démarrage du serveur et connexions HTTP des trois rôles. Voir [la qualification Windows](evidence/MATH-03/windows-20261026.json). Les fonctions de gestion des processus réutilisent le helper commun MATH-02. Cette campagne assistée ne vaut pas une approbation personnelle d'Hugo ni le passage du guide par un autre membre humain.

Après une préparation neuve : **3 comptes / 2 notes / 2 objets**. Les deux relances doivent annoncer `usersCreated:0`, `notesCreated:0`, `receiptsUploaded:0`, tout en conservant un rattachement/nom/rôle/mot de passe modifié. Les personnes et notes ajoutées manuellement restent présentes : les totaux peuvent donc augmenter après une démo métier et le script ne les remet pas arbitrairement à trois/deux.

## Parcours trois rôles

1. Employé : se connecter, consulter sa note et son PNG ; soumettre si souhaité une autre note avec un justificatif fictif.
2. Manager : se connecter, retrouver la note de l'employé rattaché, ouvrir le reçu puis décider. L'initialisation ultérieure ne rétablit pas un ancien rattachement.
3. Employé : retrouver la décision ; RH : se connecter et consulter la note du manager racine et son reçu. Les droits actuels sont ceux d'Hamza et Leandro ; le seed ne les redéfinit pas.

Pour revenir à un état de départ identique, arrêter `demo:start` puis choisir explicitement le reset. Un simple `seed` ne remet ni décisions ni organisation à zéro.

## Identification et reprise DB/S3

Les nouveaux objets sont identifiés par **acteur démo vérifié dans son entreprise + marqueur exact `[ARLA:MATH-03:v1:ROLE]` + UUID stable dérivé de cet acteur**. Une description ressemblant à Taxi ne suffit pas. Plusieurs candidates, une identité dans une autre entreprise ou une clé inattendue provoquent un refus avant mutation de reçu. Les anciens textes `(seed)` dépourvus du nouveau marqueur demandent une revue humaine : aucune adoption, fusion, suppression ni duplication automatique.

L'initialisation réutilise le cas d'usage **SubmitExpense de LE-02**, avec un adaptateur de maintenance limité à ces fixtures : upload avant insertion complète, référence UUID et conservation prudente en cas de COMMIT incertain. Aucun état de note « incomplète » ajouté à l'application. Un verrou consultatif de session évite deux initialisations de la même démo ; aucune transaction SQL n'est maintenue pendant S3.

| Interruption constatée | État durable possible | Reprise |
| --- | --- | --- |
| Avant upload d'une nouvelle note | Comptes présents, note absente | Relancer `seed` ; aucun compte réécrit. |
| Après PUT avant insertion complète | Objet fictif présent, note absente | Même clé stable ; `seed` contrôle et réutilise le PNG, puis insère la note une seule fois. |
| Accusé de COMMIT perdu | Note possiblement complète, reçu conservé | Relancer `seed` ; relecture de la note avant toute nouvelle insertion. |
| Ancienne note marquée : clé vide ou objet absent | Note déjà présente | `seed` demande `seed:repair`. La réparation remet seulement le PNG attendu et la clé manquante. |
| Réparation interrompue après PUT avant clé | Objet présent, clé vide | `seed:repair` contrôle le PNG puis enregistre la clé sans réuploader ni dupliquer. |

Ces garanties portent seulement sur les deux fixtures identifiées ; elles ne remplacent pas le registre applicatif LE-03 ni sa réconciliation. SQL et S3 ne forment pas une transaction distribuée. Les compensations ne retirent jamais un objet référencé ; si la référence SQL ne peut pas être vérifiée, l'objet est conservé et le passage échoue. Aucun nettoyage général d'objets orphelins proposé ici.

## Diagnostics et conditions d'arrêt

- Sortie **0** : opération terminée ; compteurs uniquement. Sortie **1** : échec/refus visible ; aucune exception brute ni URL de connexion publiée.
- `explicit_configuration_required` : fournir `--config` avec le chemin absolu privé. Pas de chargement automatique de `.env`, pas de fallback vers le `DATABASE_URL` web.
- `non_demo_database` / `non_demo_storage` : cible refusée avant accès aux services. La configuration doit désigner une base de test autorisée, un port dédié et un bucket de test loopback ; la confirmation de nom doit correspondre. Les bases `expense_io` de développement sont refusées.
- `storage_access_denied` : 401/403, arrêter et vérifier les droits ; aucune tentative de création ou de reconstruction sur cette erreur.
- `storage_unavailable` : trois tentatives maximum, chacune bornée à trois secondes, puis échec. Contrôler le Docker local ; ne pas ouvrir les ports réseau pour contourner la panne.
- `bucket_missing_run_ensure_bucket` : le bucket est absent ; lancer séparément `npm run ensure-bucket -- --config <chemin-privé>`. Cette commande crée seulement après un vrai 404, puis revérifie. Un bucket déjà créé concurremment est revérifié avec authentification.
- `unexpected_demo_object`, `unrecognised_demo_note`, `ambiguous_demo_notes`, `legacy_demo_requires_review` : arrêter et faire examiner les candidates par Hamza. Aucun écrasement automatique.
- `foreign_demo_identity` : l'adresse existe dans une autre entreprise ; ne pas déplacer le compte. Corriger le choix de cible/configuration, pas ses droits.
- `receipt_incomplete_run_seed_repair` : relancer explicitement en réparation après avoir rétabli S3.

Budget coopératif de seed/réparation : 60 secondes, commandes et lecture S3 bornées à trois secondes et SQL à cinq secondes. Une dernière phase SQL déjà lancée peut dépasser le budget de cinq secondes au maximum. Les clients CLI et connexions sont fermés sur succès/échec. La construction de démo est bornée à 240 secondes, Docker à 180 secondes. Un démarrage interrompu conserve sa configuration privée lorsque le nettoyage ne peut pas être confirmé.

## Arrêter et nettoyer

`Ctrl+C` dans le terminal `demo:start` conserve la stack. Pour retirer **uniquement cette stack jetable et ses données fictives** :

```sh
npm run demo:down -- --confirm-disposable
```

Sans confirmation explicite, la commande refuse. Avec un port applicatif encore occupé, elle refuse sans arrêter un autre processus. Elle réutilise le précontrôle MATH-02, vérifie les labels et ne supprime ni les volumes de développement ni les autres projets Docker. `make clean` n'est pas la procédure de reset de ce guide.

## Vérifications et réception humaine

```sh
npm run test:unit -- tests/unit/mathis/MATH-03
npm run test:ci
```

`test:tooling` est un alias des tests API MATH-03 ; l'exécuter seul demande la configuration de la stack MATH-02. `test:ci` prépare cette configuration et collecte aussi ces cas dans la suite API normale. Les tests unitaires simulent notamment 403/503 et les cibles interdites. Les tests API utilisent PostgreSQL et LocalStack réels ; les interruptions entre étapes sont **injectées par un callback de test**, sans option de panne exposée dans le CLI. Le résultat n'est pas présenté comme une coupure physique de machine.

Preuves et environnement : [dossier MATH-03](evidence/MATH-03/README.md). Le suivi doit distinguer les vérifications exécutées, la revue Hamza, le parcours Hugo et le passage d'un autre membre sur base vierge. Aucun de ces contrôles humains n'est validé automatiquement par les tests.
