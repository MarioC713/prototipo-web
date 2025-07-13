const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function query(text, params) {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('executed query', { text, duration, rows: res.rowCount });
    return res;
}

async function initializeDatabase(productsList = []) {
    const createProductsTable = `
    CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        price VARCHAR(255),
        image_url TEXT,
        features TEXT
    );`;

    const createLicensesTable = `
    CREATE TABLE IF NOT EXISTS licenses (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        key VARCHAR(255) UNIQUE NOT NULL,
        is_used BOOLEAN DEFAULT FALSE,
        used_at TIMESTAMPTZ,
        used_by_email VARCHAR(255),
        FOREIGN KEY (product_id) REFERENCES products(id)
    );`;

    const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        credits INTEGER DEFAULT 0,
        hwid TEXT
    );`;

    const createHistoryTable = `
    CREATE TABLE IF NOT EXISTS history (
        id SERIAL PRIMARY KEY,
        date TIMESTAMPTZ NOT NULL,
        email VARCHAR(255) NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        license_key VARCHAR(255),
        is_multiple BOOLEAN DEFAULT FALSE,
        multiple_licenses_data TEXT,
        sender_id INTEGER,
        payment_method VARCHAR(255),
        status VARCHAR(50) DEFAULT 'PENDING',
        FOREIGN KEY (sender_id) REFERENCES users(id)
    );`;

    const createSellerPermissionsTable = `
    CREATE TABLE IF NOT EXISTS seller_permissions (
        user_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, product_id)
    );`;

    try {
        await query(createProductsTable);
        await query(createLicensesTable);
        await query(createUsersTable);
        await query(createHistoryTable);
        await query(createSellerPermissionsTable);
        console.log('Tablas creadas o ya existentes.');

        const { rows: productCount } = await query("SELECT COUNT(*) AS count FROM products");
        if (parseInt(productCount[0].count, 10) === 0 && productsList.length > 0) {
            console.log('Populando la tabla de productos...');
            for (const product of productsList) {
                await query("INSERT INTO products (name) VALUES ($1)", [product]);
            }
            console.log('Tabla de productos populada.');
        }
    } catch (err) {
        console.error('Error al inicializar la base de datos:', err);
        throw err;
    }
}

async function updateSellerPermissions(userId, productIds = []) {
    await query("DELETE FROM seller_permissions WHERE user_id = $1", [userId]);
    if (productIds && productIds.length > 0) {
        for (const productId of productIds) {
            await query("INSERT INTO seller_permissions (user_id, product_id) VALUES ($1, $2)", [userId, productId]);
        }
    }
}

async function getSellerPermissions(userId) {
    const { rows } = await query("SELECT product_id FROM seller_permissions WHERE user_id = $1", [userId]);
    return rows.map(row => row.product_id);
}

async function addUser(username, password, role, allowed_products = []) {
    const password_hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
        "INSERT INTO users (username, password_hash, role, credits) VALUES ($1, $2, $3, 0) RETURNING id",
        [username, password_hash, role]
    );
    const userId = rows[0].id;
    if (role === 'seller') {
        await updateSellerPermissions(userId, allowed_products);
    }
    return { id: userId, username, role, credits: 0 };
}

async function updateUser(id, username, password, role, credits, allowed_products = []) {
    let res;
    if (password) {
        const password_hash = await bcrypt.hash(password, 10);
        res = await query(
            "UPDATE users SET username = $1, password_hash = $2, role = $3, credits = $4 WHERE id = $5",
            [username, password_hash, role, credits, id]
        );
    } else {
        res = await query(
            "UPDATE users SET username = $1, role = $2, credits = $3 WHERE id = $4",
            [username, role, credits, id]
        );
    }
    await updateSellerPermissions(id, role === 'seller' ? allowed_products : []);
    return res.rowCount;
}

async function getUsers() {
    const { rows } = await query("SELECT id, username, role, credits, hwid FROM users");
    return rows;
}

async function deleteUser(id) {
    const { rowCount } = await query("DELETE FROM users WHERE id = $1", [id]);
    return rowCount;
}

async function getUserByUsername(username) {
    const { rows } = await query("SELECT * FROM users WHERE username = $1", [username]);
    return rows[0];
}

async function addProduct(name, description = '', price = '', imageUrl = '', features = '[]') {
    const { rows } = await query(
        `INSERT INTO products (name, description, price, image_url, features) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [name, description, price, imageUrl, features]
    );
    return rows[0];
}

async function updateProduct(id, name, description, price, imageUrl, features) {
    const { rowCount } = await query(
        `UPDATE products SET name = $1, description = $2, price = $3, image_url = $4, features = $5 WHERE id = $6`,
        [name, description, price, imageUrl, features, id]
    );
    return rowCount;
}

async function deleteProduct(id) {
    const { rowCount } = await query("DELETE FROM products WHERE id = $1", [id]);
    return rowCount;
}

async function addPurchaseToHistory(email, productName, paymentMethod) {
    const date = new Date();
    const { rows } = await query(
        `INSERT INTO history (date, email, product_name, payment_method, status, license_key) VALUES ($1, $2, $3, $4, 'PENDING', '') RETURNING id`,
        [date, email, productName, paymentMethod]
    );
    return { id: rows[0].id };
}

async function getPurchaseById(id) {
    const { rows } = await query("SELECT * FROM history WHERE id = $1", [id]);
    return rows[0];
}

async function updatePurchaseStatus(id, status, licenseKey = null, senderId = null) {
    let res;
    if (status === 'APPROVED' && licenseKey && senderId) {
        res = await query(
            "UPDATE history SET status = $1, license_key = $2, sender_id = $3 WHERE id = $4",
            [status, licenseKey, senderId, id]
        );
    } else {
        res = await query("UPDATE history SET status = $1 WHERE id = $2", [status, id]);
    }
    return { changes: res.rowCount };
}

async function resetUserHwid(userId) {
    const { rowCount } = await query("UPDATE users SET hwid = NULL WHERE id = $1", [userId]);
    return { changes: rowCount };
}

module.exports = {
    initializeDatabase,
    getDb: () => pool, // Aunque no se usa directamente, mantenemos la exportación por consistencia
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
