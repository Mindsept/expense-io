# MATH-07 / ARLA-45 — correctifs de dépendances

Branche `codex/arla-45-dependency-updates`, empilée sur ARLA-40. Prescription [HA-08](../security/HA-08/README.md) et périmètre approuvés par Mathis.

## Résultat constaté le 22 octobre 2026

Next et eslint-config-next **16.3.8**, overrides **sharp 0.35.5** et **source-map-js 1.2.2**. Les autres dépendances directes restent inchangées. Les seuls changements de versions transitives concernent les familles Next/sharp et source-map-js ; la copie imbriquée source-map-js de Vite est dédupliquée. [Diff du verrouillage](MATH-07/lock-changes.json), [arbre installé](MATH-07/dependency-paths.txt), [versions et codes](MATH-07/metadata.json).

| Contrôle réellement exécuté | Résultat |
| --- | --- |
| Installation propre Node 24.22.1 / npm 11.19.1 | Succès ; [log](MATH-07/install.log), lock inchangé par npm ci |
| Audit complet avant / après | 8 paquets (7 high, 1 critical) → 5 high, tous issus du même avis braces |
| Audit production avant / après | 3 paquets (2 high, 1 critical) → **0 alerte** |
| Chaîne ARLA-40 locale complète | Lint, typage, collecte, build production : succès ; **234 unitaires, 19 API/intégration, 3 E2E**, sans cas ignoré |
| sharp natif sur macOS ARM64 | Import et PNG 16×16 → 8×8 réussis ; sharp 0.35.5, librsvg 2.63.2 ; [versions réellement liées](MATH-07/native-sharp.json) |
| MCP Next dev | POST initialize depuis origine étrangère : **403 Unauthorized**, aucune donnée MCP ; origine locale : **200**, résultat initialize |
| MCP production | Même POST : **404** pour les deux origines ; [méthode, statuts et CSS](MATH-07/mcp-css.json) |
| CSS de production | Fichier généré servi 200, 23 858 octets ; trois pages de rôles exercées dans Chromium |

Les JSON d’audits bruts avant/après sont dans [MATH-07/](MATH-07/). Une sortie d’audit non nulle est conservée, pas masquée. Aucun `audit fix --force`, changement de configuration métier ou approbation supplémentaire de script d’installation. Les tests existants couvrent auth, refus anonymes, soumission de formats autorisés et OCR réel ; ils ne constituent pas une recette finale exhaustive.

## Limites et décisions attendues

- **braces / GHSA-vfj7-8cjw-p6xm** : un avis unique, cinq lignes propagées dans la chaîne ESLint de développement ; aucune version corrigée publiée dans la qualification. Aucune entrée HTTP de glob et aucun `settings.next.rootDir` dans le dépôt inspecté. Exception proposée par HA-08, **non acceptée** : Hamza requalifie, Hugo accepte ; revue proposée le **28 octobre 2026** ou dès changement d’exposition/correctif. L’alerte reste ouverte.
- ESLint 9 hors support : qualification séparée ESLint 10/plugins à planifier ; aucune migration majeure dans ce patch.
- Le binaire natif est contrôlé sur le poste macOS ; l’OS de livraison n’est pas confirmé. La requalification sharp Linux/déploiement reste à Hamza avant livraison.
- Le rôle DB de la référence est superutilisateur/BYPASSRLS. Aucune isolation multi-entreprises prouvée ; HA-04/ARLA-13 reste une dépendance externe. La recette finale ARLA-42 reste non exécutée.
- Revue humaine Hamza attendue ; les résultats locaux et distants sont distingués. Aucune clôture de sécurité globale.

Reproduction : `npm ci`, `npm run test:ci`, `npm ls next eslint-config-next sharp source-map-js braces --all`, audits complet/production. Utiliser la paire épinglée et Docker local. Les overrides doivent être réexaminés quand les contraintes amont garantissent les corrections pour ne pas bloquer de futurs patchs.

## Réalignement après intégration parallèle

Hugo a intégré une autre orchestration ARLA-40 dans main via #14 (`a0a0ab0`). La PR ARLA-40 #15 est remplacée, sans fusion. Cette branche conserve intégralement le runner, les protections, les tests et les corrections applicatives déjà intégrés dans main. Elle réapplique uniquement les patchs de dépendances et épingle la paire runtime qualifiée. Les preuves ci-dessus décrivent le premier passage avant ce réalignement ; une nouvelle campagne sur l’arbre intégré sera conservée séparément.
