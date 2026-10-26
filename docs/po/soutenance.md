# ARLA-9 / PO-04 — déroulé de soutenance et entraînement

Support préparé le 26 octobre 2026, **sans répétition collective ni chronométrage humain revendiqués**. Les deux séquences de 15 minutes viennent de la diapositive 49 du cours 1–2. L'exercice ci-dessous est une préparation indépendante : il ne prétend pas anticiper le sujet surprise des enseignants.

## Présentation : 15 minutes prévues

| Minute | Porteur proposé, à confirmer par l'équipe | Message et preuve à montrer |
| --- | --- | --- |
| 0:00–1:30 | Hugo | Expense.io, trois rôles, deux entreprises et problème observé. Afficher le fork Mindsept et la chaîne audit → ticket → preuve. |
| 1:30–4:00 | Hamza | Identité courante, isolation et décision unique. Montrer un refus interentreprises et une décision gagnante / conflit ; expliquer le vrai rôle DB, pas seulement « RLS activée ». |
| 4:00–6:30 | Leandro | Soumission/reçu et retry ; pourquoi une transaction SQL ne couvre pas S3. Montrer clé stable, une seule note, puis OCR facultatif borné. |
| 6:30–9:00 | Elyes | Formulaire conservé après erreur, date civile, pagination et totaux. Démontrer le retour à un état utilisable au clavier. |
| 9:00–11:30 | Mathis | Stack jetable, collecte/CI, seed relançable et restauration. Choisir une preuve datée ; montrer le protocole des mesures et ses limites. |
| 11:30–13:30 | Hugo + auteur concerné | Schéma intégré et trois compromis : monolithe modulaire, reprise DB/S3, OCR synchrone. Ne pas attribuer de code jamais relu à un membre. |
| 13:30–15:00 | Hugo | Résultats de la recette effectivement exécutée, limites et ce que l'équipe ferait ensuite. Garder une marge de transition, conclure à 15 minutes. |

Chaque porteur confirme sa partie et s'exerce à expliquer le diff. Ce tableau propose une répartition ; il n'atteste pas que la personne l'a acceptée ou répétée.

## Démonstration à préparer

