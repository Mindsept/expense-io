# LE-09 — Requête RH mesurée, index et retour vérifié

Résultat : conserver la requête RH qui filtre les auteurs éligibles avant le
scan des notes, **avec** l'index `(user_id,status)` nécessaire à ce parcours.
La requête manager reste celle de main. Aucun rôle, policy, helper DB/acteur,
DTO, contrat HTTP, dépendance, écran ou runner partagé n'est modifié.

## Décision et preuves

L'index seul ne donne pas un gain HTTP concluant. Sur10 000 notes, médianes
employé13.75→13.79ms et manager294.23→294.01ms ; RH479.14→450.42ms mais p95
605.05→651.90ms, avec variabilité lors du retour arrière. Il ne justifie pas à
lui seul une optimisation. Les plans identifient surtout le coût des contrôles
RLS sur des notes ensuite exclues de la file RH.

Le candidat SQL utilise `users u JOIN LATERAL (...) en`, avec le **même**
`expenseValidatorSql('hr_admin',1,2)`. `OFFSET 0` conserve la frontière du scan
par auteur, évitant sa fusion en un scan global. RLS reste activée/forcée et
évaluée sous le vrai LOGIN expense_web ; le filtre ne remplace pas une policy.
queryPage continue de calculer lignes, compte et montant dans le même snapshot.

Les comparaisons SQL sont alternées référence/candidat puis candidat/référence,
sur les mêmes données, connexion, rôle, paramètres et cache non vidé. Chaque
plan provient du SQL construit par **queryPage réel**, pas d'un SELECT simplifié.
Chaque paire exécute aussi les deux lectures et exige l'égalité complète de leur
résultat (lignes20, ordre, métadonnées et totaux), pas seulement un temps plus bas.

| Notes / profil | Index | Référence SQL médiane ms | Requête RH candidate ms | Échantillon |
| --- | --- | --- | --- | --- |
| 1 000, géométrie MATH-05 | non | 62.827 | 19.930 | 3 par variante, phase before |
| 10 000, géométrie MATH-05 | non | 591.926 | 212.963 | 3 par variante, phase before |
| 10 000, géométrie MATH-05 | oui | 607.224 | 206.154 | 3 par variante, phase indexed |
| 10 000, géométrie MATH-05 | non après retrait | 627.017 | 380.769 | 3 par variante, phase rollback |
| 10 000, 100 auteurs éligibles | non | 790.527 | 917.612 | 3 par variante |
| 10 000, 100 auteurs éligibles | candidat indexé | 790.527 sans index | 721.998 | 3 par variante |

La contre-épreuve à 100 auteurs empêche de retenir la requête seule : sans index,
elle répète 100 scans séquentiels, chacun éliminant 9930 lignes. Avec l'index, le
plan utilise 100 Bitmap Index/Heap Scans, 70 notes en moyenne par auteur, sans ces
993 000 éliminations répétées. C'est **l'ensemble requête + index** qui est
retenu, pas l'index isolé du premier essai. Le changement manager est écarté :
sur 10 000 notes sans index, médianes SQL 255.542→257.164ms, non concluant.

Les gains cités concernent ces observations SQL locales, n=3 par variante ; aucun
p95 SQL de population n'en est déduit. Les distributions HTTP répétées, y compris
erreurs et p95 empiriques sur 90 tentatives, sont conservées mais ne démontrent
pas un gain HTTP général : charge partagée et dérive pendant les campagnes.
Le résultat n'est ni une capacité de production ni un SLO. Un nombre d'auteurs,
une répartition ou des volumes différents demandent une nouvelle mesure.

## Origine et conditions

Référence MATH-05 reçue techniquement depuis PR17, commit publié `24ab0c1`,
campagne historique source `a48fb9c`. Protocole et fixtures relus : deux volumes,
moitié des notes par auteur employé/manager, statuts 70/20/10, montants/dates
déterministes, trois passages de 30 requêtes, concurrence 4, trois échauffements
par route. La référence historique était une liste complète ; **aucun de ses
chiffres n'est renommé en mesure des pages actuelles**. Sa PR reste gérée par
Mathis ; cette réception technique n'invente pas une acceptation humaine.

