# HA-08 — Qualification des dépendances et prescription MATH-07

**Ticket : [ARLA-17](https://mindsept.atlassian.net/browse/ARLA-17). Auteur : Hamza. Relecture attendue : Leandro. Date : 21 octobre 2026 (Europe/Paris).**

La qualification propose trois corrections ciblées : Next et sa configuration ESLint en `16.3.8`, `sharp` en `0.35.5`, `source-map-js` en `1.2.2`. Leurs versions publiées et contraintes sont vérifiées ; leur intégration et leurs tests restent à réaliser par Mathis dans [MATH-07 / ARLA-45](https://mindsept.atlassian.net/browse/ARLA-45). **Ce changement documentaire ne corrige aucune dépendance et ne certifie pas l'application.** `package.json` et `package-lock.json` restent inchangés.

## 1. Référence reproductible

| Élément | Observation |
| --- | --- |
| Code examiné | `265924bc7274047989e708ab635c2854d376230f` |
| Audit commencé | `2026-10-21T13:50:39Z`, soit 15:50 à Paris |
| Exécution | macOS ARM64 ; Node `v26.8.1` ; npm `12.0.2` |
| SHA-256 du lockfile, avant **et après** les contrôles | `66354f1c764e3a8bb81ab169f36fa22b66a24d15090e70b04372359da3cb2453` |
| Audit complet | `npm audit --json`, sortie **1** : 8 paquets signalés, dont 7 high et 1 critical |
| Audit production | `npm audit --omit=dev --json`, sortie **1** : 3 paquets signalés, dont 2 high et 1 critical |

Les sorties JSON intégrales et les codes de sortie sont conservés dans [evidence/metadata.json](evidence/metadata.json), [audit complet](evidence/npm-audit-all.json) et [audit production](evidence/npm-audit-production.json). Les données d'avis sont celles retournées par le registre à cette date ; un audit futur peut évoluer sans modification du lockfile. La photographie locale du 18 octobre citée dans Jira n'a pas été fournie : aucune comparaison détaillée avec elle n'est revendiquée.

**8 paquets ne signifie ni 8 vulnérabilités distinctes, ni 8 exploitations possibles.** En dédupliquant les objets `via` par URL d'avis, on obtient **10 avis uniques** : 7 sur Next, 1 sur sharp, 1 sur source-map-js, 1 sur braces. L'audit production conserve **9 avis uniques**, y compris l'avis de développement Next parce que le paquet Next est une dépendance de production. L'unique avis braces propage sa gravité à **5 lignes de paquets**. Le décompte dérivé est dans [counts.json](evidence/counts.json).

## 2. Chaînes réellement installées et usages

Les versions viennent du lockfile et de `npm ls ... --all`, sortie 0 ; [arbre enregistré](evidence/dependency-paths.txt).

| Chaîne | Classement et chemin d'usage |
| --- | --- |
| `next@16.3.5` | Dépendance directe de production : `next dev`, `next build`, `next start`, routes `src/app/`, proxy `src/proxy.ts`, Server Actions d'authentification. `next-auth@5.0.0-beta.32` réutilise la même instance. |
| `next → sharp@0.35.4` | Dépendance optionnelle de production, installée sur cette plateforme. Moteur d'optimisation d'images de Next ; aucun import applicatif direct de sharp ou de `next/image`. |
| `next → postcss@8.5.23 → source-map-js@1.2.1` | Chaîne classée production par npm, surtout utilisée pour transformer le CSS lors du build. |
| `@tailwindcss/postcss@4.3.3 → postcss@8.5.28 → source-map-js@1.2.1` et `@tailwindcss/postcss → @tailwindcss/node@4.3.3 → source-map-js@1.2.1` | Chemins de développement/build partageant la même instance de source-map-js. `postcss.config.mjs` active Tailwind ; `src/app/layout.tsx` importe `globals.css`. |
| `eslint-config-next@16.3.5 → @next/eslint-plugin-next@16.3.5 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3` | Développement seulement. `eslint.config.mjs` importe les configurations Next. Le helper installé `@next/eslint-plugin-next/dist/utils/get-root-dirs.js` appelle `globSync` pour un `settings.next.rootDir` configuré ; le dépôt ne définit pas cette option. Aucune entrée HTTP n'alimente un glob. |

La recherche enregistrée dans [feature-search.txt](evidence/feature-search.txt), l'inventaire `src/app/` et la lecture des configurations corroborent les exclusions ci-dessous. Le seul match `next/image` est l'exclusion `_next/image` du matcher de proxy : **ce n'est pas un import du composant**. La sortie du build classe les pages applicatives comme dynamiques. Une recherche textuelle ne prouve pas à elle seule le comportement d'un déploiement absent du dépôt.

## 3. Qualification avis par avis

Définitions : **confirmée** = chemin exploitable démontré dans Expense.io ; **plausible** = préconditions compatibles mais exploitation non démontrée ; **non applicable** = une précondition nécessaire est absente du périmètre inspecté ; **non déterminée** = preuve de configuration ou d'exécution manquante. Aucun exploit applicatif n'a été confirmé ni exécuté. Les exclusions concernent ce SHA et doivent être réévaluées si les fonctionnalités changent.

Les sept avis Next portent tous sur le paquet installé `next@16.3.5`. Les plages ci-dessous sont celles de l'audit ; plusieurs pages d'avis mainteneur affichent encore `16.3.?`. La [publication officielle de Next 16.3.8](https://github.com/vercel/next.js/releases/tag/v16.3.8) nomme les six correctifs de septembre, ce qui lève cette ambiguïté pour la version candidate. Le correctif ImageResponse était déjà publié en 16.3.6.

| Paquet / avis primaire | Versions affectées → première correction retenue | Préconditions et exposition Expense.io | Cible, validation et risque |
| --- | --- | --- | --- |
| Next — [GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j), RCE ImageResponse | `>=16.2.0 <16.3.6` → `16.3.6` | **Non applicable au code inspecté** : exige `next/og` ImageResponse Node avec valeurs contrôlées par un attaquant dans du SVG. Aucun ImageResponse ni route de génération d'image. | `16.3.8` inclut ce patch ; V1/V2 ; risque framework/proxy/auth, pas de changement fonctionnel attendu. |
| Next — [GHSA-3w37-wq28-93x7](https://github.com/vercel/next.js/security/advisories/GHSA-3w37-wq28-93x7), fuite Draft Mode | `>=16.3.0 <16.3.8` → `16.3.8` | **Non applicable au code inspecté** : nécessite une fonction `use cache` et des requêtes Draft Mode concurrentes ; ni l'une ni l'autre n'est utilisée. | `16.3.8` ; V1/V2 ; vérifier l'isolation des sessions après le patch. |
| Next — [GHSA-4jqv-mc3x-m676](https://github.com/vercel/next.js/security/advisories/GHSA-4jqv-mc3x-m676), cache SSG/ISR auto-hébergé | Branche 16 : `>=16.0.0 <16.3.8` → `16.3.8` | **Non applicable au code inspecté** : avis visant Pages Router avec pages SSG/ISR auto-hébergées. Le dépôt utilise uniquement App Router ; aucun répertoire `pages`. | `16.3.8` ; V1/V2 ; requalifier si un Pages Router est ajouté. |
| Next — [GHSA-39w2-rjm5-chcv](https://github.com/vercel/next.js/security/advisories/GHSA-39w2-rjm5-chcv), endpoint MCP de développement | `>=16.0.0 <16.3.8` → `16.3.8` | **Plausible en développement** : `npm run dev` lance `next dev`, endpoint décrit comme accessible depuis un site malveillant visité par le développeur. Aucune exploitation vérifiée. **Non applicable à `next start`** selon le mainteneur. | `16.3.8` ; V1/V2/V3 ; prioriser la mise à jour du poste et du serveur de développement. |
| Next — [GHSA-f87g-xv8r-7p7x](https://github.com/vercel/next.js/security/advisories/GHSA-f87g-xv8r-7p7x), metadata images | `>=16.0.0 <16.3.8` → `16.3.8` | **Non applicable au code inspecté** : nécessite des routes metadata image dynamiques, des segments exclus par `generateStaticParams`/`dynamicParams` et webpack. Ces routes/options sont absentes ; build observé avec Turbopack. | `16.3.8` ; V1/V2 ; revoir si des routes metadata sont créées. |
| Next — [GHSA-mcj8-r9mp-w47p](https://github.com/vercel/next.js/security/advisories/GHSA-mcj8-r9mp-w47p), substitution de contenu/cache | Branche 16 : `>=16.0.0 <16.3.8` → `16.3.8` | **Non applicable au code inspecté** : nécessite une page catch-all à la racine et des routes SSG/ISR. Le seul `[...nextauth]` est un handler API, pas une page catch-all ; pages applicatives dynamiques. | `16.3.8` ; V1/V2 ; contrôler les routes et l'absence de réponses croisées. |
| Next — [GHSA-cjq9-62q9-8jv4](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4), SSRF images | `>=16.0.0 <16.3.8` → `16.3.8` | **Non applicable à la configuration inspectée** : exige une URL distante autorisée contrôlée par l'attaquant. Aucun `images.remotePatterns` dans `next.config.ts` ; le mainteneur exclut explicitement ce cas. | `16.3.8` ; V1/V2 ; conserver les restrictions d'images, ne pas élargir les hôtes pendant la mise à jour. |
| sharp — [GHSA-wq5f-xc86-pv6w](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), librsvg | `<0.35.5` → `0.35.5`, librsvg `2.63.2` | **Non déterminée pour le déploiement** : l'avis exige le décodage SVG et certaines conditions Linux/glibc. Aucun chemin applicatif vers sharp identifié ; reçus uploadés vers S3, OCR via Tesseract. L'absence d'import ne supprime pas le moteur Next ; OS/libvips/PIE du déploiement et accès effectif à l'optimiseur non vérifiés. Le poste macOS ne démontre pas le risque Linux. | `0.35.5` ; V1/V2/V4 ; binaire natif/libvips à vérifier sur l'OS de livraison. |
| source-map-js — [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), déni de service ; [correctif mainteneur](https://github.com/7rulnik/source-map-js/pull/79) | `>=1.0.0 <1.2.2` → `1.2.2` | **Plausible au build si une source map hostile est introduite** via CSS/dépendance. PostCSS consomme les source maps ; aucune route n'accepte de source map utilisateur. L'exploitabilité d'une requête HTTP n'est pas établie. | `1.2.2` ; V1/V5 ; validation plus stricte des offsets, risque de rejet d'anciennes maps malformées ; [release officielle](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2). |
| braces et ses 4 ancêtres — [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), récursion ; [signalement et réponse mainteneur](https://github.com/micromatch/braces/issues/70) | `<=3.0.3` ; **aucune version corrigée publiée trouvée**, dernier paquet `3.0.3` | **Non applicable à l'entrée HTTP inspectée ; non applicable au chemin de configuration actuel** : les motifs imbriqués hostiles sont la précondition ; le dépôt n'accepte pas de glob client et ne configure pas `settings.next.rootDir`. L'avis est contesté par le mainteneur, mais reste dans npm : ce désaccord ne justifie pas de le déclarer « faux positif ». | Maintenir `3.0.3` avec exception bornée ci-dessous ; V1/V6 ; aucune substitution ni rétrogradation majeure automatique. |

## 4. Prescription exacte pour MATH-07

**Responsable de l'intégration : Mathis ; requalification après intégration : Hamza ; acceptation : Hugo.** Les changements suivants sont proposés et n'ont pas été appliqués ici. Lire l'audit courant avant de les reprendre si le lockfile a changé.

1. **Runtime de référence proposé : Node `24.22.1` et npm `11.19.1`.** Le [registre officiel Node](https://nodejs.org/dist/index.json) fournit cette version de sécurité du 20 octobre et son npm embarqué ; [extrait enregistré](evidence/node-release.json). Node 24 est LTS, support planifié jusqu'au 30 avril 2028 dans le [calendrier Node](https://github.com/nodejs/Release/blob/main/schedule.json). Cela précise le « Node 24+ » du README. Mathis documente et épingle cette paire dans son outillage/CI. Node 26.8.1/npm 12.0.2 décrivent seulement notre mesure ; ils ne constituent pas la validation du runtime proposé. Ne pas faire tourner npm 12 sous Node 24 sans vérifier son propre champ `engines`.
2. Passer les deux dépendances directes `next` et `eslint-config-next` de **16.3.5 à 16.3.8**, avec versions exactes. Le [registre interrogé](evidence/registry-candidates.json) confirme l'existence des deux versions. Next exige Node `>=20.9.0`, accepte React/React DOM `^19.0.0` (le dépôt utilise `19.2.8`) ; `next-auth@5.0.0-beta.32` accepte Next `^16.0.0`. Le plugin ESLint garde sa version alignée par la dépendance exacte de `eslint-config-next`. Le couple Next 16.3.8 / config 16.3.8 évite une migration de minor non nécessaire ; la suggestion npm `next@16.4.2` n'est pas nécessaire pour les avis observés.
3. Contraindre temporairement **`sharp: 0.35.5`** et **`source-map-js: 1.2.2`** via `overrides` racine pour obtenir exactement les versions qualifiées, sans les ajouter artificiellement aux dépendances directes. Ces versions satisfont respectivement `^0.35.4` déclaré par Next 16.3.8 et `^1.2.1` déclaré par PostCSS et Tailwind. La mise à jour sharp entraînera les paquets natifs `@img/sharp-*` en 0.35.5 et libvips en 1.3.4. Revoir/retirer ces pins quand les contraintes amont et le lockfile garantissent les versions corrigées ; ils ne doivent pas bloquer silencieusement de futurs correctifs.
4. Garder React, Auth.js, PostCSS, Tailwind et les autres dépendances directes à leurs versions actuelles dans ce lot. L'avertissement d'installation **ESLint 9 en fin de support** est réel ([politique ESLint](https://eslint.org/version-support/)) : Mathis doit ouvrir/planifier une qualification séparée du couple ESLint 10 et de ses plugins. Ce rapport n'en déclare pas la compatibilité et ne mélange pas cette migration majeure avec les patchs de sécurité.

Commandes proposées à Mathis, dans son checkout d'intégration et après vérification du manifest actuel :

```sh
npm install --save-exact next@16.3.8
npm install --save-dev --save-exact eslint-config-next@16.3.8
npm pkg set 'overrides.sharp=0.35.5' 'overrides.source-map-js=1.2.2'
npm install --package-lock-only
git diff -- package.json package-lock.json
```

Les installations doivent employer la paire Node/npm retenue. Examiner chaque variation de lock : `next`, `@next/env`, les binaires SWC et le plugin/config Next doivent rester alignés ; les variantes natives sharp sont attendues. Si la résolution modifie d'autres dépendances directes ou entraîne un large renouvellement sans lien, diagnostiquer avant de continuer. **Ne pas lancer `npm audit fix --force`** : pour braces, l'audit suggère `eslint-config-next@14.2.35`, une rétrogradation majeure incohérente avec Next 16 et la configuration ESLint actuelle. Aucune version corrigée de braces n'est inventée.

La compatibilité indiquée est une compatibilité de contraintes et de patchs documentés, **pas une preuve que le nouvel arbre fonctionne**. Aucun changement métier n'est attendu. Si les tests révèlent une adaptation : Mathis décrit l'erreur et ouvre un sous-travail explicite pour Hamza (auth/autorisation), Leandro (soumission/OCR) ou Elyes (écrans), puis revalide l'ensemble ; il ne modifie pas leur module pour rendre la suite verte.

## 5. Preuves de validation exigées après mise à jour

| ID | Contrôle à exécuter par MATH-07, une fois MATH-01/02 disponibles | Critère observable |
| --- | --- | --- |
| V1 | Checkout vierge, `npm ci`, `npm ls next eslint-config-next sharp source-map-js braces --all`, `npm run lint`, `npm run typecheck`, `npm run build` ; puis audits complet/production | Installation sans mutation du lock ; versions attendues ; sorties conservées avec SHA, Node/npm et hash du lock ; tous les contrôles fonctionnels attendus passent. Les audits peuvent rester non nuls pour braces, sans cacher leur sortie. |
| V2 | `npm run verify`, `npm run test:api`, `npm run test:e2e` après configuration MATH-01/02 ; auth, inscription/connexion/déconnexion, refus anonyme, rôles, listes, soumission/reçu PNG/JPEG/WebP/PDF, suggestion OCR, décisions manager/RH | Mêmes contrats et isolation multi-entreprises ; absence de régression. Environnement de test dédié, base suffixée `_test`, bucket de test et garde-fou avant toute préparation/nettoyage. Ne pas lancer les fixtures sur le développement. |
| V3 | Contrôle du serveur `next dev` mis à jour : rejet d'un accès MCP depuis une origine non autorisée et fonctionnement des outils autorisés ; vérifier l'absence d'endpoint MCP servi en production | Conserver méthode, origine, statut et version serveur ; aucune donnée de développement renvoyée à l'origine hostile. Pas de test de navigateur malveillant contre un poste partagé. |
| V4 | Installation propre sur l'OS cible, import de sharp et lecture de `sharp.versions` ; exercice d'une transformation d'image inoffensive, puis parcours des reçus/OCR | Binaire chargeable ; sharp 0.35.5 et librsvg 2.63.2 ou correction ultérieure qualifiée. Si libvips global est utilisé, vérifier cette bibliothèque réellement liée ; le numéro du paquet JS seul ne suffit pas. |
| V5 | Build CSS et rendu d'une page ; scénario isolé de validation d'offsets source-map-js si une consommation de maps externes est ajoutée | CSS généré et affiché sans régression ; maps malformées rejetées de façon bornée. Ne pas exécuter de charge DoS dans le serveur partagé. |
| V6 | Relire `eslint.config.mjs`, chemins de glob et arbre de dépendances ; relancer lint | Aucun glob utilisateur ni nouveau chemin d'exécution non qualifié ; exception braces limitée à la chaîne documentée. |

Les suites `verify`, `test:api` et `test:e2e` **n'existent pas dans ce SHA** : elles ne sont ni exécutées ni déclarées passantes ici. Ce changement ne crée pas un runner concurrent ou des tests unitaires artificiels sur un document. MATH-01 reste une dépendance de validation, puis Leandro doit relire les preuves pour la clôture du ticket.

### Contrôles réellement exécutés dans HA-08

| Commande | Sortie | Résultat |
| --- | --- | --- |
| `npm ci` | 0 | 443 paquets installés. npm 12 a bloqué les scripts d'installation de `tesseract.js` et `unrs-resolver` selon sa politique locale ; aucune approbation de script ajoutée. [Log](evidence/npm-ci.txt). |
| `npm run lint` | 0 | [Log](evidence/lint.txt). |
| `npm run typecheck` | 0 | [Log](evidence/typecheck.txt). |
| `npm run build` | 0 | Compilation Next 16.3.5/Turbopack réussie ; routes applicatives dynamiques. [Log](evidence/build.txt). |
| `npm audit --json` / `npm audit --omit=dev --json` | 1 / 1 | Alertes toujours présentes ; pas une correction. |

Ces résultats portent sur **l'arbre initial**, sur macOS/Node 26. Aucune API/PostgreSQL, aucun navigateur et aucun OCR n'a été exercé ; un build réussi ne valide ni les migrations ni les dépendances natives sur Linux. L'installation de référence proposée Node 24/npm 11 devra être rejouée : sa politique de scripts peut différer de npm 12.

## 6. Alertes restantes, responsabilités et suivi minimal

| Élément | État / propriétaire | Action suivante et échéance de revue proposée |
| --- | --- | --- |
| Les 7 avis Next, sharp et source-map-js | **Ouverts : patchs prescrits seulement.** Mathis intègre, Hamza relit, Hugo accepte. | MATH-07 : nouvel audit et preuves V1–V5 avant de déclarer les avis résolus. Vérifier aussi tout nouvel avis apparu depuis cette photographie. |
| braces / GHSA-vfj7-8cjw-p6xm | **Exception proposée, non encore acceptée**, chaîne dev seulement ; Mathis suit, Hamza requalifie, Hugo accepte. | Réexaminer le 28 octobre 2026 ou immédiatement si un glob non fiable/configuration `rootDir` apparaît, si le registre retire/modifie l'avis ou si un correctif sort. Conserver l'alerte et sa justification ; ne pas ignorer globalement les high. |
| Exposition sharp du déploiement | **Non déterminée** ; Mathis fournit OS/runtime/libvips et routage, Hamza qualifie. | Avant validation MATH-07/livraison ; appliquer le patch même si l'exposition n'est pas démontrée. |
| ESLint 9 hors support | Dette d'outillage distincte, Mathis. | Qualifier ESLint 10 et ses plugins avant la prochaine évolution de CI ; ne pas présenter ce rapport comme une résolution de cette dette. |
| Relecture et suites partagées | **En attente** : Leandro ; MATH-01/02. | Clôture après relecture effective et preuves collectées, pas sur la seule prescription. |

Politique proposée pour MATH-02/07 : audit complet et production sur chaque changement de manifest/lock, avant livraison et une fois par semaine. Publier le résultat brut et une décision séparée. Bloquer une nouvelle alerte non qualifiée ou une exposition confirmée/plausible sans décision ; une exception doit être indexée par GHSA, version/chaîne, motif, propriétaire et date de revue. Ne pas transformer automatiquement la gravité d'un paquet transitif non exposé en échec permanent de toute CI. Cette politique n'est **pas** une configuration de CI ni une automatisation déjà créée.

Pour reproduire les décomptes sans compter plusieurs fois une chaîne :

```sh
node -e 'const a=require("./docs/security/HA-08/evidence/npm-audit-all.json"); const v=Object.values(a.vulnerabilities); const ids=new Set(v.flatMap(p=>p.via.filter(x=>typeof x==="object").map(x=>x.url))); console.log({packages:v.length,advisories:ids.size})'
```

L'audit npm n'analyse pas l'exploitation du code métier, les configurations déployées, l'ensemble des dépendances système ou les images Docker. Les autres défauts d'Expense.io ont leurs tickets séparés. Les versions candidates doivent être réévaluées au moment de l'intégration ; aucune promesse de « zéro risque » ou de score npm nul n'est faite.
