require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sgMail = require('@sendgrid/mail');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const { 
    initializeDatabase, 
    getDb, 
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
} = require('./database');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

let JWT_SECRET;
let fromEmail;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Servir archivos estáticos desde el directorio raíz del proyecto (un nivel arriba de 'server')
const publicPath = path.resolve(__dirname, '..');
app.use(express.static(publicPath));

// Servir archivos específicos del panel de admin desde la carpeta 'server'
app.use('/admin', express.static(path.resolve(__dirname)));

// Ruta pública para obtener todos los productos
app.get('/api/public-products', (req, res) => {
    const db = getDb();
    // Corregido: Seleccionar todos los campos para la vista pública
    db.all("SELECT * FROM products ORDER BY id", [], (err, rows) => {
        if (err) {
            res.status(500).json({ message: 'Error al obtener los productos.' });
            return;
        }
        res.json(rows);
    });
});

app.post('/login', async (req, res) => {
    const { username, password, hwid } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Usuario y contraseña requeridos.' });
    }
    try {
        const user = await getUserByUsername(username);
        if (!user) {
            return res.status(401).json({ message: 'Usuario o contraseña incorrectos.' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Usuario o contraseña incorrectos.' });
        }

        // Lógica de HWID solo para vendedores
        if (user.role === 'seller') {
            if (!hwid) {
                return res.status(400).json({ message: 'No se pudo obtener el identificador del equipo.' });
            }
            if (user.hwid && user.hwid !== hwid) {
                return res.status(403).json({ message: 'Esta cuenta está vinculada a otro equipo.' });
            }
            if (!user.hwid) {
                // Vincular HWID si es el primer inicio de sesión
                const db = getDb();
                db.run("UPDATE users SET hwid = ? WHERE id = ?", [hwid, user.id]);
            }
        }

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ role: user.role, token, credits: user.credits });

    } catch (error) {
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

app.post('/submit-purchase', upload.single('comprobante'), async (req, res) => {
    const { producto, metodo, correo } = req.body;
    const comprobante = req.file;
    const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

    if (!DISCORD_WEBHOOK_URL) {
        return res.status(500).json({ message: 'Error de configuración del servidor.' });
    }
    if (!producto || !metodo || !correo || !comprobante) {
        return res.status(400).json({ message: 'Faltan datos en el formulario.' });
    }

    try {
        await addPurchaseToHistory(correo, producto, metodo);
        const formData = new FormData();
        const embed = {
            title: "Nuevo Comprobante de Pago Recibido",
            color: 3447003,
            fields: [
                { name: "Producto", value: producto, inline: true },
                { name: "Método de Pago", value: metodo, inline: true },
                { name: "Correo Electrónico", value: `||${correo}||` }
            ],
            footer: { text: `Update V1 Payments | Compra registrada en la DB` }
        };
        formData.append('payload_json', JSON.stringify({ embeds: [embed] }));
        formData.append('file', comprobante.buffer, { filename: comprobante.originalname });
        
        // Envía el webhook a Discord y espera la respuesta
        const discordResponse = await axios.post(DISCORD_WEBHOOK_URL, formData, { 
            headers: formData.getHeaders() 
        });

        // Verifica si Discord respondió con un error
        if (discordResponse.status < 200 || discordResponse.status >= 300) {
            // Si hay un error, lo lanza para ser capturado por el bloque catch
            throw new Error(`Error from Discord: ${discordResponse.statusText}`);
        }

        // Si todo fue bien, envía la respuesta de éxito al cliente
        res.status(200).json({ message: 'Comprobante enviado y registrado con éxito.' });
    } catch (error) {
        // Loguea el error detallado en la consola del servidor para depuración
        console.error('Error detallado al procesar la compra:', error);
        
        // Envía una respuesta de error genérica al cliente
        res.status(500).json({ message: 'Error al procesar la solicitud. Por favor, contacta al soporte.' });
    }
});

const productRouter = express.Router();
productRouter.use(authenticateToken, authorizeAdmin);

// Ruta para obtener todos los detalles de un producto específico
productRouter.get('/:id', (req, res) => {
    const { id } = req.params;
    const db = getDb();
    db.get("SELECT * FROM products WHERE id = ?", [id], (err, row) => {
        if (err) {
            return res.status(500).json({ message: 'Error al obtener el producto.' });
        }
        if (!row) {
            return res.status(404).json({ message: 'Producto no encontrado.' });
        }
        res.json(row);
    });
});

productRouter.post('/', async (req, res) => {
    const { name, description, price, image_url, features } = req.body;
    if (!name) return res.status(400).json({ message: 'El nombre es requerido.' });
    try {
        const newProduct = await addProduct(name, description, price, image_url, features);
        res.status(201).json(newProduct);
    } catch (error) {
        res.status(500).json({ message: 'Error al crear el producto.' });
    }
});

productRouter.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, description, price, image_url, features } = req.body;
    if (!name) return res.status(400).json({ message: 'El nombre es requerido.' });
    try {
        const changes = await updateProduct(id, name, description, price, image_url, features);
        if (changes === 0) return res.status(404).json({ message: 'Producto no encontrado.' });
        res.status(200).json({ message: 'Producto actualizado.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar.' });
    }
});