Utiliser une cible **fictive, dédiée et loopback** issue du guide MATH-03, avec SHA exact affiché dans le dossier de recette. Ne pas réinitialiser une base personnelle pour obtenir une belle démo. Le runbook fourni dans la [PR #27](https://github.com/Mindsept/expense-io/blob/82e88df8cb383fd771ce47ed660a9b6ff6d6edf2/docs/demo.md) doit être remplacé par le lien de la version intégrée après validation.

1. Employé : déposer une note avec justificatif, retrouver montant/date/statut et ouvrir le reçu.
2. Manager : retrouver la note, approuver ou refuser, puis montrer la décision conservée côté employé.
3. RH : montrer le périmètre et le recours prévu, sans auto-approbation ni accès à une autre entreprise.
4. Un cas d'échec : reprise de formulaire ou accès refusé dans la cible de test. Préférer les outils ciblés fournis ; ne pas couper le réseau de la machine.
5. Un contrôle d'exploitation : relance du seed sans doublon ou consultation d'une cible restaurée, avec preuve de conservation.

Les secrets et mots de passe de démonstration restent dans le canal privé de l'opérateur. Une capture contenant identifiants ou capacités d'invitation ne va pas dans le dépôt. Les secours sont les rapports réels [EL-08](https://github.com/Mindsept/expense-io/tree/db3dab614bb18ef236a1ff60da7f59d721f43e7a/docs/evidence/EL-08), [HA-09](../evidence/HA-09-Runtime-2026-10-25/README.md) et [CI](https://github.com/Mindsept/expense-io/actions/runs/40217509555), annoncés avec leur date et SHA si le direct est indisponible.

## Exercice IA proposé : afficher une description restante

Sujet d'entraînement : ajouter au formulaire de note un compteur discret de caractères restants, synchronisé avec la limite existante de 4000 unités UTF-16. Aucun changement API, DB, permission, dépendance ou plafond produit. Cela oblige à lire le contrat existant et à vérifier l'accessibilité, tout en restant assez petit pour quinze minutes. **Exercice non exécuté dans cette préparation documentaire.**

Critères : compteur exact à vide, après saisie et au plafond ; un collage trop long ne doit pas contourner la validation existante ; état conservé après une erreur de soumission ; pas d'annonce vocale à chaque frappe ni de perte de focus ; libellé associé compréhensible. La définition UTF-16 est un choix technique existant à expliquer, pas « 4000 lettres » promis pour tous les graphèmes.

Prompt préparé :

> Dans le fork Mindsept et une branche d'entraînement séparée, lis d'abord le formulaire de note, son validateur et ses tests. Ajoute uniquement un compteur de caractères restants cohérent avec la limite technique existante de description, sans modifier l'API, les droits ou les dépendances. Donne un plan court et les fichiers concernés, préserve les reprises après erreur et le focus clavier, puis montre le diff et les commandes réellement exécutées. Ne déclare aucun test réussi sans résultat. Explique les limites Unicode du compteur et pourquoi tu n'utilises pas une région live annonçant chaque frappe.

| Créneau visé | Travail | Preuve à noter pendant la vraie répétition |
| --- | --- | --- |
| 0–3 min | Lire contrat et composants, définir critères, proposer petit plan | Fichiers identifiés, question éventuelle, heure réelle |
| 3–8 min | Implémenter la modification limitée | Diff, correction humaine éventuelle, heure réelle |
| 8–12 min | Tests ciblés et parcours clavier | Commande/code de sortie, comportement normal et limite/erreur |
| 12–15 min | Relire diff, expliquer choix et limites | SHA, conclusion, reste à faire, durée réelle |

À l'issue, conserver l'exercice dans sa branche ; ne pas le fusionner automatiquement dans la version de remise. Si le délai expire, montrer ce qui fonctionne et ce qui reste non testé. Les durées ci-dessus sont un budget proposé, pas des temps mesurés.

## Questions de soutenance et points d'appui

| Question | Réponse à construire avec le code |
| --- | --- |
| Pourquoi pas des microservices ? | Taille de l'équipe/application, transactions locales et échéance ; extraction de cas d'usage testables suffit au besoin actuel. |
| Que prouve la RLS ? | Connexion réellement limitée, contexte d'acteur, policies et refus testés ; le badge de CI bootstrap n'est pas cette preuve. Voir [matrice](matrice-rls.md). |
| Comment deux RH concurrents sont-ils traités ? | Transition conditionnelle et audit/intention dans la transaction ; une décision réussit, l'autre obtient un conflit ; notification sans pouvoir supplémentaire. |
| Pourquoi SQL + S3 n'est-il pas atomique ? | S3 n'est pas participant à la transaction PostgreSQL ; expliquer compensation, registre d'intention, réconciliation et état incertain. |
| Pourquoi pas une file OCR ? | OCR facultatif et borné, saisie manuelle ; une file ajouterait états et exploitation sans besoin mesuré actuel. L'outbox des notifications répond à un autre besoin. |
| Quelle amélioration de performance ? | Comparer seulement des protocoles comparables. Les nouvelles pages de 100 ne sont pas l'ancienne liste complète ; montrer mesures et contre-exemples LE-09. |
| Qu'a raté ou aidé l'IA ? | Exemple concret de débordement détecté par campagne, contrôle négatif de reprise et échecs préservés ; expliquer la relecture au lieu d'inventer une validation. |
| Qu'est-ce qui n'est pas livré ? | Sujets hors périmètre explicités, réception utilisateur et répétition tant qu'elles ne sont pas faites, limites de la mesure et de l'accessibilité. |

## Journal de répétition à remplir réellement

| Élément | Résultat |
| --- | --- |
| Date, participants, SHA de démo | Non renseignés : répétition non exécutée |
| Durée présentation / développement | Non mesurées |
| Parcours normal / échec | Non observés dans une répétition collective |
| Questions mal expliquées et correction | À consigner |
| Prompt, diff, tests de l'exercice | Préparés ci-dessus ; exécution à joindre |
| Acceptation d'Hugo et relecture des auteurs | Non recueillies par ce document |

Le 27 octobre peut servir à la répétition collective ; le 28 reste l'objectif de remise et la marge du plan initial. Ce document ne crée aucun rendez-vous ni rappel et n'envoie aucun message à l'équipe.
