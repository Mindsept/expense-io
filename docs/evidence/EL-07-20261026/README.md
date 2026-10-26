# ARLA-37 — zoom natif et clavier, 26 octobre 2026

Application construite depuis `e0125dac546b55f535dcd7fd1c963610206c3c1f`,
branche `codex/arla-final-integration`, exclusivement dans `Mindsept/expense-io`.
Contrôle effectué par Codex à la demande de Hugo, dans Chrome Windows, sur
`http://127.0.0.1:3210` avec le vrai rôle `expense_web`, la cible restaurée
MATH-06 et des comptes/notes synthétiques. Aucune interception réseau.

Le contrôle natif confirme **200 % dans l'interface de Chrome**. Les captures
proviennent de la fenêtre réelle (2137 × 1287 pixels, interface Chrome incluse),
pas d'une réduction de viewport présentée comme du zoom. Le zoom a été remis à
100 % à la fin. Les scénarios automatisés à 320 pixels CSS restent une preuve
complémentaire et distincte.

| Écran / action | Observation | Capture |
| --- | --- | --- |
| Employé, formulaire à 200 % | Montant, date, description, reçu, aide et soumission visibles, sans chevauchement bloquant | [formulaire et indicateur Chrome](employee-200.png) |
| Employé, historique après redémarrage | Deux notes, total 61,25 € ; note de 18,75 € approuvée, décision « Manager, 26 octobre 2026, 18:07 UTC+1 » conservée | [historique](employee-history-200.png), [décision](employee-decision-200.png) |
| Employé, clavier à 200 % | Depuis la décision, Maj+Tab atteint le tableau ; flèche droite déplace sa barre horizontale, Tab/Entrée permettent de refermer le détail ; contour de focus visible | [tableau au clavier](employee-table-keyboard-200.png) |
| Manager à 200 % | Note en attente 42,50 €, total, reçu, approbation/refus et pagination lisibles ; Tab atteint Approuver avec contour visible | [écran](manager-200.png), [focus](manager-keyboard-200.png) |
| RH à 200 % | Recherche, annuaire, rattachement et file de validation accessibles ; changement du manager de Demo vers aucun via Home/Entrée confirmé | [annuaire](hr-200.png) |
| RH, recours et clavier | La note de Demo apparaît dans « Notes à valider par les RH (1) » ; reçu, décisions, total et pagination visibles ; Tab atteint Approuver avec contour visible | [recours](hr-fallback-200.png), [focus](hr-keyboard-200.png) |

Le rattachement Demo → Manager a été rétabli via le sélecteur (End/Entrée) :
« Affectation enregistrée », valeur Manager et file RH à zéro ont été observés.
Les boutons de décision ont été parcourus au clavier sans traiter la dernière
note de seed pendant cette passe. Les décisions réelles précédentes et les
assertions de retour au titre sont rattachées séparément à la recette MATH-04.

## Correction du test

Le renommage RH `8cb3208` avait laissé une recherche commune
`/en attente, tableau défilant/` dans l'assertion de focus EL-07. Elle ne
correspondait plus au nom RH. `e0125da` donne à chaque écran son nom exact de
région et conserve `toBeFocused`, les touches Tab/Entrée, le retrait de ligne,
l'annonce de succès et l'accès au reçu. Aucun test ignoré ni assertion retirée.
L'[échec précédent](../MATH-04/windows-label-failure-20261026/e2e.log) est conservé.
Le [bilan de campagne](../MATH-04/final-campaign.json) porte le résultat du rejeu.

## Portée

Cette vérification ciblée démontre les observations ci-dessus sur ces données
et cette fenêtre. Aucun lecteur d'écran n'a été utilisé (optionnel dans le
ticket), aucun audit WCAG global ni réception personnelle d'Elyes, Leandro ou
Hugo n'est revendiqué. La réception produit ARLA-8 reste séparée.