productRouter.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const changes = await deleteProduct(id);
        if (changes === 0) return res.status(404).json({ message: 'Producto no encontrado.' });
        res.status(200).json({ message: 'Producto eliminado.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al eliminar.' });
    }
});

app.use('/api/products', productRouter);

const emailTemplates = {
    'Aimbot Competitivo': { subject: 'Tu Licencia para Aimbot Competitivo', html: (license, product) => `<h1>Licencia para ${product}</h1><p>Tu clave es: <strong>${license}</strong></p>` },
    'Aimbot Personalizado': { subject: 'Tu Licencia para Aimbot Personalizado', html: (license, product) => `<h1>Licencia para ${product}</h1><p>Tu clave es: <strong>${license}</strong></p>` },
    'Paquete ESP Completo': { subject: 'Tu Licencia para Paquete ESP Completo', html: (license, product) => `<h1>Licencia para ${product}</h1><p>Tu clave es: <strong>${license}</strong></p>` },
    'Bypass APK': { subject: 'Tu Licencia para Bypass APK', html: (license, product) => `<h1>Licencia para ${product}</h1><p>Tu clave es: <strong>${license}</strong></p>` },
    'default': {
        subject: (product) => `Tu Licencia para ${product} de Update V1`,
        html: (license, product) => `<h1>¡Gracias por tu compra!</h1><p>Aquí tienes tu clave de licencia para <strong>${product}</strong>:</p><h2 style="background: #f0f0f0; padding: 10px; display: inline-block;">${license}</h2><p>Gracias,<br>El equipo de Update V1</p>`
    }
};

const getEmailTemplate = (productName) => {
    return emailTemplates[productName] || {
        subject: emailTemplates.default.subject(productName),
        html: (license) => emailTemplates.default.html(license, productName)
    };
};

app.post('/approve-purchase/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const db = getDb();
    const senderId = req.user.id;
    const dbRun = (query, params) => new Promise((resolve, reject) => db.run(query, params, (err) => err ? reject(err) : resolve(true)));

    try {
        await dbRun("BEGIN TRANSACTION");
        const purchase = await getPurchaseById(id);
        if (!purchase || purchase.status !== 'PENDING') {
            await dbRun("ROLLBACK");
            return res.status(404).json({ message: 'Compra no encontrada o ya procesada.' });
        }
        const productRow = await new Promise((resolve, reject) => db.get("SELECT id FROM products WHERE name = ?", [purchase.product_name], (err, row) => err ? reject(err) : resolve(row)));
        if (!productRow) {
            await dbRun("ROLLBACK");
            return res.status(400).json({ message: `El producto "${purchase.product_name}" no existe.` });
        }
        const licenseRow = await new Promise((resolve, reject) => db.get("SELECT id, key FROM licenses WHERE product_id = ? AND is_used = 0 LIMIT 1", [productRow.id], (err, row) => err ? reject(err) : resolve(row)));
        if (!licenseRow) {
            await dbRun("ROLLBACK");
            return res.status(400).json({ message: `No quedan licencias para ${purchase.product_name}.` });
        }
        await dbRun("UPDATE licenses SET is_used = 1, used_at = ?, used_by_email = ? WHERE id = ?", [new Date().toISOString(), purchase.email, licenseRow.id]);
        await updatePurchaseStatus(id, 'APPROVED', licenseRow.key, senderId);
        await dbRun("COMMIT");

        const template = getEmailTemplate(purchase.product_name);
        await sgMail.send({ to: purchase.email, from: fromEmail, subject: template.subject, html: template.html(licenseRow.key) });
        
        res.status(200).json({ message: `Compra ${id} aprobada. Licencia enviada.` });
    } catch (error) {
        await dbRun("ROLLBACK").catch(console.error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

app.post('/reject-purchase/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const purchase = await getPurchaseById(id);
        if (!purchase || purchase.status !== 'PENDING') {
            return res.status(404).json({ message: 'Compra no encontrada o ya procesada.' });
        }
        const { changes } = await updatePurchaseStatus(id, 'REJECTED');
        if (changes === 0) {
            return res.status(404).json({ message: 'No se pudo actualizar la compra.' });
        }
        res.status(200).json({ message: `Compra ${id} rechazada.` });
    } catch (error) {
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

const PRODUCTS_LIST = ['Aimbot Competitivo', 'Aimbot Personalizado', 'Paquete ESP Completo', 'Bypass APK'];

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) {
        return res.status(401).json({ message: 'Token no proporcionado. Acceso no autorizado.' });
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Token inválido o expirado. Acceso prohibido.' });
        }
        req.user = user;
        next();
    });
}