Adaptation Leandro : pages explicites 1/20, `runtimeFixture` HA-04 (base privée,
vrai web LOGIN, administrateur séparé, un RH initial supplémentaire), mêmes
formules de génération MATH-05. UUID/mots de passe frais ; égalité exigée à
l'intérieur de chaque campagne. Pas de reçu S3 par ligne ni d'OCR dans ce test
de listes. Cache OS/DB non vidé, ANALYZE des fixtures avant chaque phase, poste
partagé, Node 24.22.1/npm 11.19.1/Next 16.4.3, macOS arm64, PostgreSQL 16.15.

| Artefact | Source exécutée | Contenu |
| --- | --- | --- |
| index-only/1000 et10000 | `fffff010d7494943788cafa83107050c5ea06684` | index seul, avant/indexé/retour,1620 requêtes mesurées au total sans erreur |
| paired/1000 et10000 | `dfdee43f472e6defed9abccfee503130a32e7664` | alternatives SQL alternées,1620 requêtes mesurées sans erreur, comparaisons exactes |
| fanout/fanout | `fc31efafabab4505dfe12d6b2a96a056652f693f` | 100 auteurs/10 000 notes,9 plans SQL,3 variantes, égalité des résultats |

Les sources restent atteignables dans l'historique de la branche. Les détails
bruts sont des JSON compressés sans perte sous [LE-09/](LE-09/manifest.json),
avec SHA256 des octets JSON et empreintes du code/lockfile dans les conditions.
Lecture : `gzip -dc docs/evidence/LE-09/paired/10000.json.gz`. Aucun reçu personnel,
texte OCR, cookie, mot de passe, URL DB ou lien signé n'est publié. Les UUID des
plans sont ceux des fixtures fictives.

## Régression, migration et exploitation

`1793000000000_leandro_expense_list_index.sql` crée uniquement un B-tree sur
expense_notes(user_id,status) ; son down retire uniquement cet index. Le test
applique down/up/down/up dans la base privée, vérifie l'existence physique, les
empreintes des notes, des policies et des droits à chaque phase, puis restaure
l'état initial. Le contre-cas100 auteurs vérifie aussi les trois variantes.
Les scénarios anonymes, les résultats de listes et les tests HA-04/LE-07 réels
sont conservés. Aucun seuil de temps fragile n'est une assertion de CI.

L'index occupait90 112 octets sur la fixture10 000 notes à deux auteurs. Chaque
insertion et changement de statut entretient ce B-tree ; le coût d'écriture et
le WAL ne sont pas benchmarkés ici. CREATE INDEX ordinaire prend un verrou
incompatible avec les écritures pendant sa construction : prévoir une fenêtre
adaptée au volume réel. Aucun déploiement sur une base personnelle n'a lieu.
Un rollback d'exploitation doit retirer la migration **et** rétablir la requête
RH précédente pour éviter le parcours non indexé à grand nombre d'auteurs.
Ni la migration ni son retour ne modifient les notes ou permissions.

Rejouer la régression standard : `npm run test:ci` ; les trois tests LE-09 sont
toujours collectés et exécutés, avec assertions de données/permissions/plans.
Rejouer les répétitions de charge : `LE09_MEASURE=1 npm run test:ci`, dans la
stack isolée du runner, jamais sur la base de développement. Le mode standard
fait une requête par scénario ; ses latences ne sont pas une campagne n=90.

La campagne index-only avait une chaîne complète verte 678 unitaires / 241 API / 29
E2E. Les deux tests de mesures paired ont passé mais sa chaîne globale rapporte
un EPERM macOS au nettoyage LE-08 (240 API réussis/1 échec, E2E non exécutés).
La contre-épreuve fanout a été exécutée séparément dans une copie privée du
runner limitée aux trois tests LE-09, après un nouvel EPERM d'un test unitaire
d'arrêt de processus : **ce diagnostic n'est pas une CI complète verte**.
Les résumés historiques préservent ces limites. La PR/Jira consignent la
validation finale de la tête exacte, puis le commit intégré. Aucune relecture
humaine indépendante n'est revendiquée.
