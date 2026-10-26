# Revue frontend et réponses RH obsolètes — 26 octobre 2026

Revue assistée de PR #31 dans **Mindsept/expense-io**, base frontend
`db3dab614bb18ef236a1ff60da7f59d721f43e7a`, comparée à `origin/main`
`888a74ddae9db28378596adc7709358798986e49`. Elle ne constitue pas une
validation personnelle d'Elyes, Leandro ou Hugo.

## Intention et compatibilité

EL-07 corrige les obstacles observés sur les trois écrans ; EL-08 consolide
les preuves d'erreur, reprise, pagination, dates, OCR et accessibilité.
Les changements de PR #31 gardent les contrats métier serveur. Tous les
appels de listes des écrans transmettent déjà `page`/`pageSize` et lisent
l'enveloppe `items`/`pagination`/`totals`. LE-11 supprime l'ancien mode
non borné sans retirer ce contrat. LE-09 modifie le plan SQL RH sans changer
les DTO, totaux ou filtres consommés. Cette lecture doit être complétée par
la campagne commune sur le candidat intégré.

Les noms d'action datés, labels RH contextualisés, régions de tableau
tabulables, états textuels et conservation du focus pendant une saisie sont
cohérents. Les tests de reprise comparent la même clé, les champs et les
octets du reçu ; le contrôle négatif historique vérifie qu'ils détectent
une régression. Aucun ajout de dépendance, changement d'API ou test ignoré.

## Défaut reproduit et correction

La pagination d'une section RH déclenche le rechargement des deux sections.
Si une requête initiale de l'autre section reste en vol, sa réponse HTTP
503 peut arriver après le succès de sa remplaçante. Les branches de succès
et d'exception vérifiaient déjà le numéro de génération, mais la branche
HTTP non réussie réaffichait une alerte périmée.

Les deux cas de `tests/e2e/elyes/EL-08/stale-responses.spec.ts` reproduisent
ce décalage pour l'annuaire et les notes : réponse initiale suspendue,
pagination de l'autre section, nouvelles listes affichées, puis ancienne
réponse libérée. Ils exigent l'absence d'alerte et de bouton de reprise
ainsi que la présence des bonnes lignes. Aucune attente chronométrée ; la
réponse et son rendu sont synchronisés explicitement.

Correction limitée à `AdminConsole` : calculer le message d'erreur puis
ne l'afficher que si la génération de la requête est toujours courante.
Les erreurs courantes restent visibles et les suites EL-01 restent intactes.
Blob Git du composant corrigé : `d388c967362ff6fe0dea929f82ede2b68d5ad868`.

## Exécutions réellement réalisées

Windows, Node 24.22.1, npm 11.19.1, Chromium fourni par Playwright 1.64.1.
Un aperçu Vite temporaire, ignoré dans `.ci-output/frontend-review`, monte
le véritable `AdminConsole`. La copie de travail des deux tests remplace
uniquement `ExpenseUi.signIn('HR', '/hr')` par `page.goto('/hr')` et ajuste
les chemins d'import. Les réponses métier restent contrôlées par Playwright.
Ni authentification, ni PostgreSQL, ni S3 ne sont prouvés par cet aperçu.

| Vérification | Résultat |
| --- | --- |
| `npm ci --no-audit --no-fund` | 473 paquets installés, lockfile inchangé |
| `npm run test:unit -- tests/unit/elyes` | 18 tests réussis dans 5 fichiers |
| `npm run typecheck` | code 0 avant et après correction |
| ESLint sur les composants/tests relus puis sur le correctif et les nouveaux tests | code 0 |
| `git diff --check` | code 0 |
| Deux tests sur composant original | **2 échecs attendus** : 1 alerte observée au lieu de 0, [journal rouge](red.log) |
| Mêmes tests sur composant corrigé | **2 réussites**, 3,8 s, code 0, [journal vert](green.log) |

Commande de l'aperçu :
`node node_modules/playwright/cli.js test --config .ci-output/frontend-review/playwright.config.ts`,
avec `ARLA_TEST_ENV=isolated` et `ARLA_TEST_BASE_URL=http://127.0.0.1:13238`.
Les premières tentatives ont été bloquées avant assertion par l'emplacement
du navigateur et l'accès loopback du bac à sable ; elles ne sont pas
comptées comme preuve rouge de la régression. Les deux journaux ci-dessus
proviennent d'un navigateur fonctionnel accédant au composant réel.

Le test versionné conserve la vraie connexion commune. À exécuter sur la
campagne intégrée : `npm run test:e2e -- tests/e2e/elyes/EL-08/stale-responses.spec.ts`.

## Limites et verdict

Le défaut observé est corrigé et couvert. Aucun autre problème bloquant
identifié dans le diff frontend relu. Les parcours de soumission/réception
réels et le candidat commun restent à vérifier par la recette finale.

Clavier, focus et petite largeur disposent des preuves historiques EL-07 ;
le zoom navigateur natif à 200 % doit encore être vérifié sur le candidat
commun. Le ticket prévoit un lecteur d'écran en complément s'il est
disponible : aucun usage réel de lecteur d'écran n'est revendiqué ici.
Une inspection d'arbre accessible ne certifie pas une conformité WCAG globale.

Verdict de revue assistée : correctif ciblé prêt à intégrer pour validation
commune. Aucun blocage de décision produit identifié dans ce périmètre.
