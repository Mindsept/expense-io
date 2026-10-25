# Preuves MATH-04 — préparation du 25 octobre 2026

Ce dossier ne contient **aucun résultat de recette finale**. Voir [la matrice](../../recette-finale.md).

- [branch-checks.json](branch-checks.json) : projection expurgée de checks publics GitHub effectivement lus, limitée aux PR, SHA, dates, statuts et liens. Le check cité d'une ancienne tête reste historique lorsque la branche avance. Aucun compte de tests ni code de sortie de sous-commande n'a été inféré du seul statut GitHub.
- [current-branch-checks.json](current-branch-checks.json) : nouveau relevé après synchronisation avec main `888a74d`, sans écraser les anciens checks. Les totaux des jobs terminés proviennent de leurs logs ; le run ARLA-43 était encore en cours au relevé.
- [final-campaign.json](final-campaign.json) : fiche à compléter pour le SHA retenu. Les valeurs `null` signifient inconnues/non relevées ; les cas sont non exécutés. Ce fichier n'est pas une attestation de réussite.

Sources examinées : description ARLA-42 sauvegardée localement par Hugo ; dépôt du fork, lecture initiale `185dea9c5eddde5b4ce2f1b31148ae7fd4249e9a` puis actualisation `888a74ddae9db28378596adc7709358798986e49` ; tests et documents des auteurs liés dans la matrice ; API publique GitHub des PR #17/#27/#29 et de leurs checks. La description Jira complète, les identifiants de personnes et les réponses API sans filtrage ne sont pas recopiés.

Contrôles de cette préparation : liens locaux résolus, JSON analysés, durées des trois jobs recalculées depuis leurs horodatages et absence de réussite finale vérifiée. Ce sont des validations documentaires, pas une exécution des tests de l'application.

Lors de la campagne, ajouter seulement les résumés et extraits nécessaires à chaque assertion. Exclure `.env`, fichiers runtime privés, URL PostgreSQL, mots de passe, cookies, en-têtes d'authentification, tokens, traces navigateur brutes, liens S3 signés et reçus/données personnels. Les trois captures facultatives de transfert restent à produire après exécution. Conserver le SHA et la portée des anciennes preuves ; ne pas les renommer comme preuves du SHA de remise.
