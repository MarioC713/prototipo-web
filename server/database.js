const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

// La ruta de la DB ahora es configurable. Usará la variable de entorno en producción
// y un archivo local para el desarrollo.
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'database.sqlite');
let db;

function initializeDatabase(productsList = []) {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Error al conectar a la base de datos:', err.message);
                return reject(err);
            }
            console.log('Conectado a la base de datos SQLite.');

            const run = (query, params = []) => new Promise((res, rej) => db.run(query, params, function(err) { if (err) rej(err); else res(this); }));
            const get = (query, params = []) => new Promise((res, rej) => db.get(query, params, (err, row) => (err ? rej(err) : res(row))));

            async function setup() {
                try {
                    await run(`CREATE TABLE IF NOT EXISTS products (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT UNIQUE NOT NULL,
                        description TEXT,
                        price TEXT,
                        image_url TEXT,
                        features TEXT
                    )`);
                    await run(`CREATE TABLE IF NOT EXISTS licenses (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        product_id INTEGER NOT NULL,
                        key TEXT UNIQUE NOT NULL,
                        is_used INTEGER DEFAULT 0,
                        used_at TEXT,
                        used_by_email TEXT,
                        FOREIGN KEY (product_id) REFERENCES products(id)
                    )`);
                    await run(`CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT UNIQUE NOT NULL,
                        password_hash TEXT NOT NULL,
                        role TEXT NOT NULL,
                        credits INTEGER DEFAULT 0,
                        hwid TEXT
                    )`);
                    await run(`CREATE TABLE IF NOT EXISTS history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        date TEXT NOT NULL,
                        email TEXT NOT NULL,
                        product_name TEXT NOT NULL,
                        license_key TEXT,
                        is_multiple INTEGER DEFAULT 0,
                        multiple_licenses_data TEXT,
                        sender_id INTEGER,
                        payment_method TEXT,
                        status TEXT DEFAULT 'PENDING',
                        FOREIGN KEY (sender_id) REFERENCES users(id)
                    )`);
                    await run(`CREATE TABLE IF NOT EXISTS seller_permissions (
                        user_id INTEGER NOT NULL,
                        product_id INTEGER NOT NULL,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
                        PRIMARY KEY (user_id, product_id)
                    )`);

                    console.log('Tablas creadas o ya existentes.');

                    // Populate products if table is empty
                    const productCount = await get("SELECT COUNT(*) AS count FROM products");
                    if (productCount.count === 0 && productsList.length > 0) {
                        console.log('Populando la tabla de productos...');
                        const stmt = db.prepare("INSERT INTO products (name) VALUES (?)");
                        productsList.forEach(product => stmt.run(product));
                        await new Promise((res, rej) => stmt.finalize(err => err ? rej(err) : res()));
                        console.log('Tabla de productos populada.');
                    }

                    // Migraciones seguras
                    const migrations = [
                        `ALTER TABLE history ADD COLUMN sender_id INTEGER`,
                        `ALTER TABLE history ADD COLUMN payment_method TEXT`,
                        `ALTER TABLE history ADD COLUMN status TEXT DEFAULT 'PENDING'`,
                        `ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 0`,
                        `ALTER TABLE users ADD COLUMN hwid TEXT`,
                        `ALTER TABLE products ADD COLUMN description TEXT`,
                        `ALTER TABLE products ADD COLUMN price TEXT`,
                        `ALTER TABLE products ADD COLUMN image_url TEXT`,
                        `ALTER TABLE products ADD COLUMN features TEXT`
                    ];

                    for (const migration of migrations) {
                        try {
                            await run(migration);
                        } catch (err) {
                            if (!err.message.includes('duplicate column name')) {
                                console.error(`Error en migración: ${migration}`, err.message);
                            }
                        }
                    }
                    
                    resolve(db);
                } catch (setupErr) {
                    console.error('Error al configurar las tablas:', setupErr);
                    reject(setupErr);
                }
            }

            setup();
        });
    });
}

async function updateSellerPermissions(userId, productIds = []) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("DELETE FROM seller_permissions WHERE user_id = ?", [userId], (err) => {
                if (err) return reject(err);
                if (!productIds || productIds.length === 0) return resolve();
                const stmt = db.prepare("INSERT INTO seller_permissions (user_id, product_id) VALUES (?, ?)");
                productIds.forEach(productId => stmt.run(userId, productId));
                stmt.finalize(err => err ? reject(err) : resolve());
            });
        });
    });
}

async function getSellerPermissions(userId) {
    return new Promise((resolve, reject) => {
        db.all("SELECT product_id FROM seller_permissions WHERE user_id = ?", [userId], (err, rows) => {
            if (err) return reject(err);
            resolve(rows.map(row => row.product_id));
        });
    });
}

