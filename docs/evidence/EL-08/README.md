# EL-08 / ARLA-38 — campagnes frontend du 25 octobre 2026

La [recette frontend](../../recette/frontend.md) associe les scénarios EL-01 à
EL-07 et le flux EL-08. Les résultats ci-dessous concernent le fork
**Mindsept/expense-io**, pas le dépôt original.

## Source et environnement de la campagne positive

- Commande : `npm run test:ci`, sortie globale **0**.
- Source : `02ec22e2392eb92458b63089da683da59dc1560e`, branche
  `codex/arla-38-frontend-recipe`. Aucun écart applicatif/test au lancement ;
  seul `docs/evidence/EL-08/negative-control/` était non suivi.
- Windows ; Node **24.22.1**, npm **11.19.1** ; Docker Desktop **4.96.3**,
  moteur **29.9.2** ; fuseau **Europe/Paris** (UTC+01:00 ce jour).
- PostgreSQL/LocalStack réels dans le projet jetable
  `arla-ci-8cba5e96afe6`, base et bucket de test. Nettoyage code **0**.
- **673/673 unitaires, 239/239 API, 40/40 E2E**. Parmi les E2E, **28/28 Elyes**,
  dont **10/10 EL-07** et **1/1 EL-08**. Le runner affiche 41,7 s pour les E2E ;
  le résumé mesure 42 420 ms pour toute l'étape enfant E2E.
- La CI publique [40205740218](https://github.com/Mindsept/expense-io/actions/runs/40205740218)
  a été relue : `completed/success`, tête `02ec22e`. Ses comptes de tests n'ont
  pas été extraits ; les nombres ci-dessus proviennent des rapports locaux.

## Trois phases conservées

| Phase | Résultat et portée | Rapports |
| --- | --- | --- |
| `windows-initial` | 37/40 E2E, trois échecs réels EL-07 à petite largeur dans l'application complète, avant la correction de l'en-tête. Ces fichiers historiques ne consignent pas à eux seuls l'état exact du dossier initial ; ils ne sont pas réétiquetés comme exécution du SHA corrigé. | [summary.json](windows-initial/summary.json), [e2e.log](windows-initial/e2e.log) |
| `negative-control` | Après correction de l'en-tête, régénération volontaire de la clé d'idempotence lors de la reprise : 38/40 E2E, échecs attendus des assertions d'égalité EL-04 et EL-08. Le reste de la chaîne passe et le nettoyage réussit. L'opérateur a restauré le fichier original octet pour octet ; mutation jamais committée. | [summary.json](negative-control/summary.json), [e2e.log](negative-control/e2e.log), [metadata.json](negative-control/metadata.json) |
| `windows-positive` | Source restaurée, campagne complète verte sur `02ec22e`. Aucune assertion désactivée/affaiblie pour masquer la mutation ; les cas précédemment rouges passent. | [summary.json](windows-positive/summary.json), [e2e.log](windows-positive/e2e.log), [metadata.json](windows-positive/metadata.json) |

Le contrôle négatif porte sur une régression concrète : la seconde requête a
une autre clé que la première. Les journaux contiennent les valeurs distinctes
et la ligne d'assertion atteinte. Ce n'est ni une erreur d'import, ni une absence
de collecte, ni une preuve que tous les défauts possibles seraient détectés.

## Rapports positifs expurgés

Le [résumé](windows-positive/summary.json) conserve codes et durées de chaque
étape : [verify](windows-positive/verify.log),
[collecte](windows-positive/collect.log), [services](windows-positive/services.log),
[préparation](windows-positive/prepare.log), [build](windows-positive/build.log),
[API](windows-positive/api.log), [E2E](windows-positive/e2e.log),
[nettoyage](windows-positive/cleanup.log).

La collecte retrouve **45 fichiers unitaires**, **21 fichiers API**,
**15 fichiers E2E**. Les quatre propriétaires sont présents aux niveaux
unitaires/E2E ; les fichiers API appartiennent à Hamza, Leandro et Mathis.
Ces nombres de fichiers ne sont pas les nombres de cas exécutés. Lint passe
avec un avertissement préexistant `deliverOneAssignment` non utilisé dans
HA-09, visible dans `verify.log` ; aucune erreur lint/typecheck.

Les logs copiés viennent du runner expurgé. Les chemins absolus du poste ont
été remplacés par `<workspace>` dans les nouvelles copies positives et dans
le log du contrôle négatif ; espaces de fin de ligne et lignes vides finales
normalisés. Aucune assertion, durée ou issue n'a été changée.
Les rapports initiaux déjà versionnés restent intacts. Aucun `.env`, fichier
de configuration privé, cookie, trace navigateur brute, reçu ou URL signée
n'est ajouté. Le log de production complet n'est pas recopié.

## Ce que cette campagne prouve et ne prouve pas

La connexion Auth.js et l'application Next de production sont réelles.
Les scénarios Elyes contrôlent leurs réponses métier avec les interceptions
Playwright ; ils prouvent les comportements UI correspondants, pas
l'idempotence SQL, l'atomicité DB/S3 ou l'isolation entre entreprises.
Les 239 tests API incluent les suites réelles des auteurs backend ; leur
portée reste celle de chaque assertion.

Le runner commun annonce explicitement son rôle bootstrap privilégié.
Les fixtures HA-04/HA-09 utilisent de vrais rôles web/worker limités ; la
réussite commune n'est pas une certification exhaustive de RLS. Ces résultats
ne sont pas une recette MATH-04 d'un futur SHA de remise.

Restent séparés : reproduction personnelle par Elyes, relecture Leandro,
acceptation Hugo, zoom navigateur natif à 200 %, lecteur d'écran et vérification
d'accessibilité au-delà des scénarios ciblés. Aucune validation humaine n'est
cochée automatiquement et aucune conformité globale n'est annoncée.
