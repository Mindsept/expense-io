# Justificatifs synthétiques LE-01

Créés pour Expense.io par `scripts/leandro/LE-01/generate-receipts.mjs` : carré
uni 16×16 en PNG, JPEG baseline/progressif, WebP avec/sans perte et document PDF
original d'une page vide avec xref calculée. Aucun reçu personnel ni source tierce.
Fixtures et générateur originaux réutilisables sous CC0-1.0.
Le PDF est déclaré binaire dans les attributs locaux : ses enregistrements xref
font 20 octets avec CRLF et doivent être conservés sans normalisation de texte.

Reproduction : Node 24, installation `npm ci`, puis
`node scripts/leandro/LE-01/generate-receipts.mjs`. Sharp est déjà installé
transitivement par Next ; il sert uniquement à générer ces fixtures. Le code
applicatif et les tests ne l'importent pas. Aucun manifest ou lockfile modifié.

Les tests distinguent formats réels, contenu tronqué, PNG dont le CRC est altéré,
MIME mensonger, fichiers vides et taille excessive. Ils ne prouvent pas l'innocuité
d'un document ni le décodage complet de tout le format.
