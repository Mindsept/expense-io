# ARLA-9 — exercice technique IA du 26 octobre 2026

**Exercice réalisé par Codex, séparé de la remise ; aucune répétition humaine
ou collective n'est revendiquée.** Branche locale
`codex/arla-rehearsal-description-counter`, depuis le candidat
`f6592bcc`. Aucun merge, publication GitHub ou changement de la cible de
recette n'a été effectué par cet exercice.

## Sujet, prompt et plan

Le sujet préparé dans `docs/po/soutenance.md` du dossier de remise est un
compteur discret de caractères restants dans la description. Il entraîne
la lecture d'un contrat existant et ne prédit pas le sujet des enseignants.

Instruction reçue : « ajouter seulement un compteur de caractères restants
description conforme à la limite 4000 UTF-16, accessible sans annonce à
chaque frappe, sans changer API, plafond ou dépendances ; vérifier vide,
saisie, plafond, Unicode, focus et conservation après erreur ; conserver
diff et preuves dans une branche séparée, budget maximal quinze minutes. »

Plan appliqué : lire le formulaire et `readExpenseInput`, ajouter l'état du
compteur et l'aide associée dans le seul composant, ajouter trois scénarios
DOM et trois vérifications du vrai validateur, exécuter puis relire le diff.

## Modification et choix à expliquer

`src/app/expenses/page.tsx` reçoit **17 lignes**. Le champ reste non contrôlé
et son contenu continue d'alimenter le `FormData` existant. `onInput` met à
jour seulement la longueur ; le compteur se remet à zéro après succès et
reste conservé après une erreur ou un résultat incertain.

Le serveur applique `description.trim().length <= 4000`. Le compteur utilise
la même règle : les espaces externes sont ignorés, un emoji `😀` compte pour
deux unités UTF-16, `e` suivi d'un accent combinant compte aussi pour deux.
Ce n'est pas un compteur de graphèmes. Aucune nouvelle restriction native
`maxLength` n'est ajoutée : elle compterait aussi les espaces externes et
réduirait silencieusement le domaine accepté. Un dépassement affiche le
nombre en trop ; le validateur serveur inchangé continue de refuser 4001
unités et 2001 emojis. La constante de présentation vaut 4000 ; les tests
de contrat rendent un futur changement de plafond visible.

Le compteur et l'aide sont liés au champ par `aria-describedby`, sans
`aria-live`, rôle `status` ou remplacement du champ. Le test vérifie
l'association, l'absence de région live et la conservation du focus. Il ne
prouve pas le comportement audio de tous les lecteurs d'écran.

## Horodatages réels

Les points de contrôle viennent de l'horloge UTC de la session, convertis
explicitement en Europe/Paris (UTC+1 ce jour). Le journal machine
`timing.json` contient la fin effective de conservation des preuves.

| Phase | Début Paris | Fin Paris | Durée entre points de contrôle |
| --- | --- | --- | --- |
| Lecture du sujet, contrat, branche et plan | 18:08:10 | 18:09:41 | 1 min 31 s |
| Implémentation et préparation des tests/aperçu | 18:09:41 | 18:11:09 | 1 min 28 s |
| Exécution, analyse d'un échec de test, correction du sélecteur, vérifications finales | 18:11:09 | 18:17:30 | 6 min 21 s |
| Conservation du diff, explication et commit local | 18:17:30 | Voir `timing.json` | Mesurée dans le journal |

Ces durées décrivent le travail technique assisté de cette session. Elles
ne sont pas une mesure de performance de l'application, ni le temps mis
par Hugo ou l'équipe pour présenter ou développer.

## Résultats

Windows, Node 24.22.1, npm 11.19.1, Playwright 1.64.1 / Chromium. Dépendances
réutilisées depuis un worktree installé après comparaison des lockfiles
(blob identique `e78a5bcc04edc0718dfa830588d2ce8b7951d9de`). Aucun manifeste
ni lockfile modifié. Les commandes ne chargent aucun `.env` personnel.

| Commande / contrôle | Résultat |
| --- | --- |
| `npm run test:unit -- tests/unit/elyes/EL-08/description-contract.test.ts tests/unit/leandro/LE-01/input.test.ts` | **43/43 réussis** dont trois cas nouveaux ; [journal](unit-tests.log) |
| `npm run typecheck` | Code 0 ; [journal](typecheck.log) |
| ESLint sur composant et deux nouveaux fichiers de tests | Code 0 ; [journal](lint.log) |
| `git diff --cached --check` | Code 0 |
| Trois scénarios sur `ExpensesPage` réel avec styles dans l'aperçu isolé | **3/3 réussis en 6,1 s**, code 0 ; [journal](dom-tests.log) |

Les scénarios vérifient : vide et saisie, espaces externes, emoji et accent
combinant, focus clavier, association de l'aide, zéro au plafond, nombre
en trop, erreur réseau conservant champ/compteur, succès remettant à zéro.
La capture [counter.png](counter.png) montre `Taxi 😀` et 3993 restants dans
le composant réel. Elle ne montre pas l'en-tête ou une connexion réelle.

Un passage avec styles a détecté un **défaut de sélecteur du nouveau test** :
après succès, deux régions `status` sont légitimes pendant le rechargement
de l'historique. Le sélecteur global était ambigu. Il cible maintenant
explicitement le texte complet du succès ; l'attendu métier n'est pas
affaibli et aucun délai ni retry n'a été ajouté. L'[échec est conservé](dom-selector-failure.log).

Les scénarios DOM versionnés gardent la connexion réelle d'`ExpenseUi` pour
une future campagne complète. L'exécution ici utilise un aperçu Vite
temporaire sur `127.0.0.1:13239`, qui monte le composant réel et ses styles.
La copie temporaire remplace uniquement `signIn` par `page.goto` et ajuste
les imports. Les réponses HTTP sont contrôlées. Cela ne prouve ni Auth.js,
ni PostgreSQL/S3, ni la remise complète ; le vrai validateur a, lui, été
appelé directement dans les 43 tests ciblés.

## Diff et trame d'explication courte

Le [diff de l'exercice](exercise-diff.json) contient le composant et ses tests.
Le dossier de remise reste inchangé ; cette branche doit rester séparée
sauf décision explicite ultérieure.

« J'ai d'abord lu le validateur : sa limite compte les unités UTF-16 après
suppression des espaces externes. Le compteur suit ce contrat et explique
pourquoi un emoji peut compter double. Il n'ajoute pas de nouvelle règle
d'API. Il conserve le texte après panne et se remet à zéro après succès.
J'ai testé les cas limites et trouvé un sélecteur de test ambigu pendant
deux états simultanés ; je l'ai précisé sans modifier l'attendu. L'aperçu
teste le composant, pas l'authentification ou le stockage. »

Reste à faire humainement : chaque porteur doit expliquer son propre code,
répéter la présentation chronométrée et la démonstration commune. Aucun
accord personnel, répétition orale ou acceptation d'Hugo n'est déduit de
ces preuves techniques.
