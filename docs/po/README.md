# Dossier produit, preuves et soutenance ARLA

Préparation du 26 octobre 2026 pour le fork **Mindsept/expense-io**. Responsable produit : Hugo. Ce dossier rassemble les décisions déjà consignées et les preuves des auteurs ; il ne leur attribue pas une nouvelle validation humaine.

**Compléments PO-01 validés par Hugo le 26 octobre**, par sa réponse « Valider ces règles » dans la conversation : dates futures acceptées, quatre formats de justificatifs dans la limite technique de 10 MiB, total autorisé/filtré, récupération et modification/annulation hors version, invitation de 48 heures à usage unique délivrée au destinataire exact par lien privé. La configuration privée de livraison reste à fournir ; la recette produit et la répétition de soutenance sont distinctes de cet arbitrage.

- [PO-01 — règles, contrats et responsabilités](regles-et-contrats.md)
- [PO-02 — audit, architecture et index des preuves](audit-et-preuves.md)
- [PO-04 — déroulé de soutenance et exercice assisté](soutenance.md)
- [Revue documentaire de la référence performance paginée](revue-performance-20261026.md)
- [Recette finale MATH-04 / PO-03](../recette-finale.md) et [fiche d'exécution](../evidence/MATH-04/final-campaign.json)

La base examinée est `888a74ddae9db28378596adc7709358798986e49`. Les livrables en PR ont leurs propres SHA dans l'index. Une campagne de branche, une revue documentaire, une recette navigateur et une acceptation produit sont quatre preuves différentes. Le candidat testé est identifié ci-dessous ; les nouveaux résultats ne remplacent pas les rapports historiques.

La campagne automatisée du candidat intégré `f6592bcc53ddceb77038bccda43072355673a54c` a réussi : **748 unitaires, 254 API, 42 E2E**, huit étapes réussies. La [matrice RLS](matrice-rls.md) rattache notamment le nouveau contrôle direct des cinq tables de notification. L'intégrateur centralise journaux, environnement et parcours navigateur dans le dossier MATH-04 ; ces résultats ne cochent pas l'acceptation personnelle PO-03 ni la répétition PO-04.
