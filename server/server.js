// Prototipo Web Server v1.1
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
app.get('/api/public-products', async (req, res) => {
    const db = getDb();
    try {
        const { rows } = await db.query("SELECT * FROM products ORDER BY id");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Error al obtener los productos.' });
    }
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

        if (user.role === 'seller') {
            if (!hwid) {
                return res.status(400).json({ message: 'No se pudo obtener el identificador del equipo.' });
            }
            if (user.hwid && user.hwid !== hwid) {
                return res.status(403).json({ message: 'Esta cuenta está vinculada a otro equipo.' });
            }
            if (!user.hwid) {
                const db = getDb();
                await db.query("UPDATE users SET hwid = $1 WHERE id = $2", [hwid, user.id]);
            }
        }

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ role: user.role, token, credits: user.credits });

    } catch (error) {
        console.error("Login error:", error);
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
        
        const discordResponse = await axios.post(DISCORD_WEBHOOK_URL, formData, { 
            headers: formData.getHeaders() 
        });

        if (discordResponse.status < 200 || discordResponse.status >= 300) {
            throw new Error(`Error from Discord: ${discordResponse.statusText}`);
        }

        res.status(200).json({ message: 'Comprobante enviado y registrado con éxito.' });
    } catch (error) {
        console.error('Error detallado al procesar la compra:', error);
        res.status(500).json({ message: 'Error al procesar la solicitud. Por favor, contacta al soporte.' });
    }
});

const productRouter = express.Router();
productRouter.use(authenticateToken, authorizeAdmin);

productRouter.get('/:id', async (req, res) => {
    const { id } = req.params;
    const db = getDb();
    try {
        const { rows } = await db.query("SELECT * FROM products WHERE id = $1", [id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Producto no encontrado.' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error(`Error fetching product ${id}:`, error);
        res.status(500).json({ message: 'Error al obtener el producto.' });
    }
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
        html: (license, product) => emailTemplates.default.html(license, product)
    };
};

app.post('/approve-purchase/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const db = getDb();
    const senderId = req.user.id;
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const purchase = await getPurchaseById(id);
        if (!purchase || purchase.status !== 'PENDING') {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Compra no encontrada o ya procesada.' });
        }
        const productRes = await client.query("SELECT id FROM products WHERE name = $1", [purchase.product_name]);
        if (productRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `El producto "${purchase.product_name}" no existe.` });
        }
        const productRow = productRes.rows[0];
        const licenseRes = await client.query("SELECT id, key FROM licenses WHERE product_id = $1 AND is_used = FALSE LIMIT 1 FOR UPDATE", [productRow.id]);
        if (licenseRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `No quedan licencias para ${purchase.product_name}.` });
        }
        const licenseRow = licenseRes.rows[0];
        await client.query("UPDATE licenses SET is_used = TRUE, used_at = NOW(), used_by_email = $1 WHERE id = $2", [purchase.email, licenseRow.id]);
        await updatePurchaseStatus(id, 'APPROVED', licenseRow.key, senderId);
        await client.query('COMMIT');

        const template = getEmailTemplate(purchase.product_name);
        await sgMail.send({ to: purchase.email, from: fromEmail, subject: template.subject, html: template.html(licenseRow.key, purchase.product_name) });
        
        res.status(200).json({ message: `Compra ${id} aprobada. Licencia enviada.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error approving purchase:", error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    } finally {
        client.release();
    }
});

app.post('/reject-purchase/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const purchase = await getPurchaseById(id);
        if (!purchase || purchase.status !== 'PENDING') {
            return res.status(404).json({ message: 'Compra no encontrada o ya procesada.' });
        }
        await updatePurchaseStatus(id, 'REJECTED');
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
    try {
        if (req.user.role === 'admin') {
            const { rows } = await db.query("SELECT * FROM products ORDER BY id");
            res.json(rows);
        } else {
            const allowedProductIds = await getSellerPermissions(req.user.id);
            if (allowedProductIds.length === 0) {
                return res.json([]);
            }
            const placeholders = allowedProductIds.map((_, i) => `$${i + 1}`).join(',');
            const { rows } = await db.query(`SELECT * FROM products WHERE id IN (${placeholders}) ORDER BY id`, allowedProductIds);
            res.json(rows);
        }
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ message: 'Error al obtener productos.' });
    }
});

app.get('/licenses-all', authenticateToken, async (req, res) => {
    const db = getDb();
    try {
        const { rows } = await db.query(`SELECT p.name, COUNT(l.id) AS count FROM products p LEFT JOIN licenses l ON p.id = l.product_id AND l.is_used = FALSE GROUP BY p.name`);
        const counts = {};
        rows.forEach(row => {
            counts[row.name] = parseInt(row.count, 10);
        });
        res.json(counts);
    } catch (error) {
        console.error('Error fetching license counts:', error);
        res.status(500).json({ message: 'Error al obtener el inventario de licencias.' });
    }
});

app.post('/send-license', authenticateToken, async (req, res) => {
    const { email, product } = req.body;
    const db = getDb();
    const senderId = req.user.id;
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const productRes = await client.query("SELECT id FROM products WHERE name = $1", [product]);
        if (productRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Producto no válido.' });
        }
        const productRow = productRes.rows[0];

        const licenseRes = await client.query("SELECT id, key FROM licenses WHERE product_id = $1 AND is_used = FALSE LIMIT 1 FOR UPDATE", [productRow.id]);
        if (licenseRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `No quedan licencias para ${product}.` });
        }
        const licenseRow = licenseRes.rows[0];

        await client.query("UPDATE licenses SET is_used = TRUE, used_at = NOW(), used_by_email = $1 WHERE id = $2", [email, licenseRow.id]);
        await client.query("INSERT INTO history (date, email, product_name, license_key, sender_id, status) VALUES (NOW(), $1, $2, $3, $4, 'APPROVED')", [email, product, licenseRow.key, senderId]);

        await client.query('COMMIT');

        const template = getEmailTemplate(product);
        await sgMail.send({ to: email, from: fromEmail, subject: template.subject, html: template.html(licenseRow.key, product) });

        res.status(200).json({ message: `Licencia para ${product} enviada.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error sending license:', error);
        res.status(500).json({ message: 'Error al enviar licencia.' });
    } finally {
        client.release();
    }
});

