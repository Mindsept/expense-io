# LE-11 — Listes bornées par défaut

Base main `919d98f`, après EL-05/PR29. Le SHA validé et la fusion sont consignés
dans la PR liée à ARLA-29. Diff relu et `git diff --check` propre.

Les quatre GET de listes passent exclusivement par queryPage ; les branches SQL
retournant tous les enregistrements et le mode legacy sont retirés. Défauts1/20,
max100, filtres/tri/totaux et droits inchangés. La sélection de manager hors page
est aussi disponible avec les paramètres de page omis. Aucun écran, mutation,
helper d'autorisation, rôle SQL, policy, migration, dépendance ou runner modifié.

OpenAPI majeur5.0.0 (`expense-io.v5.json`) est le contrat courant, validé contre
le schéma officiel OpenAPI3.0. Les versions1–4 restent des archives. L'inventaire
des17 route files et leurs opérations reste exact. Les clients ont un guide
explicite : `docs/runbooks/LE-11-list-migration.md`, incluant retour cohérent de
version. Les consommateurs applicatifs connus demandent tous page/pageSize et
lisent l'enveloppe ; aucune absence de clients externes inconnus n'est supposée.

## Vérifications et adaptation des tests

La suite LE-07 utilise le vrai LOGIN expense_web et le serveur production d'une
base privée.45 notes :20/20/5 parcourues sans trou/doublon, ordre exact, totaux
1039.50 sur chaque page et page4 vide. Les appels sans paramètres vérifient
maintenant la première page20/45 et les vrais totaux, plutôt qu'un tableau45.
Annuaire supérieur à20 : défaut borné et total complet ; recherche et sélection
hors page, identité étrangère/inactive et droits courants toujours vérifiés.

Cinq nouveaux unitaires LE-11 rejettent le tableau legacy, les totaux absents et
la taille invalide sur les quatre endpoints, et vérifient la version majeure.
Les adaptations ciblées des anciennes suites HA-02/06/07, LE-01/10/12 ne retirent
aucun contrôle de visibilité, autorisation, tri, auteur, champ privé ou création :
elles lisent items dans l'enveloppe et fournissent la ligne d'agrégat au double
SQL. Les autres fixtures et cas métier sont conservés.

## Exécution locale

Node24.22.1/npm11.19.1, pipeline standard `npm run test:ci` : lint/typecheck,
**678 unitaires et239 API passent** ; collecte, services, préparation, build
Turbopack et nettoyage passent. Premier passage API : deux anciens lecteurs de
tableau corrigés, puis239/239 passent. Aucun retry ou assertion diminuée.

Le passage navigateur local rapporte **25 réussites et4 échecs** : trois délais
pendant connexion/inscription (EL-01, EL-04, HA-05), et un kill EPERM au nettoyage
du harness LE-08 sous macOS. Ces échecs sont conservés, pas comptés comme verts ;
la réussite des tests de pagination n'en fait pas un passage E2E complet réussi.
Une validation distante Linux de la tête exacte est requise avant fusion ; son
résultat et son artefact sont consignés dans la PR/Jira, distinctement de ce run.
Aucune relecture humaine indépendante n'est revendiquée.
