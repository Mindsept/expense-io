# LE-11 — Migration des consommateurs de listes

Rupture HTTP publiée en **OpenAPI 5.0.0** après intégration EL-05 (PR29).
Politique retenue : nouveau contrat borné par défaut aux mêmes endpoints,
sans conserver une version publique non bornée. Les fichiers OpenAPI antérieurs
sont des archives. Cette décision s'inscrit dans l'autonomie de réalisation
demandée par Leandro ; aucune approbation distincte de Hugo n'est inventée.

GET concernés : `/api/expense-notes`, `/api/manager/expense-notes`,
`/api/hr/expense-notes`, `/api/hr/users`. Sans paramètres : page1/pageSize20.
Taille explicite1..100 ; page entière positive. Chaque liste renvoie un objet
avec `items`, `pagination: {page,pageSize,totalItems}` et `totals` sur tout le
filtre autorisé. Les notes ont `amount/count/scope`; l'annuaire `count/scope`.
Le header X-Pagination-Mode vaut `paged` et Cache-Control `no-store`.

## Ancien client et nouveau client

Avant : `const rows = await response.json()` supposait toutes les lignes.
Après : lire et valider l'enveloppe, afficher `items`, calculer précédent/suivant
avec `pagination`, afficher les totaux du serveur. Une page ne constitue jamais
la liste complète. Ne pas remplacer la pagination par `pageSize=100` en supposant
qu'il n'existe pas plus de100 lignes. Ne pas sommer `items` comme total global.

```text
GET /api/expense-notes
→ {items:[...au plus20],pagination:{page:1,pageSize:20,totalItems:45},
   totals:{amount:1039.5,count:45,scope:"filtered"}}
GET /api/expense-notes?page=2&pageSize=20
→ deuxième page, mêmes totaux sur données inchangées
GET /api/expense-notes?page=4&pageSize=20
→ items:[], totalItems:45, total conservé
```

Les champs de chaque note/personne, le tri secondaire UUID, les droits courants,
le circuit de décision et les erreurs restent inchangés. Un paramètre invalide
reste400 ;401/403 restent prioritaires. L'offset ne fige pas les données entre
requêtes. La recherche de managers utilise q/role sur l'ensemble autorisé et
selectedManagerId pour résoudre une sélection hors page ; elle fonctionne
également sans paramètres de pagination explicites, avec la page par défaut.

## Inventaire et exploitation

Consommateurs applicatifs inspectés : `expenses/page.tsx`,
`PendingApprovalsPanel.tsx`, `AdminConsole.tsx`. Tous demandent page/pageSize et
valident l'enveloppe via `src/utils/paged-list.ts`. Annuaire, notes et recherche
manager gardent leurs états indépendants. Les E2E EL-05 couvrent navigation,
panne, réponses inversées et sélection hors page ; LE-07 couvre le serveur réel
sous LOGIN restreint avec45 notes et plus d'une page d'annuaire.

Les clients externes non répertoriés doivent migrer explicitement. Le contrat
annoncé est une rupture majeure ; aucune preuve d'absence de clients inconnus
n'est revendiquée. Les anciens scripts de benchmark attendant des tableaux
doivent consommer `items` et fixer la pagination avant toute comparaison.

Déploiement : livrer ensemble backend/contrat5 et frontend EL-05 déjà intégré,
rejouer les tests de listes multi-pages et les erreurs, puis surveiller les
erreurs de décodage des consommateurs connus. Aucun retrait de données ni
migration SQL n'est nécessaire. Si un retour est requis, redéployer l'artefact
précédent cohérent (backend et contrat4.1, frontend EL-05 compatible). Ce retour
rétablirait temporairement les listes non bornées : le documenter et corriger
le consommateur avant une nouvelle livraison. Ne pas ajouter un paramètre
secret `legacy` ou une troncature de tableau pour masquer la rupture.