async function addUser(username, password, role, allowed_products = []) {
    const password_hash = await bcrypt.hash(password, 10);
    return new Promise((resolve, reject) => {
        db.run("INSERT INTO users (username, password_hash, role, credits) VALUES (?, ?, ?, 0)",
            [username, password_hash, role], async function(err) {
            if (err) return reject(err);
            const userId = this.lastID;
            if (role === 'seller') {
                try {
                    await updateSellerPermissions(userId, allowed_products);
                } catch (permErr) {
                    return reject(permErr);
                }
            }
            resolve({ id: userId, username, role, credits: 0 });
        });
    });
}

async function updateUser(id, username, password, role, credits, allowed_products = []) {
    return new Promise(async (resolve, reject) => {
        let query, params;
        if (password) {
            const password_hash = await bcrypt.hash(password, 10);
            query = "UPDATE users SET username = ?, password_hash = ?, role = ?, credits = ? WHERE id = ?";
            params = [username, password_hash, role, credits, id];
        } else {
            query = "UPDATE users SET username = ?, role = ?, credits = ? WHERE id = ?";
            params = [username, role, credits, id];
        }
        db.run(query, params, async function(err) {
            if (err) return reject(err);
            try {
                await updateSellerPermissions(id, role === 'seller' ? allowed_products : []);
                resolve(this.changes);
            } catch (permErr) {
                reject(permErr);
            }
        });
    });
}

async function getUsers() {
    return new Promise((resolve, reject) => {
        db.all("SELECT id, username, role, credits, hwid FROM users", [], (err, rows) => err ? reject(err) : resolve(rows));
    });
}

async function deleteUser(id) {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM users WHERE id = ?", [id], function(err) {
            err ? reject(err) : resolve(this.changes);
        });
    });
}

async function getUserByUsername(username) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => err ? reject(err) : resolve(row));
    });
}

async function addProduct(name, description = '', price = '', imageUrl = '', features = '[]') {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO products (name, description, price, image_url, features) VALUES (?, ?, ?, ?, ?)`;
        db.run(query, [name, description, price, imageUrl, features], function(err) {
            if (err) return reject(err);
            resolve({ id: this.lastID, name, description, price, imageUrl, features });
        });
    });
}

async function updateProduct(id, name, description, price, imageUrl, features) {
    return new Promise((resolve, reject) => {
        const query = `UPDATE products SET name = ?, description = ?, price = ?, image_url = ?, features = ? WHERE id = ?`;
        db.run(query, [name, description, price, imageUrl, features, id], function(err) {
            err ? reject(err) : resolve(this.changes);
        });
    });
}

async function deleteProduct(id) {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM products WHERE id = ?", [id], function(err) {
            err ? reject(err) : resolve(this.changes);
        });
    });
}

async function addPurchaseToHistory(email, productName, paymentMethod) {
    return new Promise((resolve, reject) => {
        const date = new Date().toISOString();
        // Se inserta un valor vacío para license_key para evitar el error de NOT NULL.
        const query = `INSERT INTO history (date, email, product_name, payment_method, status, license_key) VALUES (?, ?, ?, ?, 'PENDING', '')`;
        db.run(query, [date, email, productName, paymentMethod], function(err) {
            if (err) {
                console.error('Error al registrar la compra en el historial:', err.message);
                return reject(err);
            }
            console.log(`Compra registrada con éxito. ID: ${this.lastID}`);
            resolve({ id: this.lastID });
        });
    });
}

async function getPurchaseById(id) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM history WHERE id = ?", [id], (err, row) => {
            err ? reject(err) : resolve(row);
        });
    });
}

async function updatePurchaseStatus(id, status, licenseKey = null, senderId = null) {
    return new Promise((resolve, reject) => {
        let query = "UPDATE history SET status = ? WHERE id = ?";
        let params = [status, id];

        // Si la compra es aprobada, también guardamos la licencia y quién la envió.
        if (status === 'APPROVED' && licenseKey && senderId) {
            query = "UPDATE history SET status = ?, license_key = ?, sender_id = ? WHERE id = ?";
            params = [status, licenseKey, senderId, id];
        }
        
        db.run(query, params, function(err) {
            if (err) {
                console.error(`Error updating purchase ${id} to status ${status}:`, err);
                return reject(err);
            }
            resolve({ changes: this.changes });
        });
    });
}

async function resetUserHwid(userId) {
    return new Promise((resolve, reject) => {
        const query = "UPDATE users SET hwid = NULL WHERE id = ?";
        db.run(query, [userId], function(err) {
            if (err) return reject(err);
            resolve({ changes: this.changes });
        });
    });
}

module.exports = {
    initializeDatabase,
    getDb: () => db,
    addUser,
    updateUser,
    getUsers,
    deleteUser,
    getUserByUsername,
    getSellerPermissions,
    addProduct,
    updateProduct,
    deleteProduct,
    addPurchaseToHistory,
    getPurchaseById,
    updatePurchaseStatus,
    resetUserHwid
};
