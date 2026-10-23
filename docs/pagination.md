# LE-07 — Pages et totaux sur le périmètre autorisé

[ARLA-25](https://mindsept.atlassian.net/browse/ARLA-25), après HA-06 intégré
`6cfc605`, base main `eceb158`. Les quatre GET ci-dessous sont transférés
séquentiellement à Leandro. Les décisions, affectations, autorisations et helpers
DB restent ceux de Hamza ; aucun index, rôle, grant ou migration ajouté.

## Contrat livré et transition EL-05

| Liste | GET | Défaut de tri |
| --- | --- | --- |
| Notes personnelles, tous statuts | /api/expense-notes | created_at DESC, id DESC |
| Notes manager actuellement éligibles et pending | /api/manager/expense-notes | created_at ASC, id ASC |
| Notes RH actuellement éligibles et pending | /api/hr/expense-notes | created_at ASC, id ASC |
| Annuaire RH de la même entreprise, employés/managers, inactifs inclus | /api/hr/users | name ASC, id ASC |

La présence de **page ou pageSize** active la pagination, avec défauts respectifs
1 et20, taille maximale100. Chaque valeur fournie doit être un entier décimal
positif canonique, sans zéro initial, espace, signe, fraction, suffixe ou exposant.
Valeur vide, doublon, entier non représentable ou produit offset non représentable :
400 Problem Details. Une page au-delà de la fin reste200 avec items vide et les
vrais totaux complets, pas un total zéro inventé. Les refus401/403 de l'acteur
courant précèdent la validation des paramètres.

```json
{
  "items": [],
  "pagination": { "page": 4, "pageSize": 20, "totalItems": 45 },
  "totals": { "amount": 1039.5, "count": 45, "scope": "filtered" }
}
```

L'annuaire a la même pagination et `totals: {count, scope:'filtered'}`, **sans
montant monétaire**. Le DTO de chaque note/personne reste celui déjà livré ; les
notes manager/RH gardent author `{id,displayName}`. Ne pas inférer le nom d'un
auteur à partir de la page courante d'annuaire.

Sans page ni pageSize, la réponse reste un **tableau complet**, sans plafond caché.
Le header X-Pagination-Mode indique legacy/paged ; Cache-Control est no-store.
Les écrans actuels restent fonctionnels. Cette compatibilité est une dette
volontaire jusqu'à EL-05 puis LE-11, pas une borne mémoire de production. Un appel
legacy continue de charger toutes les lignes autorisées ; aucun retrait, date de
suppression ou migration UI n'est prétendu livré par LE-07. La preuve indique le
poids observé des 45 lignes versus une page20, sans extrapoler un SLO.

Les trois listes de notes acceptent les six tris exacts `created_at`, `amount`,
`expense_date` avec ASC/DESC majuscules. L'annuaire accepte name ASC/name DESC.
Absence/valeur vide garde le défaut historique ; doublon ou autre fragment est400.
L'UUID est toujours le second critère, dans la même direction. Le tri ne provient
jamais d'un fragment SQL libre. Les paramètres non reconnus ne décident ni rôle,
ni utilisateur, ni entreprise.

## Recherche de managers et sélection hors page

Le même endpoint d'annuaire fournit la recherche globale :

```text
GET /api/hr/users?page=1&pageSize=20&role=manager&q=Needle
GET /api/hr/users?page=1&pageSize=20&role=manager&q=Needle&selectedManagerId=<UUID affecté>
```

`role=manager` est la seule valeur de ce filtre et limite les candidats aux
managers **actifs** de l'entreprise actuelle de l'acteur RH. Sans role, l'annuaire
conserve employés/managers inactifs compris. `q` recherche dans nom/email sur tout
cet ensemble, pas seulement la page affichée. Terme trimé, maximum120 unités
UTF-16, contrôles C0/DEL interdits ; `%`, `_` et `\` sont des caractères littéraux,
pas des jokers SQL. Rôle/terme répétés ou invalides :400. q/role sans pagination
restent un tableau filtré complet ; le frontend doit transmettre page/pageSize
pour obtenir la borne serveur.

`selectedManagerId`, UUID unique et valide, exige un opt-in paginé. La réponse
ajoute selectedManager :

```json
{
  "id": "10000000-0000-4000-8000-000000000099",
  "name": "Selected outside results",
  "role": "manager",
  "isActive": true,
  "isEligible": true
}
```

Cette identité est résolue dans la même entreprise, indépendamment de q et de la
page. Elle ne change pas items, totalItems ou totals. Un ancien manager inactif
ou reclassé peut encore être nommé, avec isEligible=false ; il ne devient pas un
candidat valide par ce mécanisme. Son email n'est pas exposé dans ce descripteur.
Une identité absente et une identité étrangère donnent toutes deux null. Aucun
accès à une autre entreprise n'est fourni par un UUID connu. Sans ce paramètre,
la propriété est omise, pas un candidat choisi arbitrairement par le serveur.

Consommation EL-05 : états de page de notes, annuaire et recherche indépendants ;
nouveau terme → page1 ; ignorer les réponses dépassées ; conserver le descripteur
de la sélection confirmée tant qu'aucune mutation réussie ne la remplace. Une
absence dans items ne prouve ni suppression ni inéligibilité. L'affectation reste
le PUT HA-06, qui revalide les droits/règles et peut répondre409. Ce ticket ne
modifie pas ce PUT et ne branche aucun écran à sa place.

Fixtures exécutables pour Elyes :
`tests/fixtures/leandro/LE-07/responses.json` : première page20/45, dernière5/45,
page hors borne vide/45, recherche de manager avec sélection hors résultats et
recherche vide avec sélection nulle. Les unitaires les valident contre
**OpenAPI4.1.0**, fichier courant expense-io.v4.json. Aucun endpoint futur ajouté.

## Exactitude, isolation et limites

Une seule instruction SQL construit un ensemble filtré commun, compte, somme et
page dans le même snapshot. Les agrégats ne sont pas une somme JS de items. Le
cas d'une page vide conserve la ligne de résumé. Les totaux suivent exactement
l'acteur, son entreprise, le statut et le prédicat d'éligibilité HA-02/06 utilisés
pour la page. L'identité de sélection est séparée du filtre de recherche mais
respecte la même entreprise et le même snapshot. Le rechargement HA-02 et les
policies HA-04 s'appliquent ; aucune exception RLS ni connexion administrateur
n'est introduite dans le serveur.

Les sommes sont calculées en NUMERIC/cents dans PostgreSQL avant conversion au
nombre JSON attendu. Compte ou cents au-delà de MAX_SAFE_INTEGER : erreur technique
assainie, jamais un total fabriqué. Le JSON conserve ses limites ordinaires de
représentation flottante ; traiter les montants en cents/décimal pour les calculs
financiers ultérieurs. Aucun changement de la représentation numérique LE-12
n'est introduit ici.

L'offset donne un ordre déterministe sur un jeu stable, **pas un snapshot figé
entre requêtes**. Une insertion, décision ou réaffectation entre deux pages peut
produire un déplacement ; recharger depuis une page connue. Aucun curseur/version
de snapshot durable n'est ajouté. COUNT/SUM continuent de parcourir tout le filtre,
les pages profondes ont un coût d'offset et le CTE peut se matérialiser : ne pas
présenter cette borne HTTP comme une optimisation SQL. LE-09 choisira les index
sur les mesures MATH-05 et ce contrat intégré.

Décision (C3/C1–2) : pagination opt-in et agrégats d'un même ensemble permettent
l'intégration backend avant les écrans, sans tronquer les anciens consommateurs.
Le retrait immédiat du tableau créerait un cycle LE-07/EL-05 ; sommer les seules
lignes de la page afficherait un faux total. Le mécanisme d'identité sélectionnée
évite de déduire les managers possibles d'un annuaire partiel.