function authorizeAdmin(req, res, next) {
    if (req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Acceso denegado.' });
    }
}

app.get('/products', authenticateToken, async (req, res) => {
    const db = getDb();
    const baseQuery = "SELECT * FROM products ORDER BY id";
    if (req.user.role === 'admin') {
        db.all(baseQuery, [], (err, rows) => {
            if (err) return res.status(500).json({ message: 'Error al obtener productos.' });
            res.json(rows);
        });
    } else {
        try {
            const allowedProductIds = await getSellerPermissions(req.user.id);
            if (allowedProductIds.length === 0) return res.json([]);
            const placeholders = allowedProductIds.map(() => '?').join(',');
            db.all(`SELECT * FROM products WHERE id IN (${placeholders}) ORDER BY id`, allowedProductIds, (err, rows) => {
                if (err) return res.status(500).json({ message: 'Error al obtener productos.' });
                res.json(rows);
            });
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener permisos de productos.' });
        }
    }
});

app.get('/licenses-all', authenticateToken, (req, res) => {
    const db = getDb();
    db.all(`SELECT p.name, COUNT(l.id) AS count FROM products p LEFT JOIN licenses l ON p.id = l.product_id AND l.is_used = 0 GROUP BY p.name`, [], (err, rows) => {
        const counts = {};
        rows.forEach(row => { counts[row.name] = row.count; });
        res.json(counts);
    });
});

app.post('/send-license', authenticateToken, async (req, res) => {
    const { email, product } = req.body;
    const db = getDb();
    const senderId = req.user.id;

    try {
        const productRow = await new Promise((resolve, reject) => db.get("SELECT id FROM products WHERE name = ?", [product], (err, row) => err ? reject(err) : resolve(row)));
        if (!productRow) return res.status(400).json({ message: 'Producto no válido.' });

        const licenseRow = await new Promise((resolve, reject) => db.get("SELECT id, key FROM licenses WHERE product_id = ? AND is_used = 0 LIMIT 1", [productRow.id], (err, row) => err ? reject(err) : resolve(row)));
        if (!licenseRow) return res.status(400).json({ message: `No quedan licencias para ${product}.` });

        await new Promise((resolve, reject) => db.run("UPDATE licenses SET is_used = 1, used_at = ?, used_by_email = ? WHERE id = ?", [new Date().toISOString(), email, licenseRow.id], (err) => err ? reject(err) : resolve()));
        await new Promise((resolve, reject) => db.run("INSERT INTO history (date, email, product_name, license_key, sender_id) VALUES (?, ?, ?, ?, ?)", [new Date().toISOString(), email, product, licenseRow.key, senderId], (err) => err ? reject(err) : resolve()));

        const template = getEmailTemplate(product);
        await sgMail.send({ to: email, from: fromEmail, subject: template.subject, html: template.html(licenseRow.key) });

        res.status(200).json({ message: `Licencia para ${product} enviada.` });
    } catch (error) {
        res.status(500).json({ message: 'Error al enviar licencia.' });
    }
});

