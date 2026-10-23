# ARLA-43 — référence sur le runtime limité

Actualisation validée le 23 octobre 2026. Responsable : Mathis ; relecture attendue : Leandro. Les [mesures du 22 octobre](reference.md) et leurs fichiers bruts restent historiques et inchangés. Les résultats de cette campagne sont écrits dans `results/post-rls-20261023/{1000,10000}/`, sans écrasement des anciens dossiers.

## Protocole

- Intégrer `main` dans la branche existante sans réécrire son historique. Conserver Next/config 16.4.3 et le lockfile qualifiés par ARLA-45.
- Même géométrie fictive : une entreprise de benchmark, trois rôles, 1 000 puis 10 000 notes ; moitié des notes par auteur employé/manager, 70 % pending, 20 % approved, 10 % rejected. Le seed commun ajoute séparément trois utilisateurs et deux notes. Dates/montants/statuts déterministes ; UUID et mots de passe aléatoires. Le protocole porte le marqueur `math05-v3-limited-runtime-20261023`.
- Même stack jetable dédiée, précontrôle MATH-02, ports loopback, suffixe `_test`, bucket de test, Docker Unix local et nettoyage limité aux labels de cette stack. Aucun accès à la base personnelle.
- Migration et seed via administrateur de cette stack. Provisionnement de `expense_web` avec la fonction publique d'exploitation fournie par Hamza, sans édition de rôle, policy ou migration dans ARLA-43. Secret aléatoire privé par stack.
- Serveur **et plans SQL** via un vrai LOGIN `expense_web`. Environnement enfant construit par liste autorisée : aucune URL d'administration, variable de maintenance, mot de passe bootstrap ou option Node héritée. Vérification HA-04 inchangée avant mesure et au démarrage réel du serveur ; privilèges relevés, absence de lignes visibles sans acteur. L'identifiant `arla-ci-bench-*` ne bénéficie pas de l'exception bootstrap de la CI commune.
- L'administration reste utilisée pour préparer, compter et contrôler l'empreinte de la fixture. Son identité est publiée séparément de celle du runtime ; elle n'exécute pas les SELECT chronométrés. Les neuf plans par volume utilisent le contexte acteur transactionnel, le rôle limité et les SELECT actuels des routes, dont le prédicat partagé `expenseValidatorSql` et le tri secondaire UUID. Ils ne comprennent pas toute la transaction d'authentification d'une requête HTTP.
- Trois listes par volume, trois passages de 30 requêtes, concurrence 4, trois échauffements exclus par liste. Statut, taille reçue, durée complète, erreur et mauvais volume conservés par tentative ; aucun retry. Contrôle anonyme 401 distinct. Les appels **legacy sans pagination** restent intentionnels ; l'API supporte désormais page/pageSize mais aucun mélange de réponses paginées dans cette série. Aucun index ajouté.
- OCR : trois workers de diagnostic distincts, huit PNG synthétiques français par worker, mêmes vérités terrain et parseur existants. Initialisation et reconnaissance séparées. Le serveur actuel utilise un pool OCR borné ; **ce diagnostic hors HTTP ne mesure pas cette architecture**. Les preuves de charge du pool restent celles de LE-05/LE-06.
- Même limites temporelles : requête 10 s, OCR 30 s, préparation enfant 240 s, Docker 180 s, campagne 8 minutes. Erreurs conservées et sortie non nulle ; résultat partiel marqué failed. Métriques et limites statistiques du [protocole initial](protocole.md) inchangées.

## Relancer

```sh
# Node 24.22.1 / npm 11.19.1, Docker local
npm ci
npm run bench:prepare -- 1000
npm run bench:run
npm run bench:prepare -- 10000
npm run bench:run
# Seulement si une préparation a été interrompue :
npm run bench:down
```

Les secrets générés restent dans `.ci-output/benchmark`, ignoré par Git, et ne sont jamais publiés. Aucun fichier `.env` n'est écrit. Next peut lire les fichiers d'environnement habituels du projet ; les valeurs critiques DB/S3/auth de la fixture sont explicitement injectées et prioritaires. Le garde HA-04 refuse une URL d'administration présente dans le processus web.

## Lecture des résultats

Le SHA, l'état du dossier, les empreintes du code et du lockfile, Node/npm, PostgreSQL, OS et charge sont enregistrés par volume. Le poste est partagé et les caches ne sont pas vidés. Les résultats déjà générés peuvent apparaître dans l'état Git du second volume : ils ne changent pas le code, dont les empreintes doivent rester identiques.

Cette série constitue une **nouvelle référence** avec RLS, autorisations et code actuels. Une différence avec le 22 octobre ne peut pas être attribuée à un index ou à la seule RLS : plusieurs contrats ont changé. Les métriques ne prouvent ni la capacité de production ni l'exhaustivité de la sécurité. La matrice de refus appartient à HA-04 ; la recette finale appartient à ARLA-42. Aucun résultat ni réception humaine annoncé avant exécution/relecture.
