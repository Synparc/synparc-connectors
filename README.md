# Synparc Connectors

Ce dépôt contient les scripts Node.js permettant de synchroniser les données d'identité et de permissions depuis diverses sources (Active Directory, Microsoft 365, Serveurs de fichiers SMB) vers le serveur central Synparc.

## 🚀 Démarrage Rapide (Connecteur AD)

Le connecteur Active Directory se connecte à votre contrôleur de domaine via LDAP, aspire l'arborescence des Utilisateurs et des Groupes, puis les envoie en "bulk" vers l'API centrale de Synparc.

### 1. Prérequis

- Node.js (v18+)
- L'API Synparc Server en cours d'exécution

### 2. Configuration

Créez un fichier `.env` à la racine de ce dossier avec les informations de votre Active Directory :

```env
LDAP_URL=ldap://192.168.1.10:389
LDAP_BIND_DN=cn=admin,dc=synparc,dc=local
LDAP_BIND_PASSWORD=VotreMotDePasseSuperSecret
LDAP_SEARCH_BASE=dc=synparc,dc=local

# URL de l'API Centrale Synparc
API_SYNC_URL=http://localhost:3000/api/connectors/ad/sync
```

### 3. Lancement

```bash
npm install
npm start
```
Le script s'exécute, traite les données, les transmet au serveur et s'arrête. Dans un environnement de production, ce script est généralement appelé via une tâche planifiée (Tâche Planifiée Windows ou Cron Linux) toutes les nuits ou toutes les heures.

---

## 🛠️ Simuler un Active Directory avec Docker

Si vous n'avez pas d'Active Directory sous la main pour vos développements, un fichier `docker-compose.yml` est fourni pour lancer une image Samba AD jetable instantanément.

**Lancer le mock AD :**
```bash
docker-compose up -d
```

**Variables d'environnement par défaut pour ce mock :**
```env
LDAP_URL=ldap://localhost:389
LDAP_BIND_DN=cn=Administrator,cn=Users,dc=synparc,dc=local
LDAP_BIND_PASSWORD=AdminPassword123!
LDAP_SEARCH_BASE=dc=synparc,dc=local
```
