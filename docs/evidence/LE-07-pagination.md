# LE-07 — Preuves du 23 octobre 2026

Base main `eceb158` : HA-06 (`6cfc605`), HA-05/HA-04 et MATH-07 intégrés.
Le SHA exact du head et celui de fusion sont consignés dans la PR ARLA-25 pour
éviter une référence circulaire dans le commit. Diff relu. Les quatre GET listes
sont transférés séquentiellement après HA-06 ; décisions/affectations, helpers
HA-02/DB/errors, policies/grants/migrations, packages et runner sont inchangés.

## Campagne locale standard

Node **24.22.1**, npm **11.19.1**, Next **16.4.3**, lockfile installé par `npm ci`.
Runtime temporaire téléchargé depuis nodejs.org, SHA-256 comparé au manifeste
officiel avant extraction. Aucun binaire ou nouvelle dépendance ajouté au dépôt.

Commandes exécutées : `npm ci --no-audit --no-fund`, `npm run verify`, puis
**`npm run test:ci`** standard. Le passage final trouve **652 unitaires, 223 API,
19 E2E Chromium**, tous passés sans retry. Lint/typecheck/collecte, services
jetables PostgreSQL16/LocalStack, préparation/migrations/seed, build **Turbopack**,
API, navigateur et cleanup : tous code0. Aucun contournement Webpack ou changement
de runner requis avec le socle actuel. OpenAPI4.1 validé contre le schéma officiel
OpenAPI3.0 ; `git diff --check` propre.

GitHub Actions est de nouveau activé au moment de cette campagne (API enabled=true,
runs de collègues récents). Les liens et résultats distants de ce head sont
consignés dans la PR, sans attribuer à ce diff un run antérieur. Une CI verte
n'est pas une relecture humaine indépendante ou la recette des écrans EL-05.

## Preuve réelle d'isolation et d'exactitude

Dix scénarios API nouveaux utilisent le fixture publié HA-04 : base aléatoire
privée dans le cluster jetable, migrations réelles, vrai LOGIN **expense_web**
non propriétaire, aucun SUPERUSER/BYPASSRLS, serveur Next production démarré avec
sa connexion restreinte et privé de configuration administrateur. Les fixtures
sont écrites avec un client administrateur de test distinct, jamais par le
serveur. Aucune policy n'est relâchée. La suite générale conserve son baseline
bootstrap annoncé ; cette suite ciblée prouve séparément le vrai rôle applicatif.

- Trois parcours personnel/manager/RH : 45 notes visibles, timestamp identique,
  pages20/20/5, concaténation exactement égale à l'ordre UUID attendu, aucun
  doublon/trou, totaux complets1039.50 sur chaque page. Page4 vide conserve45 et
  le montant global ; appel legacy sans paramètres renvoie les45 notes.
- Les six tris sont testés avec leur second critère UUID. page seul et pageSize
  seul ont les défauts publiés. Les statuts courants et auteurs manager/RH sont
  conservés ; les notes propres du valideur restent exclues.
- Données étrangères à montants élevés et lien manager volontairement incohérent
  interentreprises : aucune ligne ni contribution aux agrégats. SQL direct sous
  expense_web avec contexte RH ne voit ni personnes ni notes de l'autre entreprise.
- Paramètres invalides/répétés/non représentables sur les quatre GET :400
  Problem Details. Session absente401 et rôle refusé403 gardent la priorité,
  même avec un page malformé. Aucun champ de paramètre ne remplace l'acteur actuel.
- Annuaire de plus d'une page, recherche globale d'un manager absent de la page
  courante, homonyme manager d'une autre entreprise exclu, filtre manager actif,
  `%`, `_` et `\` littéraux ; une tentative d'injection cherche seulement son
  texte et retourne zéro résultat. L'annuaire n'a aucun montant fictif.
- Identité sélectionnée hors page/terme restituée séparément sans changer le
  count. Ancien manager inactif ou reclassé correctement nommé mais inéligible.
  UUID absent/étranger : même réponse avec selectedManager null.
- Une décision simulée par l'administrateur de fixture réduit pending/items/count/
  amount ensemble mais conserve la note personnelle. Désactiver le manager fait
  passer les notes admissibles dans le recours RH avec les bons agrégats.
- Vrais cookies antérieurs après désactivation, retrait de rôle et changement
  d'entreprise :401/403 ou nouveau périmètre uniquement, ancienne sélection
  invisible. États restaurés dans finally.

Les 34 nouveaux tests unitaires couvrent parse/offset, formats et répétitions,
ordre constant, recherche échappée, une instruction SQL pour filtre/compte/somme/
page, page vide, absence de montant utilisateur, agrégat corrompu/hors capacité,
headers de transition et fixtures OpenAPI. Les réponses fermées rejettent totaux
mal typés, propriétés privées et montant dans l'annuaire. Les exemples destinés
à Elyes sont réellement chargés par ces tests, pas une seconde spécification libre.

## Mesure de la dette legacy

Relevé HTTP réel imprimé par la suite (JSON, aucun identifiant) :

```json
{"operation":"le07.compatibility.measure","legacyRows":45,"pagedRows":20,"legacyBytes":12862,"pagedBytes":5836}
```

Taille UTF-8 de JSON.stringify des réponses décodées, pas trafic compressé, mémoire
maximale ni benchmark de production. La page borne items ; legacy conserve tout.
Cette dette n'est pas dissimulée par une troncature. LE-11 devra la retirer après
EL-05 ; LE-09 mesurera COUNT/offset/CTE avec MATH-05 avant tout index.

## Limites et reproduction

Voir [le contrat/ADR](../pagination.md) et OpenAPI4.1. Offset stable seulement sur
un jeu inchangé, pas de snapshot inter-requêtes ; une instruction fournit en
revanche un snapshot commun à la page et à ses agrégats. Total NUMERIC/cents
calculé en SQL, garde de représentation numérique JSON ; aucun SLO global ni
optimisation SQL revendiqués. Aucun écran paginé n'est livré par ce backend.

Les suites sont sous tests/unit/leandro/LE-07 et tests/api/leandro/LE-07. Le runner
standard construit seul ses secrets et cibles isolées, jamais une base .env de
développement ; le fixture RLS partagé possède et supprime uniquement sa base
aléatoire, après fermeture ordonnée des connexions/processus. Les régressions
existantes, y compris les19 navigateurs, passent sur les réponses legacy.
