import { Database } from 'bun:sqlite';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_KEY = process.env.ADMIN_KEY ?? 'admin123';
const DB_PATH = resolve(process.env.ROS_DB_PATH ?? join(import.meta.dir, '..', '..', 'server', 'data', 'ros.db'));
const STATS_ENUM_PATH = resolve(import.meta.dir, '..', '..', 'script', 'dev_ng', 'core', 'game', 'data', 'stats_enums.sch');
const SERVER_AUTH_STATS_PATH = resolve(import.meta.dir, '..', '..', 'server', 'data', 'server_auth_stats_127.json');

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH, { create: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT    NOT NULL UNIQUE,
        passwordHash  TEXT    NOT NULL,
        name          TEXT    NOT NULL DEFAULT '',
        nickname      TEXT    NOT NULL DEFAULT '',
        clanTag       TEXT    NOT NULL DEFAULT 'LSO',
        banned        INTEGER NOT NULL DEFAULT 0,
        ticket        TEXT,
        sessionId     TEXT,
        sessionKey    TEXT,
        sessionTicket TEXT,
        scAuthToken   TEXT,
        createdAt     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS saves (
        platform   TEXT    NOT NULL,
        rockstarId INTEGER NOT NULL,
        fileName   TEXT    NOT NULL,
        data       BLOB    NOT NULL,
        updatedAt  TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (platform, rockstarId, fileName)
    );

    CREATE TABLE IF NOT EXISTS profile_stats (
        platform   TEXT    NOT NULL,
        rockstarId INTEGER NOT NULL,
        statId     INTEGER NOT NULL,
        statType   INTEGER NOT NULL,
        value      BLOB    NOT NULL,
        updatedAt  TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (platform, rockstarId, statId)
    );
`);
db.exec("DELETE FROM profile_stats WHERE platform = 'pcros'");

const TYPE_INT64 = 0;
const TYPE_FLOAT = 3;
const TYPE_INT32 = 4;

export function atStringHash(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);
        if (c >= 65 && c <= 90) c += 32;
        else if (c === 92) c = 47;
        h = (h + c) >>> 0;
        h = (h + (h << 10)) >>> 0;
        h = (h ^ (h >>> 6)) >>> 0;
    }
    h = (h + (h << 3)) >>> 0;
    h = (h ^ (h >>> 11)) >>> 0;
    h = (h + (h << 15)) >>> 0;
    return h >>> 0;
}

const statIdToName = new Map<number, string>();
const statIdToType = new Map<number, number>();

const CORE_STAT_NAMES = [
    'BANK_BALANCE',
    'EVC_BALANCE',
    'CLIENT_EVC_BALANCE',
    'PVC_BALANCE',
    'PERSONAL_EXCHANGE_RATE',
    'MP0_WALLET_BALANCE',
    'MP1_WALLET_BALANCE',
    'PROFILE_STATS_LAST_FLUSH',
    'MPPLY_LAST_MP_CHAR',
    'MPPLY_TOTAL_EVC',
    'MPPLY_TOTAL_SVC',
    'MPPLY_GLOBALXP',
    'MP0_CHAR_XP_FM',
    'MP1_CHAR_XP_FM',
    'MP0_CHAR_RANK_FM',
    'MP0_CHAR_RANK_FM_SA',
    'MP1_CHAR_RANK_FM',
    'MP0_CHAR_SET_RP_GIFT_ADMIN',
    'MP1_CHAR_SET_RP_GIFT_ADMIN',
    'MP0_TOTAL_XP_EARNED',
    'MP0_STAMINA',
    'MP0_SHOOTING_ABILITY',
    'MP0_STRENGTH',
    'MP0_STEALTH_ABILITY',
    'MP0_FLYING_ABILITY',
    'MP0_WHEELIE_ABILITY',
    'MP0_LUNG_CAPACITY',
    'MP0_CHAR_CREATOR_STAMINA',
    'MP0_CHAR_CREATOR_SHOOTING',
    'MP0_CHAR_CREATOR_STRENGTH',
    'MP0_CHAR_CREATOR_STEALTH',
    'MP0_CHAR_CREATOR_FLYING',
    'MP0_CHAR_CREATOR_BIKE',
    'MP0_CHAR_CREATOR_LUNG',
    'MP0_SCRIPT_INCREASE_STAM',
    'MP0_SCRIPT_INCREASE_SHO',
    'MP0_SCRIPT_INCREASE_STRN',
    'MP0_SCRIPT_INCREASE_STL',
    'MP0_SCRIPT_INCREASE_FLY',
    'MP0_SCRIPT_INCREASE_DRIV',
    'MP0_SCRIPT_INCREASE_LUNG',
    'MP0_KILLS',
    'MP0_DEATHS',
    'MP0_KILLS_PLAYERS',
    'MP0_DEATHS_PLAYER',
    'MPPLY_KILLS_PLAYERS',
    'MPPLY_DEATHS_PLAYER',
    'MP0_HEADSHOTS',
    'MP0_KILLS_COP',
    'MP0_RACES_WON',
    'MP0_RACES_LOST',
    'MP0_TOTAL_PLAYING_TIME',
];

for (const name of CORE_STAT_NAMES) {
    statIdToName.set(atStringHash(name), name);
}

if (existsSync(STATS_ENUM_PATH)) {
    try {
        const text = readFileSync(STATS_ENUM_PATH, 'utf8');
        for (const line of text.split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(-?\d+)/);
            if (m) {
                const name = m[1]!;
                const id = Number(m[2]) >>> 0;
                statIdToName.set(id, name);
                statIdToName.set(atStringHash(name), name);
            }
        }
    } catch {
        // ignore
    }
}

if (existsSync(SERVER_AUTH_STATS_PATH)) {
    try {
        const list = JSON.parse(readFileSync(SERVER_AUTH_STATS_PATH, 'utf8')) as Array<{
            statId: number;
            statType: number;
        }>;
        for (const item of list) {
            if (item && typeof item.statId === 'number' && typeof item.statType === 'number') {
                statIdToType.set(item.statId >>> 0, item.statType);
            }
        }
    } catch {
        // ignore
    }
}

const RANK_XP_TABLE = [
    0, 0, 800, 2100, 3800, 6100, 9500, 12500, 16000, 19800, 24000,
    28500, 33400, 38700, 44200, 50200, 56400, 63000, 69900, 77100, 84700,
    92500, 100700, 109200, 118000, 127100, 136500, 146200, 156200, 166500, 177100,
    188000, 199200, 210700, 222400, 234500, 246800, 259400, 272300, 285500, 299000,
    312700, 326800, 341000, 355600, 370500, 385600, 401000, 416600, 432600, 448800,
    465200, 482000, 499000, 516300, 533800, 551600, 569600, 588000, 606500, 625400,
    644500, 663800, 683400, 703300, 723400, 743800, 764500, 785400, 806500, 827900,
    849600, 871500, 893600, 916000, 938700, 961600, 984700, 1008100, 1031800, 1055700,
    1079800, 1104200, 1128800, 1153700, 1178800, 1204200, 1229800, 1255600, 1281700, 1308100,
    1334600, 1361400, 1388500, 1415800, 1443300, 1471100, 1499100, 1527300, 1555800, 1584350,
];

function rankToXp(rank: number): number {
    const r = Math.max(1, Math.min(8000, Math.floor(rank)));
    if (r < RANK_XP_TABLE.length) return RANK_XP_TABLE[r] ?? 0;
    return Math.floor(25 * r * r + 23575 * r - 1023150);
}

const upsertStatStmt = db.prepare(
    `INSERT INTO profile_stats (platform, rockstarId, statId, statType, value, updatedAt)
     VALUES ('PCROS', ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(platform, rockstarId, statId)
     DO UPDATE SET statType = excluded.statType, value = excluded.value, updatedAt = datetime('now')`,
);

function writeStatInt64(rockstarId: number, nameOrId: string | number, val: bigint | number) {
    const statId = typeof nameOrId === 'number' ? nameOrId >>> 0 : atStringHash(nameOrId);
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(Math.floor(Number(val))), 0);
    upsertStatStmt.run(rockstarId, statId, TYPE_INT64, buf);
}

function writeStatInt32(rockstarId: number, nameOrId: string | number, val: number) {
    const statId = typeof nameOrId === 'number' ? nameOrId >>> 0 : atStringHash(nameOrId);
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(Math.floor(Number(val)) | 0, 0);
    upsertStatStmt.run(rockstarId, statId, TYPE_INT32, buf);
}

function writeStatFloat(rockstarId: number, nameOrId: string | number, val: number) {
    const statId = typeof nameOrId === 'number' ? nameOrId >>> 0 : atStringHash(nameOrId);
    const buf = Buffer.alloc(4);
    buf.writeFloatBE(Number(val), 0);
    upsertStatStmt.run(rockstarId, statId, TYPE_FLOAT, buf);
}

function decodeStatValue(statType: number, raw: Uint8Array): number | string {
    const buf = Buffer.from(raw);
    if (statType === TYPE_INT64 && buf.length >= 8) {
        const v = buf.readBigInt64BE(0);
        if (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) {
            return Number(v);
        }
        return v.toString();
    }
    if (statType === TYPE_INT32 && buf.length >= 4) {
        return buf.readInt32BE(0);
    }
    if (statType === TYPE_FLOAT && buf.length >= 4) {
        return Number(buf.readFloatBE(0).toFixed(4));
    }
    if (buf.length === 2) return buf.readInt16BE(0);
    if (buf.length === 1) return buf.readUInt8(0);
    return buf.toString('hex');
}

function statTypeName(statType: number): string {
    if (statType === TYPE_INT64) return 'int64';
    if (statType === TYPE_INT32) return 'int32';
    if (statType === TYPE_FLOAT) return 'float';
    return 'raw(' + statType + ')';
}

function loadUserStatsMap(rockstarId: number): Map<number, { statType: number; value: number | string; updatedAt: string }> {
    const rows = db
        .query('SELECT statId, statType, value, updatedAt FROM profile_stats WHERE upper(platform) = ? AND rockstarId = ?')
        .all('PCROS', rockstarId) as Array<{ statId: number; statType: number; value: Uint8Array; updatedAt: string }>;
    const map = new Map<number, { statType: number; value: number | string; updatedAt: string }>();
    for (const r of rows) {
        map.set(r.statId >>> 0, {
            statType: r.statType,
            value: decodeStatValue(r.statType, r.value),
            updatedAt: r.updatedAt,
        });
    }
    return map;
}

function readNumStat(
    map: Map<number, { statType: number; value: number | string; updatedAt: string }>,
    name: string,
    fallback: number,
): number {
    const entry = map.get(atStringHash(name));
    if (!entry) return fallback;
    const n = Number(entry.value);
    return Number.isFinite(n) ? n : fallback;
}

function buildQuickStats(rockstarId: number) {
    const map = loadUserStatsMap(rockstarId);
    return {
        bank: readNumStat(map, 'BANK_BALANCE', 5000000),
        wallet0: readNumStat(map, 'MP0_WALLET_BALANCE', 500000),
        wallet1: readNumStat(map, 'MP1_WALLET_BALANCE', 500000),
        rank0: readNumStat(map, 'MP0_CHAR_RANK_FM', 1),
        xp0: readNumStat(map, 'MP0_CHAR_XP_FM', 0),
        rank1: readNumStat(map, 'MP1_CHAR_RANK_FM', 1),
        xp1: readNumStat(map, 'MP1_CHAR_XP_FM', 0),
        stamina: readNumStat(map, 'MP0_STAMINA', readNumStat(map, 'MP0_CHAR_CREATOR_STAMINA', 20)),
        shooting: readNumStat(map, 'MP0_SHOOTING_ABILITY', readNumStat(map, 'MP0_CHAR_CREATOR_SHOOTING', 20)),
        strength: readNumStat(map, 'MP0_STRENGTH', readNumStat(map, 'MP0_CHAR_CREATOR_STRENGTH', 20)),
        stealth: readNumStat(map, 'MP0_STEALTH_ABILITY', readNumStat(map, 'MP0_CHAR_CREATOR_STEALTH', 20)),
        flying: readNumStat(map, 'MP0_FLYING_ABILITY', readNumStat(map, 'MP0_CHAR_CREATOR_FLYING', 20)),
        driving: readNumStat(map, 'MP0_WHEELIE_ABILITY', readNumStat(map, 'MP0_CHAR_CREATOR_BIKE', 20)),
        lung: readNumStat(map, 'MP0_LUNG_CAPACITY', readNumStat(map, 'MP0_CHAR_CREATOR_LUNG', 20)),
        kills: readNumStat(map, 'MP0_KILLS', 0),
        deaths: readNumStat(map, 'MP0_DEATHS', 0),
        headshots: readNumStat(map, 'MP0_HEADSHOTS', 0),
        copKills: readNumStat(map, 'MP0_KILLS_COP', 0),
        racesWon: readNumStat(map, 'MP0_RACES_WON', 0),
        racesLost: readNumStat(map, 'MP0_RACES_LOST', 0),
    };
}

function randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64');
}

function randomSessionId(): string {
    return (BigInt('0x' + randomBytes(8).toString('hex')) >> 2n).toString();
}

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
    });
}

function checkAdmin(req: Request): boolean {
    const key = req.headers.get('x-admin-key') ?? '';
    return key.length > 0 && key === ADMIN_KEY;
}

const PUBLIC_DIR = join(import.meta.dir, '..', 'public');

Bun.serve({
    port: PORT,
    hostname: '0.0.0.0',
    async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname;

        if (req.method === 'GET' && path === '/style.css') {
            return new Response(Bun.file(join(PUBLIC_DIR, 'style.css')), {
                headers: { 'content-type': 'text/css; charset=utf-8' },
            });
        }

        if (req.method === 'GET' && (path === '/logo.png' || path === '/footer-logo.png')) {
            return new Response(Bun.file(join(PUBLIC_DIR, path.slice(1))), {
                headers: { 'content-type': 'image/png' },
            });
        }

        if (req.method === 'GET' && path.startsWith('/img/') && !path.includes('..')) {
            const file = Bun.file(join(PUBLIC_DIR, path.slice(1)));
            if (await file.exists()) {
                return new Response(file, {
                    headers: { 'content-type': 'image/jpeg' },
                });
            }
        }

        if (req.method === 'GET' && path === '/') {
            return new Response(Bun.file(join(PUBLIC_DIR, 'index.html')), {
                headers: { 'content-type': 'text/html; charset=utf-8' },
            });
        }

        if (req.method === 'GET' && path === '/register') {
            return new Response(Bun.file(join(PUBLIC_DIR, 'register.html')), {
                headers: { 'content-type': 'text/html; charset=utf-8' },
            });
        }

        if (req.method === 'GET' && path === '/admin') {
            return new Response(Bun.file(join(PUBLIC_DIR, 'admin.html')), {
                headers: { 'content-type': 'text/html; charset=utf-8' },
            });
        }

        if (req.method === 'GET' && path === '/api/stats') {
            const userCount = (db.query('SELECT COUNT(*) AS c FROM users WHERE banned = 0').get() as { c: number })?.c ?? 0;
            const recentUsers = db
                .query('SELECT nickname, clanTag, createdAt FROM users WHERE banned = 0 ORDER BY id DESC LIMIT 5')
                .all();
            return json({ userCount, recentUsers });
        }

        if (req.method === 'POST' && path === '/api/register') {
            let body: { email?: string; nickname?: string; password?: string; clanTag?: string };
            try {
                body = await req.json();
            } catch {
                return json({ error: 'Invalid JSON' }, 400);
            }

            const email = (body.email ?? '').trim().toLowerCase();
            const nickname = (body.nickname ?? '').trim();
            const password = body.password ?? '';
            const clanTag = ((body.clanTag ?? 'DVAU').trim().toUpperCase() || 'DVAU').slice(0, 4);

            if (!email || !email.includes('@')) {
                return json({ error: 'Valid email is required' }, 400);
            }
            if (!nickname || nickname.length < 3 || nickname.length > 16 || !/^[a-zA-Z0-9_-]+$/.test(nickname)) {
                return json({ error: 'Username must be 3-16 alphanumeric characters' }, 400);
            }
            if (password.length < 6) {
                return json({ error: 'Password must be at least 6 characters' }, 400);
            }

            const existingEmail = db.query('SELECT id FROM users WHERE lower(email) = ? LIMIT 1').get(email);
            if (existingEmail) {
                return json({ error: 'Email is already registered' }, 409);
            }

            const existingNick = db.query('SELECT id FROM users WHERE lower(nickname) = ? LIMIT 1').get(nickname.toLowerCase());
            if (existingNick) {
                return json({ error: 'Username is already taken' }, 409);
            }

            const passwordHash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 });
            const row = db
                .query(
                    `INSERT INTO users (email, passwordHash, name, nickname, clanTag, ticket, sessionId, sessionKey, sessionTicket, scAuthToken)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     RETURNING id, email, nickname, clanTag, createdAt`,
                )
                .get(
                    email,
                    passwordHash,
                    nickname,
                    nickname,
                    clanTag,
                    randomToken(32),
                    randomSessionId(),
                    randomToken(32),
                    randomToken(32),
                    randomToken(32),
                ) as { id: number; email: string; nickname: string; clanTag: string; createdAt: string };

            writeStatInt64(row.id, 'BANK_BALANCE', 5000000);
            writeStatInt64(row.id, 'MP0_WALLET_BALANCE', 500000);
            writeStatInt64(row.id, 'MP1_WALLET_BALANCE', 500000);
            writeStatInt64(row.id, 'EVC_BALANCE', 6000000);

            return json({ ok: true, user: row });
        }

        if (path.startsWith('/api/admin/')) {
            if (!checkAdmin(req)) {
                return json({ error: 'Unauthorized' }, 401);
            }

            if (req.method === 'GET' && path === '/api/admin/users') {
                const rawUsers = db
                    .query(
                        `SELECT u.id, u.email, u.nickname, u.clanTag, u.banned, u.createdAt,
                                (SELECT COUNT(*) FROM saves s WHERE s.rockstarId = u.id) AS saveCount,
                                (SELECT COUNT(*) FROM profile_stats p WHERE p.rockstarId = u.id) AS statCount
                         FROM users u
                         ORDER BY u.id ASC`,
                    )
                    .all() as Array<{
                        id: number;
                        email: string;
                        nickname: string;
                        clanTag: string;
                        banned: number;
                        createdAt: string;
                        saveCount: number;
                        statCount: number;
                    }>;

                const users = rawUsers.map((u) => {
                    const q = buildQuickStats(u.id);
                    return {
                        ...u,
                        bank: q.bank,
                        wallet0: q.wallet0,
                        wallet1: q.wallet1,
                        rank0: q.rank0,
                        xp0: q.xp0,
                    };
                });
                return json({ users });
            }

            if (req.method === 'POST' && path === '/api/admin/create-user') {
                const body = (await req.json()) as {
                    email?: string;
                    nickname?: string;
                    clanTag?: string;
                    password?: string;
                    bank?: number;
                    wallet0?: number;
                    rank0?: number;
                };
                const email = (body.email ?? '').trim().toLowerCase();
                const nickname = (body.nickname ?? '').trim();
                const password = body.password ?? '';
                const clanTag = ((body.clanTag ?? 'DVAU').trim().toUpperCase() || 'DVAU').slice(0, 4);

                if (!email || !nickname || !password) {
                    return json({ error: 'Email, username, and password are required' }, 400);
                }

                const existing = db
                    .query('SELECT id FROM users WHERE lower(email) = ? OR lower(nickname) = ? LIMIT 1')
                    .get(email, nickname.toLowerCase());
                if (existing) {
                    return json({ error: 'Email or username already exists' }, 409);
                }

                const passwordHash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 });
                const user = db
                    .query(
                        `INSERT INTO users (email, passwordHash, name, nickname, clanTag, ticket, sessionId, sessionKey, sessionTicket, scAuthToken)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                         RETURNING id, email, nickname, clanTag, createdAt`,
                    )
                    .get(
                        email,
                        passwordHash,
                        nickname,
                        nickname,
                        clanTag,
                        randomToken(32),
                        randomSessionId(),
                        randomToken(32),
                        randomToken(32),
                        randomToken(32),
                    ) as { id: number };

                const bank = Math.max(0, Math.floor(Number(body.bank ?? 5000000)));
                const wallet0 = Math.max(0, Math.floor(Number(body.wallet0 ?? 500000)));
                const rank0 = Math.max(1, Math.min(8000, Math.floor(Number(body.rank0 ?? 1))));
                const xp0 = rankToXp(rank0);

                writeStatInt64(user.id, 'BANK_BALANCE', bank);
                writeStatInt64(user.id, 'MP0_WALLET_BALANCE', wallet0);
                writeStatInt64(user.id, 'MP1_WALLET_BALANCE', 500000);
                writeStatInt64(user.id, 'EVC_BALANCE', bank + wallet0 + 500000);
                writeStatInt32(user.id, 'MP0_CHAR_RANK_FM', rank0);
                writeStatInt32(user.id, 'MP0_CHAR_RANK_FM_SA', rank0);
                writeStatInt32(user.id, 'MP0_CHAR_XP_FM', xp0);
                writeStatInt32(user.id, 'MPPLY_GLOBALXP', xp0);
                writeStatInt32(user.id, 'MP0_CHAR_SET_RP_GIFT_ADMIN', xp0);

                return json({ ok: true, id: user.id });
            }

            const userMatch = path.match(/^\/api\/admin\/user\/(\d+)(?:\/([a-z-]+))?$/);
            if (userMatch) {
                const userId = Number(userMatch[1]);
                const action = userMatch[2] ?? '';
                const userRow = db
                    .query('SELECT id, email, nickname, clanTag, banned, createdAt FROM users WHERE id = ? LIMIT 1')
                    .get(userId);
                if (!userRow) {
                    return json({ error: 'User not found' }, 404);
                }

                if (req.method === 'GET' && action === '') {
                    const quick = buildQuickStats(userId);
                    const rawStats = db
                        .query(
                            'SELECT statId, statType, value, updatedAt FROM profile_stats WHERE upper(platform) = ? AND rockstarId = ?',
                        )
                        .all('PCROS', userId) as Array<{
                            statId: number;
                            statType: number;
                            value: Uint8Array;
                            updatedAt: string;
                        }>;

                    const stats = rawStats
                        .map((r) => {
                            const id = r.statId >>> 0;
                            const name = statIdToName.get(id) ?? `0x${id.toString(16).toUpperCase().padStart(8, '0')}`;
                            return {
                                statId: id,
                                statName: name,
                                statType: r.statType,
                                typeName: statTypeName(r.statType),
                                value: decodeStatValue(r.statType, r.value),
                                updatedAt: r.updatedAt,
                            };
                        })
                        .sort((a, b) => a.statName.localeCompare(b.statName));

                    const saves = db
                        .query(
                            'SELECT platform, fileName, length(data) AS bytes, updatedAt FROM saves WHERE rockstarId = ? ORDER BY fileName ASC',
                        )
                        .all(userId);

                    return json({ user: userRow, quick, stats, saves });
                }

                if (req.method === 'POST' && action === 'quick') {
                    const body = (await req.json()) as Record<string, unknown>;
                    const currentQuick = buildQuickStats(userId);

                    if (typeof body.email === 'string' && body.email.trim()) {
                        db.query('UPDATE users SET email = ? WHERE id = ?').run(body.email.trim().toLowerCase(), userId);
                    }
                    if (typeof body.nickname === 'string' && body.nickname.trim()) {
                        const nick = body.nickname.trim();
                        db.query('UPDATE users SET nickname = ?, name = ? WHERE id = ?').run(nick, nick, userId);
                    }
                    if (typeof body.clanTag === 'string' && body.clanTag.trim()) {
                        const tag = body.clanTag.trim().toUpperCase().slice(0, 4);
                        db.query('UPDATE users SET clanTag = ? WHERE id = ?').run(tag, userId);
                    }
                    if (typeof body.banned === 'boolean') {
                        db.query('UPDATE users SET banned = ? WHERE id = ?').run(body.banned ? 1 : 0, userId);
                    }
                    if (typeof body.password === 'string' && body.password.length > 0) {
                        const hash = await Bun.password.hash(body.password, { algorithm: 'bcrypt', cost: 10 });
                        db.query('UPDATE users SET passwordHash = ? WHERE id = ?').run(hash, userId);
                    }

                    const bank = body.bank !== undefined ? Math.max(0, Math.floor(Number(body.bank))) : currentQuick.bank;
                    const wallet0 = body.wallet0 !== undefined ? Math.max(0, Math.floor(Number(body.wallet0))) : currentQuick.wallet0;
                    const wallet1 = body.wallet1 !== undefined ? Math.max(0, Math.floor(Number(body.wallet1))) : currentQuick.wallet1;
                    const totalEvc = bank + wallet0 + wallet1;

                    writeStatInt64(userId, 'BANK_BALANCE', bank);
                    writeStatInt64(userId, 'MP0_WALLET_BALANCE', wallet0);
                    writeStatInt64(userId, 'MP1_WALLET_BALANCE', wallet1);
                    writeStatInt64(userId, 'EVC_BALANCE', totalEvc);
                    writeStatInt64(userId, 'CLIENT_EVC_BALANCE', totalEvc);
                    writeStatInt64(userId, 'MPPLY_TOTAL_EVC', totalEvc);

                    if (body.rank0 !== undefined || body.xp0 !== undefined) {
                        const rank0 = Math.max(1, Math.min(8000, Math.floor(Number(body.rank0 ?? currentQuick.rank0))));
                        let xp0 = body.xp0 !== undefined ? Math.max(0, Math.floor(Number(body.xp0))) : currentQuick.xp0;
                        if (body.rank0 !== undefined && Number(body.rank0) !== currentQuick.rank0 && xp0 === currentQuick.xp0) {
                            xp0 = rankToXp(rank0);
                        }
                        writeStatInt32(userId, 'MP0_CHAR_RANK_FM', rank0);
                        writeStatInt32(userId, 'MP0_CHAR_RANK_FM_SA', rank0);
                        writeStatInt32(userId, 'MP0_CHAR_XP_FM', xp0);
                        writeStatInt32(userId, 'MPPLY_GLOBALXP', xp0);
                        writeStatInt32(userId, 'MP0_TOTAL_XP_EARNED', xp0);
                        writeStatInt32(userId, 'MP0_CHAR_SET_RP_GIFT_ADMIN', xp0);
                    }

                    if (body.rank1 !== undefined || body.xp1 !== undefined) {
                        const rank1 = Math.max(1, Math.min(8000, Math.floor(Number(body.rank1 ?? currentQuick.rank1))));
                        let xp1 = body.xp1 !== undefined ? Math.max(0, Math.floor(Number(body.xp1))) : currentQuick.xp1;
                        if (body.rank1 !== undefined && Number(body.rank1) !== currentQuick.rank1 && xp1 === currentQuick.xp1) {
                            xp1 = rankToXp(rank1);
                        }
                        writeStatInt32(userId, 'MP1_CHAR_RANK_FM', rank1);
                        writeStatInt32(userId, 'MP1_CHAR_XP_FM', xp1);
                        writeStatInt32(userId, 'MP1_CHAR_SET_RP_GIFT_ADMIN', xp1);
                    }

                    const skillPairs: Array<[string, string, string, string]> = [
                        ['stamina', 'MP0_STAMINA', 'MP0_CHAR_CREATOR_STAMINA', 'MP0_SCRIPT_INCREASE_STAM'],
                        ['shooting', 'MP0_SHOOTING_ABILITY', 'MP0_CHAR_CREATOR_SHOOTING', 'MP0_SCRIPT_INCREASE_SHO'],
                        ['strength', 'MP0_STRENGTH', 'MP0_CHAR_CREATOR_STRENGTH', 'MP0_SCRIPT_INCREASE_STRN'],
                        ['stealth', 'MP0_STEALTH_ABILITY', 'MP0_CHAR_CREATOR_STEALTH', 'MP0_SCRIPT_INCREASE_STL'],
                        ['flying', 'MP0_FLYING_ABILITY', 'MP0_CHAR_CREATOR_FLYING', 'MP0_SCRIPT_INCREASE_FLY'],
                        ['driving', 'MP0_WHEELIE_ABILITY', 'MP0_CHAR_CREATOR_BIKE', 'MP0_SCRIPT_INCREASE_DRIV'],
                        ['lung', 'MP0_LUNG_CAPACITY', 'MP0_CHAR_CREATOR_LUNG', 'MP0_SCRIPT_INCREASE_LUNG'],
                    ];

                    for (const [key, mainStat, creatorStat, scriptStat] of skillPairs) {
                        if (body[key] !== undefined) {
                            const val = Math.max(0, Math.min(100, Math.floor(Number(body[key]))));
                            writeStatInt32(userId, mainStat, val);
                            writeStatInt32(userId, creatorStat, val);
                            writeStatInt32(userId, scriptStat, val);
                        }
                    }

                    const combatPairs: Array<[string, string]> = [
                        ['kills', 'MP0_KILLS'],
                        ['deaths', 'MP0_DEATHS'],
                        ['headshots', 'MP0_HEADSHOTS'],
                        ['copKills', 'MP0_KILLS_COP'],
                        ['racesWon', 'MP0_RACES_WON'],
                        ['racesLost', 'MP0_RACES_LOST'],
                    ];
                    for (const [key, statName] of combatPairs) {
                        if (body[key] !== undefined) {
                            writeStatInt32(userId, statName, Math.max(0, Math.floor(Number(body[key]))));
                        }
                    }

                    if (body.kills !== undefined) {
                        writeStatInt32(userId, 'MP0_KILLS_PLAYERS', Math.max(0, Math.floor(Number(body.kills))));
                        writeStatInt32(userId, 'MPPLY_KILLS_PLAYERS', Math.max(0, Math.floor(Number(body.kills))));
                    }
                    if (body.deaths !== undefined) {
                        writeStatInt32(userId, 'MP0_DEATHS_PLAYER', Math.max(0, Math.floor(Number(body.deaths))));
                        writeStatInt32(userId, 'MPPLY_DEATHS_PLAYER', Math.max(0, Math.floor(Number(body.deaths))));
                    }

                    return json({ ok: true });
                }

                if (req.method === 'POST' && action === 'stat') {
                    const body = (await req.json()) as {
                        statName?: string;
                        statId?: number;
                        statType?: number | string;
                        value?: number | string;
                    };

                    let statId: number;
                    if (typeof body.statId === 'number' && Number.isFinite(body.statId)) {
                        statId = body.statId >>> 0;
                    } else if (typeof body.statName === 'string' && body.statName.trim()) {
                        const rawName = body.statName.trim();
                        if (/^0x[0-9a-fA-F]+$/.test(rawName)) {
                            statId = Number.parseInt(rawName, 16) >>> 0;
                        } else if (/^\d+$/.test(rawName)) {
                            statId = Number(rawName) >>> 0;
                        } else {
                            statId = atStringHash(rawName);
                            statIdToName.set(statId, rawName.toUpperCase());
                        }
                    } else {
                        return json({ error: 'Stat name or ID is required' }, 400);
                    }

                    let statType = TYPE_INT32;
                    if (body.statType === 'int64' || body.statType === 0) statType = TYPE_INT64;
                    else if (body.statType === 'float' || body.statType === 3) statType = TYPE_FLOAT;
                    else if (body.statType === 'int32' || body.statType === 4) statType = TYPE_INT32;
                    else if (statIdToType.has(statId)) statType = statIdToType.get(statId)!;

                    const numVal = Number(body.value ?? 0);
                    if (!Number.isFinite(numVal)) {
                        return json({ error: 'Numeric value is required' }, 400);
                    }

                    if (statType === TYPE_INT64) writeStatInt64(userId, statId, BigInt(Math.floor(numVal)));
                    else if (statType === TYPE_FLOAT) writeStatFloat(userId, statId, numVal);
                    else writeStatInt32(userId, statId, numVal);

                    return json({ ok: true, statId });
                }

                if (req.method === 'POST' && action === 'delete-stat') {
                    const body = (await req.json()) as { statId?: number; all?: boolean };
                    if (body.all) {
                        db.query('DELETE FROM profile_stats WHERE rockstarId = ?').run(userId);
                    } else if (typeof body.statId === 'number') {
                        db.query('DELETE FROM profile_stats WHERE rockstarId = ? AND statId = ?').run(userId, body.statId >>> 0);
                    }
                    return json({ ok: true });
                }

                if (req.method === 'POST' && action === 'delete-save') {
                    const body = (await req.json()) as { fileName?: string; all?: boolean };
                    if (body.all) {
                        db.query('DELETE FROM saves WHERE rockstarId = ?').run(userId);
                    } else if (typeof body.fileName === 'string' && body.fileName) {
                        db.query('DELETE FROM saves WHERE rockstarId = ? AND fileName = ?').run(userId, body.fileName);
                    }
                    return json({ ok: true });
                }
            }

            if (req.method === 'POST' && path === '/api/admin/ban') {
                const body = (await req.json()) as { id?: number; banned?: boolean };
                if (!body.id) return json({ error: 'Missing user id' }, 400);
                db.query('UPDATE users SET banned = ? WHERE id = ?').run(body.banned ? 1 : 0, body.id);
                return json({ ok: true });
            }

            if (req.method === 'POST' && path === '/api/admin/delete') {
                const body = (await req.json()) as { id?: number };
                if (!body.id) return json({ error: 'Missing user id' }, 400);
                db.query('DELETE FROM saves WHERE rockstarId = ?').run(body.id);
                db.query('DELETE FROM profile_stats WHERE rockstarId = ?').run(body.id);
                db.query('DELETE FROM users WHERE id = ?').run(body.id);
                return json({ ok: true });
            }
        }

        return new Response('Not Found', { status: 404 });
    },
});

console.log(`web-platform listening on http://0.0.0.0:${PORT} (db: ${DB_PATH}, loaded ${statIdToName.size} stat names)`);
