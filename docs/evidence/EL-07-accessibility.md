# EL-07 — Obstacles d’usage observables

Ticket : ARLA-37. Base : `a653a002` (EL-05, PR #29 du fork Mindsept/expense-io).
La correction portable des inventaires OpenAPI de Mathis (`5b7c992`, reprise
locale `c754530`) est une dépendance distincte, sans modification de ses assertions.
Périmètre initial : trois écrans, pagination si nécessaire et tests E2E d’Elyes.
Le passage sur l'application complète ajoute la correction de l'en-tête partagé
décrite plus bas ; aucune modification du backend, des dépendances ou de la
configuration des tests.

## Observations avant modification

Lecture des composants le 25 octobre 2026 :

- Les labels des champs et des sélecteurs RH, les messages `alert`/`status`,
  les tableaux tabulables et le retour au titre après décision existent déjà.
- Les totaux manager/RH et leurs titres annoncent zéro avant la première réponse,
  y compris après un échec initial : absence de données et indisponibilité sont confondues.
- Deux notes de même auteur/description, à des dates différentes, ont les mêmes
  noms d’action ; deux collaborateurs homonymes ont le même label de manager.
- Après une décision RH ou une relance, une réponse tardive replace toujours le
  focus sur le titre, même si l’utilisateur a repris la saisie dans un autre champ.
- Les détails du circuit imbriquent `aria-live` et `status`/`alert`.
- L’aide du reçu n’indique pas les formats précis ni le plafond de soumission
  effectivement présent dans `src/lib/expense-input.ts` (10 × 1024 × 1024 octets).

Observation Chromium avant correction CSS, avec les composants réels et leurs
styles chargés par Vite déjà présent transitivement (aperçu temporaire ignoré,
données fictives, sans serveur Auth.js/DB ni en-tête applicatif) :

- À 320 × 720, la page employé fait 320 pixels ; manager 502 et RH 508.
  Les tableaux font bien 286 pixels et défilent au clavier, mais les labels
  `sr-only` positionnés absolument sortent de la zone de défilement, faute de
  conteneur positionné. Captures de ces deux défauts conservées localement.
- La pagination comprime « 1 / 1 » sur trois lignes à cette largeur.
- Couleurs calculées dans Chromium, converties en sRGB par canvas : le texte
  « Approuver » sur blanc est à 3,22:1 ; le texte bleu sur fond sombre à 3,43:1
  et « Rejeter » sur fond sombre à 3,72:1. Les statuts restent aussi en texte.
  Ces mesures ciblées ne constituent pas un audit de tous les contrastes.

## Plan limité à ces constats

1. Ne publier les compteurs qu’après une réponse valide ; garder les derniers
   résultats en cas d’échec de rafraîchissement.
2. Distinguer les actions par date et les homonymes RH par email ; nommer les
   régions des tableaux et les contrôles de détails.
3. Rétablir le focus uniquement si l’utilisateur n’a pas choisi un autre contrôle.
4. Garder une seule région d’annonce pour un détail ; relier l’aide au fichier.
5. Ajouter des assertions comportementales et une recette clavier/zoom/mobile.
   Observer le rendu avant une éventuelle correction CSS.

## Validation

Exécution Windows avec Node 24.22.1 et npm 11.19.1, le 25 octobre 2026 :

| Commande | Résultat observé |
| --- | --- |
| `npm ci` | installation terminée ; lockfile inchangé |
| `npm run verify` | lint sans erreur (un avertissement HA-09 préexistant), typage réussi ; 673 tests unitaires réussis après reprise de la correction Windows de Mathis |
| `node node_modules/playwright/cli.js test --project=e2e tests/e2e/elyes --list` | 27 scénarios collectés dans 7 fichiers, dont 10 EL-07 ; aucune exécution de scénario par cette commande |
| Chromium, aperçu temporaire des composants | 10 scénarios EL-07 réussis en 10,7 s ; seule la connexion est remplacée par le montage direct du composant, les assertions sont identiques |
| `git diff --check` | réussi |

Le premier passage avait deux échecs dans les inventaires OpenAPI de HA-06 et LE-10 :
`path.join` produit des antislashs sous Windows, tandis que le contrat contient
des slashs. Ils sont résolus par le commit distinct de Mathis mentionné plus haut.
La collecte
globale sans environnement explicite a d’abord été refusée par son garde-fou ;
la collecte ciblée ci-dessus utilise `ARLA_TEST_ENV=isolated` et une URL locale
explicite, sans lancer le serveur ni utiliser de données personnelles.

Les scénarios EL-07 versionnés utilisent une vraie connexion de test puis des
réponses API contrôlées pour reproduire chargements, erreurs et latences. Le
passage sur l’aperçu exerce les composants réels avec leurs styles, mais ne
démontre ni la connexion, ni les règles métier backend, ni le layout partagé.
Il ne remplace pas la campagne sur l'application complète consignée ci-dessous.

Après les corrections CSS ciblées, Chromium mesure une largeur de document de
320 pixels pour les trois composants à une largeur de 320 ; les tableaux
défilent avec la flèche droite et Tab atteint leurs commandes. La pagination
revient à la ligne sans couper « 1 / 1 ». Les contrastes ciblés deviennent
4,95:1 pour Approuver/blanc, 12,49:1 pour bleu/fond sombre et 6,14:1 pour
Rejeter/fond sombre. Aucun thème ni dépendance ajouté ; seuls des utilitaires
existants sont employés. Les contrôles hors de cet aperçu, dont l’en-tête global,
et le zoom navigateur natif à 200 % ne sont pas validés par ce passage.

## Application complète et en-tête partagé — 25 octobre 2026

Le premier `npm run test:ci` sur l'application complète obtient **37/40 E2E
réussis**. Les trois échecs concernent `small viewport keeps the table in a
keyboard scroll region` pour employé, manager et RH : l'en-tête global déborde
à petite largeur. L'aperçu précédent ne montait pas cet en-tête et ne pouvait
pas valider ce point. Les [échecs](EL-08/windows-initial/e2e.log) et leur
[résumé](EL-08/windows-initial/summary.json) restent conservés, avec l'étape
E2E code 1 et le nettoyage code 0.

Le commit **`02ec22e2392eb92458b63089da683da59dc1560e`** autorise le retour à la
ligne dans le conteneur global et le formulaire de navigation, ajoute leur
espacement et borne la largeur de la navigation. Les assertions de petite
largeur sont conservées. Après restauration d'un contrôle négatif EL-04/EL-08
distinct, la campagne complète de ce SHA passe : **673 unitaires, 239 API,
40/40 E2E**, dont **10/10 EL-07**, préparation/build/nettoyage code 0.
Les trois cas de petite largeur passent désormais avec l'en-tête applicatif
réel et la connexion Auth.js. [Résumé positif](EL-08/windows-positive/summary.json),
[journal E2E](EL-08/windows-positive/e2e.log), [contexte et limites](EL-08/README.md).

Environnement : Windows, Node 24.22.1 / npm 11.19.1, Docker Desktop 4.96.3,
moteur 29.9.2, fuseau Europe/Paris. Lint sans erreur avec un avertissement
HA-09 préexistant, typage et collecte réussis. La
[CI distante 40205740218](https://github.com/Mindsept/expense-io/actions/runs/40205740218)
est également `success` sur `02ec22e` ; les comptes détaillés cités ici viennent
des journaux locaux. La sauvegarde des preuves et cette actualisation sont
documentaires, sans changement ultérieur du code testé.

Les réponses métier des scénarios Elyes restent contrôlées par Playwright :
le passage ne transforme pas ces tests en preuves DB/S3 ou de droits serveur.
Il ne constitue pas un audit complet d'accessibilité, un usage réel de lecteur
d'écran, une preuve de zoom navigateur natif à 200 %, ni une réception humaine.

## Recette à réaliser par Elyes et relire par Leandro

1. Sur les trois écrans, poser la souris : Tab/Maj+Tab pour parcourir les
   commandes, Entrée/Espace pour les activer. Le focus doit être visible et le
   contexte de chaque action doit être identifiable dans l’arbre d’accessibilité.
2. Soumettre une note valide et ouvrir son reçu ; comparer succès, refus et
   panne réseau. Vérifier que le message explique le résultat sans couleur seule.
3. Avec deux descriptions identiques à des dates différentes, approuver une note
   manager puis RH : focus au titre de la liste et accès à la ligne restante.
   Pendant une décision RH lente, écrire dans la recherche : la réponse ne doit
   pas déplacer le focus. Modifier un sélecteur manager au clavier.
4. Ouvrir le circuit puis son erreur contrôlée : une seule région d’annonce.
   Vérifier l’aide associée au fichier, sans confondre dépôt PDF et OCR image.
5. Refaire à 200 % de zoom navigateur et à 320 pixels de largeur. Vérifier que
   les tableaux défilent avec les flèches après Tab, et que texte, pagination,
   actions et messages restent accessibles sans chevauchement bloquant.
6. Mesurer dans le navigateur les contrastes qui posent problème. Consigner
   uniquement les défauts effectivement observés et leurs éventuelles captures.

La recette humaine par Elyes et la relecture Leandro restent à réaliser. Aucun
lecteur d’écran n’a été utilisé ; aucune conformité globale n’est déduite des
assertions DOM.

## Complément du 26 octobre 2026 — blocage levé

Le sélecteur RH résiduel est corrigé dans `e0125dac546b55f535dcd7fd1c963610206c3c1f` sans retirer
l'assertion de focus. La campagne complète sur ce code passe : **748 unitaires,
254 API, 42 E2E, dont 10 EL-07**. Le [contrôle natif Chrome à 200 %](EL-07-20261026/README.md)
a été réalisé sur employé, manager et RH, avec captures, navigation clavier,
défilement du tableau employé et contrôle de l'historique persisté. Cette preuve
complète les passages historiques ci-dessus ; lecteur d'écran et certification
globale ne sont pas revendiqués. L'acceptation personnelle ARLA-8 reste distincte.
