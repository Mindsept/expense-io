# Preuves MATH-04 — candidat intégré, 26 octobre 2026

Ce dossier distingue les campagnes automatisées, le parcours réel réalisé par l'assistant et la réception personnelle d'Hugo. Voir [le dossier de recette](../../recette-finale.md) pour les scénarios, limites et actions restantes.

- [final-campaign.json](final-campaign.json) : index structuré des versions, résultats, parcours et limites ; [l'acceptation produit PO-03](../../po/reception-20261026.md) a été donnée par Hugo. La répétition PO-04 reste à faire.
- [windows-integrated-20261026/metadata.json](windows-integrated-20261026/metadata.json) : première campagne complète sur `f6592bcc53ddceb77038bccda43072355673a54c`, checkout propre ; Windows x64, Node 24.22.1, npm 11.19.1 et images identifiées.
- [windows-integrated-20261026/summary.json](windows-integrated-20261026/summary.json) : huit étapes réussies, codes 0 et durées réelles. Les journaux adjacents établissent **748 unitaires, 254 API et 42 E2E réussis**.
- [branch-checks.json](branch-checks.json), [current-branch-checks.json](current-branch-checks.json), [status-review-20261026.md](status-review-20261026.md) : relevés historiques conservés avec leur SHA. Leurs attentes anciennes ne sont plus un état courant de la campagne.

Le parcours navigateur sur `f6592bc` a utilisé la cible restaurée et les données fictives sans interception réseau : soumission réelle et reçu, approbation manager au clavier, apparition/retrait du recours RH après changement de manager, refus RH au clavier. Il a révélé un libellé RH corrigé dans `8cb3208`. Le rejeu complet sur `ebef48d` donne **748 unitaires et 254 API réussis, 41 E2E réussis et un échec** : un sélecteur EL-07 ligne 53 utilise encore l'ancien nom de région. L'échec est [archivé](windows-label-failure-20261026/e2e.log). Le correctif `e0125da` est validé par [la campagne finale](windows-final-20261026/summary.json) : 748 unitaires, 254 API et 42/42 E2E, dont 10 EL-07, huit étapes à zéro.

Le serveur partagé de CI utilise une connexion bootstrap privilégiée. Les preuves de vrais logins limités sont les scénarios spécifiques HA-04/HA-09, dont le nouveau test de refus direct sur cinq tables peuplées. Les scénarios réseau d'Elyes utilisent des interceptions ciblées ; le parcours manuel réel n'en utilise pas. La petite largeur 320 CSS est couverte par les tests ; le [zoom natif 200 % et le clavier](../EL-07-20261026/README.md) ont été observés sur les trois écrans. Aucun lecteur d'écran ni audit WCAG global n'est revendiqué.

Les règles PO-01 ont été approuvées par Hugo le 26 octobre, indépendamment de sa réception des parcours. Aucune approbation de relecteur absent ni répétition collective n'est inventée.

Les journaux publiés sont expurgés. Les originaux privés, fichiers runtime, `.env`, cookies, clés et liens S3 signés restent hors de ce dossier. Les captures natives sont rattachées au code `e0125da` dans EL-07-20261026. Un nouveau commit de preuves ne transforme pas automatiquement une ancienne exécution en validation de code nouveau.