app.get('/history', authenticateToken, (req, res) => {
    const db = getDb();
    const { status } = req.query;
    let query = `SELECT h.*, u.username as sender_name FROM history h LEFT JOIN users u ON h.sender_id = u.id`;
    const params = [];
    if (status) {
        query += ' WHERE h.status = ?';
        params.push(status);
    }
    query += ' ORDER BY h.date DESC';
    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ message: 'Error al obtener historial.' });
        res.json(rows.map(row => ({...row, multiple_licenses_data: row.multiple_licenses_data ? JSON.parse(row.multiple_licenses_data) : {}})));
    });
});

app.post('/add-licenses', authenticateToken, authorizeAdmin, async (req, res) => {
    const { product, licenses } = req.body;
    const db = getDb();
    try {
        const productRow = await new Promise((resolve, reject) => db.get("SELECT id FROM products WHERE name = ?", [product], (err, row) => err ? reject(err) : resolve(row)));
        if (!productRow) return res.status(400).json({ message: 'Producto no válido.' });
        const newLicenses = licenses.split('\n').map(l => l.trim()).filter(Boolean);
        if (newLicenses.length === 0) return res.status(400).json({ message: 'No se proporcionaron licencias.' });
        const stmt = db.prepare("INSERT OR IGNORE INTO licenses (product_id, key) VALUES (?, ?)");
        newLicenses.forEach(key => stmt.run(productRow.id, key));
        stmt.finalize();
        res.status(200).json({ message: `${newLicenses.length} licencias añadidas.` });
    } catch (error) {
        res.status(500).json({ message: 'Error al añadir licencias.' });
    }
});

app.get('/users', authenticateToken, authorizeAdmin, async (req, res) => {
    const users = await getUsers();
    res.json(users.map(({ password_hash, ...user }) => user));
});

app.post('/users', authenticateToken, authorizeAdmin, async (req, res) => {
    const { username, password, role, allowed_products } = req.body;
    if (!username || !password || !role) return res.status(400).json({ message: 'Faltan datos.' });
    try {
        const newUser = await addUser(username, password, role, allowed_products);
        res.status(201).json(newUser);
    } catch (error) {
        res.status(500).json({ message: 'Error al crear usuario.' });
    }
});

app.put('/users/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { username, password, role, credits, allowed_products } = req.body;
    if (!username || !role || credits === undefined) return res.status(400).json({ message: 'Faltan datos.' });
    try {
        await updateUser(id, username, password, role, credits, allowed_products);
        res.status(200).json({ message: 'Usuario actualizado.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar usuario.' });
    }
});

app.delete('/users/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await deleteUser(id);
        res.status(200).json({ message: 'Usuario eliminado.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al eliminar usuario.' });
    }
});

app.post('/users/:id/reset-hwid', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await resetUserHwid(id);
        if (result.changes === 0) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }
        res.status(200).json({ message: 'El HWID del usuario ha sido reseteado.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al resetear el HWID.' });
    }
});

app.get('/users/:id/permissions', authenticateToken, authorizeAdmin, async (req, res) => {
    const permissions = await getSellerPermissions(req.params.id);
    res.json(permissions);
});

app.listen(PORT, async () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    JWT_SECRET = process.env.JWT_SECRET;
    fromEmail = process.env.FROM_EMAIL;
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    if (!JWT_SECRET || !fromEmail || !process.env.SENDGRID_API_KEY) {
        console.warn('ADVERTENCIA: Faltan variables de entorno críticas.');
    }
    try {
        await initializeDatabase(PRODUCTS_LIST);
        
        const adminUsername = 'admin';
        const adminPassword = process.env.ADMIN_PASSWORD || 'password';
        const admin = await getUserByUsername(adminUsername);

        if (admin) {
            // Si el admin existe, nos aseguramos de que la contraseña sea la correcta
            await updateUser(admin.id, admin.username, adminPassword, admin.role, admin.credits);
            console.log('Contraseña de administrador sincronizada con éxito.');
        } else {
            // Si no existe, lo creamos
            await addUser(adminUsername, adminPassword, 'admin');
            console.log('Usuario administrador creado con éxito.');
        }
    } catch (error) {
        console.error('Error al inicializar la base de datos:', error);
    }
});
