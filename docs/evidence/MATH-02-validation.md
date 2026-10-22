# MATH-02 — preuves de validation

PR unique : [fix general #14](https://github.com/Mindsept/expense-io/pull/14).
Le socle MATH-01 de Mathis est repris avec son attribution.

## Contrôles locaux du 22 octobre 2026

Sur Windows / Node 22.12.0, la version fonctionnelle `7a897a0` passe `npm run verify`
(267 tests unitaires, lint et typage) et `npm run build`. Ces résultats ne sont pas
une preuve API/E2E. Docker Desktop local échoue pendant son propre démarrage ; les
services et suites HTTP/navigateur sont donc vérifiés sur les runners Linux.

## Contrôle négatif GitHub

[Run 39748591249](https://github.com/Mindsept/expense-io/actions/runs/39748591249)
au SHA `dd5f03970fb3f7a88459764d52863c7a6354255a` : **échec attendu** de l'assertion
temporaire `MATH-02 negative control deliberately makes the pipeline fail`.
Résultat : 267 tests réussis, un test volontairement en échec, sortie `verify=1`,
sortie du job 1. Les services et la suite suivante n'ont pas été lancés.
Cette assertion a ensuite été supprimée, sans `skip`, `fail` ou tolérance d'erreur.
Le premier essai antérieur `39748322907` était un rejet de syntaxe YAML, pas une
preuve du comportement d'un test ; la syntaxe du titre a été corrigée.

## Campagnes complètes

Les résultats définitifs et le SHA validé figurent dans les checks de la PR #14,
puis dans le run `push` de `main` après fusion. Chaque campagne crée une stack vide
distincte. Les artefacts `ci-evidence-<run>-<attempt>` contiennent `summary.json` et
les logs expurgés des étapes réellement exécutées ; ils sont conservés cinq jours.
Une suite non exécutée ne constitue pas un succès. La description finale de la PR
doit citer les runs avant fusion.

Le rôle de référence reste privilégié. HA-04 dispose d'une base vide séparée pour
ses diagnostics ; cela ne remplace pas sa future matrice d'autorisation applicative.
