// --- Configuración ---
let PRODUCTS = [];

// --- Funciones de Utilidad ---
/**
 * Genera un identificador de hardware (HWID) simple basado en propiedades del navegador.
 * No es infalible, pero es suficiente para este caso de uso.
 */
function generateHwid() {
    const navigator = window.navigator;
    const screen = window.screen;
    let hwid = navigator.userAgent.replace(/\D+/g, '');
    hwid += `-${screen.height}x${screen.width}x${screen.colorDepth}`;
    hwid += `-${navigator.language}`;
    hwid += `-${new Date().getTimezoneOffset()}`;
    // Simple hash para ofuscar un poco
    let hash = 0;
    for (let i = 0; i < hwid.length; i++) {
        const char = hwid.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return `hwid-${Math.abs(hash).toString(16)}`;
}

// --- Elementos del DOM ---
const passwordPrompt = document.getElementById('password-prompt');
const mainContent = document.getElementById('main-content');
const licenseStatsContainer = document.getElementById('license-stats-container');
const form = document.getElementById('send-license-form');
const emailInput = document.getElementById('email');
const productContainer = document.getElementById('product-container');
const addProductBtn = document.getElementById('add-product-btn');
const logEl = document.getElementById('log');
const historyTableBody = document.getElementById('history-table-body');
const navLinks = document.querySelectorAll('.nav-link');
const tabPanels = document.querySelectorAll('.tab-panel');
const panelTitle = document.getElementById('panel-title');
const addStockForm = document.getElementById('add-stock-form');
const stockProductSelect = document.getElementById('stock-product-select');
const licensesTextarea = document.getElementById('licenses-textarea');
const logoutBtn = document.getElementById('logout-btn');
const loginBtn = document.getElementById('login-btn');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const currentUsernameSpan = document.getElementById('current-username');
const addUserForm = document.getElementById('add-user-form');
const newUsernameInput = document.getElementById('new-username');
const newPasswordInput = document.getElementById('new-password');
const newRoleSelect = document.getElementById('new-role');
const usersTableBody = document.getElementById('users-table-body');
const newUserPermissionsContainer = document.getElementById('new-user-permissions-container');
const newUserProductList = document.getElementById('new-user-product-list');
const manageProductsPanel = document.getElementById('manage-products-panel');
const addProductForm = document.getElementById('add-product-form');
const newProductNameInput = document.getElementById('new-product-name');
const productsTableBody = document.getElementById('products-table-body');
const editUserModal = document.getElementById('edit-user-modal');
const editProductModal = document.getElementById('edit-product-modal');
const editProductForm = document.getElementById('edit-product-form');
const closeEditProductModalBtn = editProductModal.querySelector('.close-button');
const editUserPermissionsContainer = document.getElementById('edit-user-permissions-container');
const editUserProductList = document.getElementById('edit-user-product-list');
const closeEditModalBtn = editUserModal.querySelector('.close-button');
const editUserForm = document.getElementById('edit-user-form');
const editUserIdInput = document.getElementById('edit-user-id');
const editUsernameInput = document.getElementById('edit-username');
const editPasswordInput = document.getElementById('edit-password');
const editRoleSelect = document.getElementById('edit-role');
const editCreditsInput = document.getElementById('edit-credits');
const pendingPurchasesTableBody = document.getElementById('pending-purchases-table-body');

// --- Funciones ---

function addToLog(message, isError = false) {
    const logMessage = document.createElement('p');
    logMessage.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logMessage.className = isError ? 'log-error' : 'log-success';
    logEl.appendChild(logMessage);
    logEl.scrollTop = logEl.scrollHeight;
}

function createProductSelector() {
    const selectorWrapper = document.createElement('div');
    selectorWrapper.className = 'product-selector-wrapper';
    const select = document.createElement('select');
    select.className = 'product-select form-control';
    select.required = true;
    select.innerHTML = '<option value="">-- Seleccione un producto --</option>';
    PRODUCTS.forEach(product => {
        const option = document.createElement('option');
        option.value = product.name;
        option.textContent = product.name;
        select.appendChild(option);
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-product-btn';
    removeBtn.textContent = 'Eliminar';
    removeBtn.onclick = () => {
        if (productContainer.children.length > 1) {
            selectorWrapper.remove();
        } else {
            addToLog('Debe seleccionar al menos un producto.', true);
        }
    };
    selectorWrapper.appendChild(select);
    selectorWrapper.appendChild(removeBtn);
    productContainer.appendChild(selectorWrapper);
}

async function fetchLicenseCounts() {
    const iconMap = {
        'Aimbot Competitivo': 'fa-crosshairs',
        'Aimbot Personalizado': 'fa-sliders',
        'Paquete ESP Completo': 'fa-eye',
        'Bypass APK': 'fa-mobile-screen-button'
    };
    try {
        const response = await authenticatedFetch(`/licenses-all`);
        if (!response.ok) throw new Error('No se pudo obtener el inventario.');
        const allCounts = await response.json();
        const allowedProductNames = new Set(PRODUCTS.map(p => p.name));
        const filteredCounts = Object.fromEntries(
            Object.entries(allCounts).filter(([productName]) => allowedProductNames.has(productName))
        );
        licenseStatsContainer.innerHTML = '';
        if (Object.keys(filteredCounts).length === 0 && localStorage.getItem('userRole') === 'seller') {
            licenseStatsContainer.innerHTML = '<p>No tienes productos asignados.</p>';
            return;
        }
        for (const product in filteredCounts) {
            const count = filteredCounts[product];
            const card = document.createElement('div');
            card.className = 'stat-card';
            let colorClass = count > 10 ? 'green' : (count > 0 ? 'yellow' : 'red');
            card.innerHTML = `
                <div class="stat-card-icon ${colorClass}">
                    <i class="fas ${iconMap[product] || 'fa-ticket'}"></i>
                </div>
                <div class="stat-card-info">
                    <p>${product}</p>
                    <span>${count}</span>
                </div>
            `;
            licenseStatsContainer.appendChild(card);
        }
    } catch (error) {
        addToLog(error.message, true);
        licenseStatsContainer.innerHTML = '<p class="error-text">Error al cargar inventario.</p>';
    }
}

function setupDashboardForRole(role) {
    const isAdmin = role === 'admin';
    document.querySelector('[data-tab="users"]').style.display = isAdmin ? 'flex' : 'none';
    document.querySelector('[data-tab="stock"]').style.display = isAdmin ? 'flex' : 'none';
    document.querySelector('[data-tab="history"]').style.display = isAdmin ? 'flex' : 'none';
    document.querySelector('[data-tab="manage-products"]').style.display = isAdmin ? 'flex' : 'none';
    document.querySelector('[data-tab="pending-purchases"]').style.display = isAdmin ? 'flex' : 'none';

    const storedUsername = localStorage.getItem('username');
    const storedCredits = localStorage.getItem('userCredits');
    if (currentUsernameSpan && storedUsername) {
        currentUsernameSpan.textContent = (role === 'seller' && storedCredits !== null)
            ? `${storedUsername} (Créditos: ${storedCredits})`
            : storedUsername;
    }
}

async function checkPassword() {
    const username = usernameInput.value;
    const password = passwordInput.value;
    if (!username || !password) return alert('Por favor, ingrese usuario y contraseña.');

    try {
        const hwid = generateHwid(); // Usar la nueva función local

        const response = await fetch(`/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, hwid }),
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Error de autenticación.');

        localStorage.setItem('jwtToken', result.token);
        localStorage.setItem('userRole', result.role);
        localStorage.setItem('username', username);
        localStorage.setItem('userCredits', result.credits);

        passwordPrompt.style.display = 'none';
        mainContent.style.display = 'flex';
        addToLog(`Acceso concedido como ${result.role}.`);

        await fetchProductsAndPopulateSelectors();
        fetchLicenseCounts();
        if (result.role === 'admin') {
            loadInitialAdminData();
        }
        setupDashboardForRole(result.role);
        handleTabChange({ currentTarget: document.querySelector('[data-tab="dashboard"]') });
    } catch (error) {
        alert(`Error de acceso: ${error.message}`);
    }
}

async function authenticatedFetch(url, options = {}) {
    const token = localStorage.getItem('jwtToken');
    if (!token) {
        handleLogout();
        throw new Error('Token no encontrado.');
    }
    options.headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
    const response = await fetch(url, options);
    if (response.status === 401 || response.status === 403) {
        handleLogout();
        throw new Error('Sesión expirada o inválida.');
    }
    return response;
}

async function fetchProductsAndPopulateSelectors() {
    try {
        const response = await authenticatedFetch(`/products`);
        if (!response.ok) throw new Error('No se pudo obtener la lista de productos.');
        PRODUCTS = await response.json();
        productContainer.innerHTML = '';
        createProductSelector();
        populateStockSelector();
    } catch (error) {
        addToLog(`Error al cargar productos: ${error.message}`, true);
    }
}

async function handleSendLicenses(e) {
    e.preventDefault();
    const email = emailInput.value;
    const products = Array.from(productContainer.querySelectorAll('.product-select')).map(s => s.value).filter(Boolean);
    if (!email || products.length === 0) return addToLog('Email y producto son requeridos.', true);
    
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Enviando...`;
    
    try {
        const endpoint = products.length === 1 ? '/send-license' : '/send-multiple-licenses';
        const body = products.length === 1 ? { email, product: products[0] } : { email, products };
        const response = await authenticatedFetch(`${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        
        addToLog(result.message, false);
        form.reset();
        productContainer.innerHTML = '';
        createProductSelector();
        fetchLicenseCounts();
        if (localStorage.getItem('userRole') === 'admin') fetchHistory();
        if (result.credits !== undefined) {
            localStorage.setItem('userCredits', result.credits);
            setupDashboardForRole(localStorage.getItem('userRole'));
        }
    } catch (error) {
        addToLog(error.message, true);
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = `<i class="fas fa-check"></i> Enviar Licencia(s)`;
    }
}

function handleTabChange(e) {
    if (e && e.preventDefault) e.preventDefault();
    const tab = e.currentTarget;
    const panelId = tab.dataset.tab + '-panel';
    navLinks.forEach(link => link.classList.remove('active'));
    tab.classList.add('active');
    // Usar el texto del enlace, pero quitando el icono
    panelTitle.textContent = tab.innerText.trim();
    tabPanels.forEach(panel => panel.style.display = panel.id === panelId ? 'block' : 'none');
    
    const loadAction = {
        'users-panel': fetchUsers,
        'history-panel': fetchHistory,
        'manage-products-panel': fetchAndDisplayProducts,
        'pending-purchases-panel': loadPendingPurchases,
    }[panelId];
    if (loadAction) loadAction();
}

async function fetchHistory() {
    try {
        const response = await authenticatedFetch(`/history`);
        if (!response.ok) throw new Error('No se pudo obtener el historial.');
        const history = await response.json();
        historyTableBody.innerHTML = history.length === 0 ? '<tr><td colspan="5" style="text-align: center;">No hay registros.</td></tr>' : '';
        history.forEach(entry => {
            const row = historyTableBody.insertRow();
            const products = entry.is_multiple ? Object.keys(entry.multiple_licenses_data).join(', ') : entry.product_name;
            const licenses = entry.is_multiple ? Object.values(entry.multiple_licenses_data).join('<br>') : entry.license_key;
            row.innerHTML = `
                <td>${new Date(entry.date).toLocaleString()}</td>
                <td>${entry.email}</td>
                <td>${products}</td>
                <td><code>${licenses}</code></td>
                <td>${entry.sender_name || 'Sistema'}</td>
            `;
        });
    } catch (error) {
        addToLog(error.message, true);
    }
}

async function loadPendingPurchases() {
    try {
        const response = await authenticatedFetch(`/history?status=PENDING`);
        if (!response.ok) throw new Error('No se pudo obtener compras pendientes.');
        const purchases = await response.json();
        pendingPurchasesTableBody.innerHTML = purchases.length === 0 ? '<tr><td colspan="5" style="text-align: center;">No hay compras pendientes.</td></tr>' : '';
        purchases.forEach(p => {
            const row = pendingPurchasesTableBody.insertRow();
            row.innerHTML = `
                <td>${new Date(p.date).toLocaleString()}</td>
                <td>${p.email}</td>
                <td>${p.product_name}</td>
                <td>${p.payment_method}</td>
                <td>
                    <button class="action-btn approve-btn" data-id="${p.id}"><i class="fas fa-check"></i></button>
                    <button class="action-btn reject-btn" data-id="${p.id}"><i class="fas fa-times"></i></button>
                </td>
            `;
        });

        // Añadir event listeners a los nuevos botones
        document.querySelectorAll('.approve-btn').forEach(button => {
            button.addEventListener('click', () => handleApprovePurchase(button.dataset.id));
        });
        document.querySelectorAll('.reject-btn').forEach(button => {
            button.addEventListener('click', () => handleRejectPurchase(button.dataset.id));
        });

    } catch (error) {
        addToLog(`Error al cargar compras pendientes: ${error.message}`, true);
    }
}

function populateStockSelector() {
    stockProductSelect.innerHTML = '<option value="">-- Seleccione producto --</option>';
    PRODUCTS.forEach(p => {
        stockProductSelect.innerHTML += `<option value="${p.name}">${p.name}</option>`;
    });
}

async function handleAddStock(e) {
    e.preventDefault();
    const product = stockProductSelect.value;
    const licenses = licensesTextarea.value;
    if (!product || !licenses) return addToLog('Seleccione producto y añada licencias.', true);
    
    const submitButton = addStockForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Añadiendo...`;
    
    try {
        const response = await authenticatedFetch(`/add-licenses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product, licenses }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        addToLog(result.message, false);
        licensesTextarea.value = '';
        fetchLicenseCounts();
    } catch (error) {
        addToLog(error.message, true);
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = `<i class="fas fa-plus-circle"></i> Añadir al Stock`;
    }
}

function handleLogout() {
    localStorage.clear();
    window.location.reload();
}

async function fetchUsers() {
    try {
        const response = await authenticatedFetch(`/users`);
        if (!response.ok) throw new Error('No se pudo obtener usuarios.');
        const users = await response.json();
        usersTableBody.innerHTML = users.length === 0 ? '<tr><td colspan="6" style="text-align: center;">No hay usuarios.</td></tr>' : '';
        const currentUserId = JSON.parse(atob(localStorage.getItem('jwtToken').split('.')[1])).id;
        
        users.forEach(user => {
            const row = usersTableBody.insertRow();
            const hwidDisplay = user.hwid ? `<code class="hwid-code" title="Click para copiar">${user.hwid}</code>` : 'No asignado';
            
            let actions = `<button class="edit-user-btn" data-id="${user.id}"><i class="fas fa-edit"></i></button>`;
            if (user.id !== currentUserId) {
                actions += ` <button class="delete-user-btn" data-id="${user.id}"><i class="fas fa-trash"></i></button>`;
            }
            if (user.role === 'seller' && user.hwid) {
                actions += ` <button class="reset-hwid-btn" data-id="${user.id}" title="Resetear HWID"><i class="fas fa-desktop"></i></button>`;
            }

            row.innerHTML = `
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td>${user.role}</td>
                <td>${user.credits}</td>
                <td>${hwidDisplay}</td>
                <td class="actions-cell">${actions}</td>
            `;
        });

        document.querySelectorAll('.delete-user-btn').forEach(b => b.addEventListener('click', e => handleDeleteUser(e.currentTarget.dataset.id)));
        document.querySelectorAll('.edit-user-btn').forEach(b => b.addEventListener('click', e => openEditUserModal(e.currentTarget.dataset.id)));
        document.querySelectorAll('.reset-hwid-btn').forEach(b => b.addEventListener('click', e => handleResetHwid(e.currentTarget.dataset.id)));
        
        // Añadir funcionalidad de copiar HWID
        document.querySelectorAll('.hwid-code').forEach(codeEl => {
            codeEl.addEventListener('click', () => {
                navigator.clipboard.writeText(codeEl.textContent).then(() => {
                    addToLog(`HWID copiado al portapapeles.`);
                }, (err) => {
                    addToLog(`Error al copiar HWID: ${err}`, true);
                });
            });
        });
    } catch (error) {
        addToLog(`Error al cargar usuarios: ${error.message}`, true);
    }
}

async function handleAddUser(e) {
    e.preventDefault();
    const username = newUsernameInput.value;
    const password = newPasswordInput.value;
    const role = newRoleSelect.value;
    const allowed_products = role === 'seller' ? Array.from(newUserProductList.querySelectorAll('input:checked')).map(cb => cb.value) : [];
    if (!username || !password || !role) return addToLog('Complete todos los campos.', true);
    
    const submitButton = addUserForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Creando...`;
    
    try {
        const response = await authenticatedFetch(`/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role, allowed_products }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        addToLog(result.message, false);
        addUserForm.reset();
        fetchUsers();
    } catch (error) {
        addToLog(`Error al añadir usuario: ${error.message}`, true);
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = `<i class="fas fa-plus-circle"></i> Crear Usuario`;
    }
}

async function handleDeleteUser(userId) {
    if (!confirm('¿Seguro que desea eliminar este usuario?')) return;
    try {
        const response = await authenticatedFetch(`/users/${userId}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        addToLog(result.message, false);
        fetchUsers();
    } catch (error) {
        addToLog(`Error al eliminar usuario: ${error.message}`, true);
    }
}

async function handleResetHwid(userId) {
    if (!confirm('¿Seguro que desea resetear el HWID de este usuario? Podrá iniciar sesión desde un nuevo equipo.')) return;
    try {
        const response = await authenticatedFetch(`/users/${userId}/reset-hwid`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        addToLog(result.message, false);
        fetchUsers(); // Recargar la lista para ver el cambio
    } catch (error) {
        addToLog(`Error al resetear HWID: ${error.message}`, true);
    }
}

async function openEditUserModal(id) {
    try {
        const usersResponse = await authenticatedFetch(`/users`);
        const users = await usersResponse.json();
        const user = users.find(u => u.id == id);
        if (!user) throw new Error('Usuario no encontrado');

        editUserIdInput.value = user.id;
        editUsernameInput.value = user.username;
        editPasswordInput.value = '';
        editRoleSelect.value = user.role;
        editCreditsInput.value = user.credits;

        editUserPermissionsContainer.style.display = user.role === 'seller' ? 'block' : 'none';
        await populatePermissionsCheckboxes(editUserProductList);
        if (user.role === 'seller') {
            const permsResponse = await authenticatedFetch(`/users/${id}/permissions`);
            const allowedProductIds = await permsResponse.json();
            editUserProductList.querySelectorAll('input').forEach(cb => {
                cb.checked = allowedProductIds.includes(parseInt(cb.value));
            });
        }
        editUserModal.style.display = 'flex';
    } catch (error) {
        addToLog(`Error al abrir modal: ${error.message}`, true);
    }
}

function closeEditUserModal() {
    editUserModal.style.display = 'none';
}

async function handleEditUser(e) {
    e.preventDefault();
    const id = editUserIdInput.value;
    const username = editUsernameInput.value;
    const password = editPasswordInput.value;
    const role = editRoleSelect.value;
    const credits = parseInt(editCreditsInput.value, 10);
    const allowed_products = role === 'seller' ? Array.from(editUserProductList.querySelectorAll('input:checked')).map(cb => cb.value) : [];
    if (!username || !role || isNaN(credits)) return addToLog('Campos inválidos.', true);
    
    const submitButton = editUserForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Guardando...`;
    
    try {
        const body = { username, role, credits, allowed_products };
        if (password) body.password = password;
        const response = await authenticatedFetch(`/users/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        addToLog(result.message, false);
        closeEditUserModal();
        fetchUsers();
    } catch (error) {
        addToLog(`Error al editar usuario: ${error.message}`, true);
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = `<i class="fas fa-save"></i> Guardar Cambios`;
    }
}

async function populatePermissionsCheckboxes(container) {
    try {
        const response = await authenticatedFetch(`/products`);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Error al leer la respuesta del servidor.' }));
            throw new Error(errorData.message || 'No se pudo obtener la lista de productos.');
        }
        const products = await response.json();
        if (!Array.isArray(products)) {
            throw new Error('La respuesta de productos no es válida.');
        }
        container.innerHTML = '';
        products.forEach(product => {
            container.innerHTML += `
                <div class="permission-checkbox">
                    <input type="checkbox" id="product-${product.id}-${container.id}" value="${product.id}">
                    <label for="product-${product.id}-${container.id}">${product.name}</label>
                </div>
            `;
        });
    } catch (error) {
        addToLog(`Error al poblar permisos: ${error.message}`, true);
    }
}

async function fetchAndDisplayProducts() {
    try {
        // Usar la ruta segura que devuelve todos los campos
        const response = await authenticatedFetch(`/products`); 
        if (!response.ok) throw new Error('No se pudo obtener productos.');
        const products = await response.json();
        productsTableBody.innerHTML = products.length === 0 ? '<tr><td colspan="4" style="text-align: center;">No hay productos.</td></tr>' : '';
        products.forEach(p => {
            const row = productsTableBody.insertRow();
            row.innerHTML = `
                <td>${p.id}</td>
                <td>${p.name}</td>
                <td>${p.price || 'N/A'}</td>
                <td>
                    <button class="edit-product-btn" data-id="${p.id}"><i class="fas fa-edit"></i></button>
                    <button class="delete-product-btn" data-id="${p.id}"><i class="fas fa-trash"></i></button>
                </td>
            `;
        });
        document.querySelectorAll('.edit-product-btn').forEach(b => b.addEventListener('click', e => handleEditProduct(e.currentTarget.dataset.id)));
        document.querySelectorAll('.delete-product-btn').forEach(b => b.addEventListener('click', e => handleDeleteProduct(e.currentTarget.dataset.id)));
    } catch (error) {
        addToLog(`Error al cargar productos: ${error.message}`, true);
    }
}

async function handleApprovePurchase(purchaseId) {
    if (!confirm(`¿Está seguro de que desea aprobar la compra ${purchaseId}? Se enviará la licencia al cliente.`)) return;

    try {
        const response = await authenticatedFetch(`/approve-purchase/${purchaseId}`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);

        addToLog(result.message, false);
        loadPendingPurchases(); // Recargar la lista de pendientes
        fetchLicenseCounts(); // Actualizar el stock
        fetchHistory(); // Actualizar el historial general
    } catch (error) {
        addToLog(`Error al aprobar la compra: ${error.message}`, true);
    }
}

async function handleRejectPurchase(purchaseId) {
    if (!confirm(`¿Está seguro de que desea rechazar la compra ${purchaseId}?`)) return;

    try {
        const response = await authenticatedFetch(`/reject-purchase/${purchaseId}`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);

        addToLog(result.message, false);
        loadPendingPurchases(); // Recargar la lista de pendientes
    } catch (error) {
        addToLog(`Error al rechazar la compra: ${error.message}`, true);
    }
}

async function handleAddProduct(e) {
    e.preventDefault();
    const name = document.getElementById('new-product-name').value.trim();
    const description = document.getElementById('new-product-description').value.trim();
    const price = document.getElementById('new-product-price').value.trim();
    const imageUrl = document.getElementById('new-product-image').value.trim();
    const features = document.getElementById('new-product-features').value.split('\n').filter(Boolean);

    if (!name) return addToLog('El nombre es obligatorio.', true);

    try {
        const response = await authenticatedFetch(`/api/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, price, image_url: imageUrl, features: JSON.stringify(features) }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        addToLog(`Producto "${name}" añadido.`, false);
        addProductForm.reset();
        fetchAndDisplayProducts();
        fetchProductsAndPopulateSelectors();
    } catch (error) {
        addToLog(`Error al añadir producto: ${error.message}`, true);
    }
}

async function handleEditProduct(id) {
    try {
        // Usar la nueva ruta para obtener detalles de un producto específico
        const response = await authenticatedFetch(`/api/products/${id}`);
        if (!response.ok) throw new Error('No se pudo obtener los detalles del producto.');
        
        const product = await response.json();

        document.getElementById('edit-product-id').value = product.id;
        document.getElementById('edit-product-name').value = product.name;
        document.getElementById('edit-product-description').value = product.description || '';
        document.getElementById('edit-product-price').value = product.price || '';
        document.getElementById('edit-product-image').value = product.image_url || '';
        
        // Asegurarse de que 'features' se parsea correctamente, incluso si es null o un string vacío
        let featuresArray = [];
        try {
            if (product.features && typeof product.features === 'string') {
                featuresArray = JSON.parse(product.features);
            }
        } catch (e) {
            console.error("Error al parsear features:", e);
            featuresArray = []; // Dejarlo como array vacío si hay error
        }
        document.getElementById('edit-product-features').value = Array.isArray(featuresArray) ? featuresArray.join('\n') : '';

        editProductModal.style.display = 'flex';
    } catch (error) {
        addToLog(`Error al abrir editor de producto: ${error.message}`, true);
    }
}

async function handleUpdateProductForm(e) {
    e.preventDefault();
    const id = document.getElementById('edit-product-id').value;
    const name = document.getElementById('edit-product-name').value.trim();
    const description = document.getElementById('edit-product-description').value.trim();
    const price = document.getElementById('edit-product-price').value.trim();
    const imageUrl = document.getElementById('edit-product-image').value.trim();
    const features = document.getElementById('edit-product-features').value.split('\n').filter(Boolean);

    if (!name) return addToLog('El nombre es obligatorio.', true);

    await updateProductRequest(id, name, description, price, imageUrl, features);
}

async function updateProductRequest(id, name, description, price, imageUrl, features) {
    try {
        const response = await authenticatedFetch(`/api/products/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, price, image_url: imageUrl, features: JSON.stringify(features) }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        addToLog(`Producto actualizado a "${name}".`, false);
        editProductModal.style.display = 'none';
        fetchAndDisplayProducts();
        fetchProductsAndPopulateSelectors();
    } catch (error) {
        addToLog(`Error al actualizar producto: ${error.message}`, true);
    }
}

async function handleDeleteProduct(id) {
    if (!confirm('¿Seguro que quieres eliminar este producto?')) return;
    try {
        const response = await authenticatedFetch(`/api/products/${id}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        addToLog(result.message, false);
        fetchAndDisplayProducts();
        fetchProductsAndPopulateSelectors();
    } catch (error) {
        addToLog(`Error al eliminar producto: ${error.message}`, true);
    }
}

function loadInitialAdminData() {
    fetchHistory();
    fetchUsers();
    fetchAndDisplayProducts();
    populatePermissionsCheckboxes(newUserProductList);
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    const storedToken = localStorage.getItem('jwtToken');
    if (storedToken) {
        passwordPrompt.style.display = 'none';
        mainContent.style.display = 'flex';
        addToLog('Sesión reanudada.');
        
        (async () => {
            await fetchProductsAndPopulateSelectors();
            fetchLicenseCounts();
            if (localStorage.getItem('userRole') === 'admin') {
                loadInitialAdminData();
            }
            setupDashboardForRole(localStorage.getItem('userRole'));
            handleTabChange({ currentTarget: document.querySelector('[data-tab="dashboard"]') });
        })();
    }

    loginBtn.addEventListener('click', checkPassword);
    passwordInput.addEventListener('keyup', e => e.key === 'Enter' && checkPassword());
    logoutBtn.addEventListener('click', handleLogout);
    form.addEventListener('submit', handleSendLicenses);
    addProductBtn.addEventListener('click', createProductSelector);
    addStockForm.addEventListener('submit', handleAddStock);
    navLinks.forEach(link => link.addEventListener('click', handleTabChange));
    addUserForm.addEventListener('submit', handleAddUser);
    addProductForm.addEventListener('submit', handleAddProduct);
    newRoleSelect.addEventListener('change', e => {
        newUserPermissionsContainer.style.display = e.target.value === 'seller' ? 'block' : 'none';
    });
    editRoleSelect.addEventListener('change', e => {
        editUserPermissionsContainer.style.display = e.target.value === 'seller' ? 'block' : 'none';
    });
    closeEditModalBtn.addEventListener('click', closeEditUserModal);
    window.addEventListener('click', e => {
        if (e.target === editUserModal) closeEditUserModal();
        if (e.target === editProductModal) editProductModal.style.display = 'none';
    });
    editUserForm.addEventListener('submit', handleEditUser);
    editProductForm.addEventListener('submit', handleUpdateProductForm);
    closeEditProductModalBtn.addEventListener('click', () => editProductModal.style.display = 'none');
});
