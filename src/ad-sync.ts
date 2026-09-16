import * as ldap from 'ldapjs';
import axios from 'axios';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid'; // For mocking objectGUID if parsing fails

dotenv.config();

const LDAP_URL = process.env.LDAP_URL || 'ldap://localhost:389';
const LDAP_BIND_DN = process.env.LDAP_BIND_DN || 'cn=admin,dc=synparc,dc=local';
const LDAP_BIND_PASSWORD = process.env.LDAP_BIND_PASSWORD || 'password';
const LDAP_SEARCH_BASE = process.env.LDAP_SEARCH_BASE || 'dc=synparc,dc=local';

const API_SYNC_URL = process.env.API_SYNC_URL || 'http://localhost:3000/api/connectors/ad/sync';

// Format the objectGUID from AD binary format to UUID string
function formatGuid(buffer: Buffer): string {
    if (!buffer || buffer.length !== 16) return uuidv4();
    const hex = buffer.toString('hex');
    return `${hex.slice(6, 8)}${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}-` +
           `${hex.slice(10, 12)}${hex.slice(8, 10)}-` +
           `${hex.slice(14, 16)}${hex.slice(12, 14)}-` +
           `${hex.slice(16, 20)}-` +
           `${hex.slice(20, 32)}`;
}

async function searchLdap(client: ldap.Client, base: string, filter: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const results: any[] = [];
        const opts = {
            filter: filter,
            scope: 'sub',
            attributes: ['objectGUID', 'sAMAccountName', 'displayName', 'userPrincipalName', 'mail', 'memberOf', 'description', 'userAccountControl'],
            paged: true,
            sizeLimit: 1000
        };

        client.search(base, opts, (err, res) => {
            if (err) return reject(err);

            res.on('searchEntry', (entry) => {
                const obj: any = { dn: entry.objectName };
                for (const attr of entry.attributes) {
                    if (attr.type === 'objectGUID') {
                        obj[attr.type] = formatGuid(attr.buffers[0]);
                    } else {
                        obj[attr.type] = attr.vals.length === 1 ? attr.vals[0] : attr.vals;
                    }
                }
                results.push(obj);
            });

            res.on('error', (err) => reject(err));
            res.on('end', () => resolve(results));
        });
    });
}

async function runSync() {
    console.log(`[AD-SYNC] Démarrage de la synchronisation LDAP...`);
    console.log(`[AD-SYNC] URL: ${LDAP_URL}, Base: ${LDAP_SEARCH_BASE}`);

    const client = ldap.createClient({ url: LDAP_URL });

    try {
        await new Promise<void>((resolve, reject) => {
            client.bind(LDAP_BIND_DN, LDAP_BIND_PASSWORD, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log(`[AD-SYNC] ✅ Authentification LDAP réussie.`);

        // 1. Fetch Users
        console.log(`[AD-SYNC] Récupération des utilisateurs...`);
        const usersLdap = await searchLdap(client, LDAP_SEARCH_BASE, '(&(objectCategory=person)(objectClass=user))');
        console.log(`[AD-SYNC] 👤 ${usersLdap.length} utilisateurs trouvés.`);

        // 2. Fetch Groups
        console.log(`[AD-SYNC] Récupération des groupes...`);
        const groupsLdap = await searchLdap(client, LDAP_SEARCH_BASE, '(objectClass=group)');
        console.log(`[AD-SYNC] 👥 ${groupsLdap.length} groupes trouvés.`);

        // 3. Format Data for API
        const users = usersLdap.map(u => {
            const uac = parseInt(u.userAccountControl || '512', 10);
            const disabled = (uac & 2) !== 0;
            return {
                objectGuid: u.objectGUID,
                samAccountName: u.sAMAccountName || '',
                displayName: u.displayName || u.sAMAccountName,
                userPrincipalName: u.userPrincipalName,
                email: u.mail,
                isActive: !disabled
            };
        }).filter(u => u.samAccountName);

        const groups = groupsLdap.map(g => ({
            objectGuid: g.objectGUID,
            name: g.sAMAccountName || g.displayName || 'Unknown Group',
            description: g.description
        }));

        // In a real scenario we parse memberOf or member attributes to build memberships.
        // For this V1, we extract memberOf from users (which contains group DNs).
        // Since we need GUID-to-GUID links, we map Group DN -> Group GUID.
        const dnToGroupGuid = new Map<string, string>();
        groupsLdap.forEach(g => {
            dnToGroupGuid.set(g.dn.toLowerCase(), g.objectGUID);
        });

        const memberships: { userGuid: string, groupGuid: string }[] = [];
        usersLdap.forEach(u => {
            if (u.memberOf) {
                const members = Array.isArray(u.memberOf) ? u.memberOf : [u.memberOf];
                members.forEach(groupDn => {
                    const groupGuid = dnToGroupGuid.get(groupDn.toLowerCase());
                    if (groupGuid) {
                        memberships.push({ userGuid: u.objectGUID, groupGuid: groupGuid });
                    }
                });
            }
        });

        console.log(`[AD-SYNC] 🔗 ${memberships.length} relations d'appartenance (memberships) résolues.`);

        // 4. Send to API
        console.log(`[AD-SYNC] Envoi des données au serveur central (${API_SYNC_URL})...`);
        const payload = { users, groups, memberships };

        const response = await axios.post(API_SYNC_URL, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log(`[AD-SYNC] ✅ Succès : Le serveur a répondu ${response.status} (${JSON.stringify(response.data)})`);

    } catch (err: any) {
        console.error(`[AD-SYNC] ❌ Erreur lors de la synchronisation :`, err.message || err);
    } finally {
        client.unbind();
    }
}

// Lancement
runSync();