app.get('/history', authenticateToken, async (req, res) => {
    const db = getDb();
    const { status } = req.query;
    let baseQuery = `SELECT h.*, u.username as sender_name FROM history h LEFT JOIN users u ON h.sender_id = u.id`;
    const params = [];
    if (status) {
        baseQuery += ' WHERE h.status = $1';
        params.push(status);
    }
    baseQuery += ' ORDER BY h.date DESC';
    try {
        const { rows } = await db.query(baseQuery, params);
        res.json(rows.map(row => ({...row, multiple_licenses_data: row.multiple_licenses_data ? JSON.parse(row.multiple_licenses_data) : {}})));
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ message: 'Error al obtener historial.' });
    }
});

app.post('/add-licenses', authenticateToken, authorizeAdmin, async (req, res) => {
    const { product, licenses } = req.body;
    const db = getDb();
    try {
        const productRes = await db.query("SELECT id FROM products WHERE name = $1", [product]);
        if (productRes.rows.length === 0) {
            return res.status(400).json({ message: 'Producto no válido.' });
        }
        const productRow = productRes.rows[0];
        const newLicenses = licenses.split('\n').map(l => l.trim()).filter(Boolean);
        if (newLicenses.length === 0) {
            return res.status(400).json({ message: 'No se proporcionaron licencias.' });
        }
        
        for (const key of newLicenses) {
            await db.query("INSERT INTO licenses (product_id, key) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING", [productRow.id, key]);
        }
        
        res.status(200).json({ message: `${newLicenses.length} licencias añadidas.` });
    } catch (error) {
        console.error("Error adding licenses:", error);
        res.status(500).json({ message: 'Error al añadir licencias.' });
    }
});

app.get('/users', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const users = await getUsers();
        res.json(users.map(({ password_hash, ...user }) => user));
    } catch(e) {
        res.status(500).json({ message: 'Error al obtener usuarios.' });
    }
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
    try {
        const permissions = await getSellerPermissions(req.params.id);
        res.json(permissions);
    } catch(e) {
        res.status(500).json({ message: 'Error al obtener permisos.' });
    }
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
            await updateUser(admin.id, admin.username, adminPassword, admin.role, admin.credits);
            console.log('Contraseña de administrador sincronizada con éxito.');
        } else {
            await addUser(adminUsername, adminPassword, 'admin');
            console.log('Usuario administrador creado con éxito.');
        }
    } catch (error) {
        console.error('Error al inicializar la aplicación:', error);
    }
});
