let revealObserver;

// --- Cargar Productos Dinámicamente ---
async function loadProducts() {
    const container = document.getElementById('product-list-container');
    if (!container) return;

    try {
        const response = await fetch('/api/public-products');
        if (!response.ok) throw new Error('No se pudieron cargar los productos.');
        
        const products = await response.json();
        
        if (products.length === 0) {
            container.innerHTML = '<p style="text-align:center; color: #ccc;">No hay productos disponibles en este momento.</p>';
            return;
        }

        container.innerHTML = ''; // Limpiar el contenedor
        products.forEach(product => {
            const features = JSON.parse(product.features || '[]');
            const productCard = document.createElement('div');
            productCard.className = 'product-card reveal';
            productCard.innerHTML = `
                <img src="${product.image_url || 'https://via.placeholder.com/300x200.png?text=Producto'}" alt="${product.name}" class="product-image">
                <div class="product-content">
                    <h3>${product.name}</h3>
                    <p>${product.description || 'Descripción no disponible.'}</p>
                    <div class="price">${product.price || 'Consultar'}</div>
                    <div class="product-details">
                        <ul>
                            ${features.map(f => `<li>${f}</li>`).join('')}
                        </ul>
                    </div>
                    <button class="btn" onclick="openBuyModal('${product.name}')">Adquirir</button>
                </div>
            `;
            container.appendChild(productCard);
            // Observe the new card for reveal animation
            if (revealObserver) {
                revealObserver.observe(productCard);
            }
        });

    } catch (error) {
        console.error('Error al cargar productos:', error);
        container.innerHTML = '<p style="text-align:center; color: #ff6b6b;">Error al cargar los productos. Intente de nuevo más tarde.</p>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // --- Preloader ---
    const preloader = document.getElementById('preloader');
    window.addEventListener('load', () => {
        preloader.classList.add('hidden');
    });

    // --- Mobile Menu ---
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const navLinks = document.getElementById('nav-links');
    mobileMenuBtn.addEventListener('click', () => {
        navLinks.classList.toggle('active');
    });

    // --- Active Nav Link on Scroll ---
    const sections = document.querySelectorAll('section[id]');
    const navLi = document.querySelectorAll('nav .nav-links li a');
    
    window.addEventListener('scroll', () => {
        let current = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            if (pageYOffset >= sectionTop - 70) {
                current = section.getAttribute('id');
            }
        });

        navLi.forEach(a => {
            a.classList.remove('active');
            if (a.getAttribute('href').includes(current)) {
                a.classList.add('active');
            }
        });
    });

    // --- Back to Top Button ---
    const backToTopButton = document.getElementById('back-to-top');
    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 300) {
            backToTopButton.classList.add('show');
        } else {
            backToTopButton.classList.remove('show');
        }
    });
    backToTopButton.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // --- Scroll Reveal Animations ---
    revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.reveal').forEach(el => {
        revealObserver.observe(el);
    });

    loadProducts();

    // --- Buy Modal Logic ---
    const buyModal = document.getElementById('buy-modal');
    const buyForm = document.getElementById('buy-form');
    const mensajeFinal = document.getElementById('mensaje-final');
    const instruccionesPago = document.getElementById('instrucciones-pago');

    window.openBuyModal = (producto) => {
        buyModal.style.display = 'flex';
        document.getElementById('producto').value = producto || '';
    };

    window.closeBuyModal = () => {
        buyModal.style.display = 'none';
        buyForm.reset();
        mensajeFinal.style.display = 'none';
        instruccionesPago.innerHTML = '';
    };

    window.onclick = (event) => {
        if (event.target === buyModal) {
            closeBuyModal();
        }
    };

    buyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitButton = buyForm.querySelector('button[type="submit"]');
        const formData = new FormData(buyForm);

        formData.set('producto', document.getElementById('producto').value);
        formData.set('metodo', document.getElementById('payment-method').value);
        formData.set('correo', document.getElementById('email').value);
        formData.set('comprobante', document.getElementById('comprobante').files[0]);

        try {
            submitButton.disabled = true;
            submitButton.textContent = 'Enviando...';

            const response = await fetch('/submit-purchase', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || 'Error en el servidor');
            }

            mensajeFinal.style.display = 'block';
            setTimeout(() => {
                closeBuyModal();
            }, 4000);

        } catch (err) {
            alert(`Error al enviar el comprobante: ${err.message}`);
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Enviar Comprobante';
        }
    });

    window.mostrarInstruccionesPago = () => {
        const metodo = document.getElementById('payment-method').value;
        let html = '';
        switch (metodo) {
            case "yape":
                html = `
                    <div style="text-align:center;">
                        <b>Escanea para pagar con Yape:</b><br>
                        <img src="https://files.catbox.moe/e8r8mc.png" alt="QR Yape" style="width:150px; margin:10px auto; display:block; border-radius:8px;">
                        <p style="font-size:0.9rem;">Titular: Mario<br>Celular: 999 888 777</p>
                    </div>`;
                break;
            case "paypal":
                html = `
                    <div style="text-align:center;">
                        <b>Pagar a la siguiente cuenta de PayPal:</b><br>
                        <p style="font-size:1.1rem; color:var(--accent-primary); margin-top: 5px;">pagos@deathx.com</p>
                        <p style="font-size:0.8rem;">(Enviar como amigos y familiares)</p>
                    </div>`;
                break;
            case "banco":
                html = `
                    <div style="text-align:center;">
                        <b>Datos para transferencia bancaria:</b><br>
                        <p style="font-size:1.1rem; color:var(--accent-primary); margin-top: 5px;">123-45678901-23</p>
                        <p style="font-size:0.9rem;">Banco: Banco Digital<br>Titular: Mario</p>
                    </div>`;
                break;
        }
        instruccionesPago.innerHTML = html;
    };

    // --- Login Modal Logic ---
    const loginModal = document.getElementById('login-modal');
    const loginBtn = document.getElementById('login-btn');
    const closeLoginModalBtn = document.getElementById('close-login-modal');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');

    const openLoginModal = () => {
        loginModal.style.display = 'flex';
    };

    const closeLoginModal = () => {
        loginModal.style.display = 'none';
        loginError.style.display = 'none';
        loginForm.reset();
    };

    loginBtn.addEventListener('click', openLoginModal);
    closeLoginModalBtn.addEventListener('click', closeLoginModal);

    // Generar un identificador de navegador como HWID
    const getBrowserFingerprint = () => {
        const props = [
            navigator.userAgent,
            navigator.language,
            screen.width,
            screen.height,
            screen.colorDepth,
            new Date().getTimezoneOffset()
        ];
        const propsString = props.join('');
        
        let hash = 0;
        for (let i = 0; i < propsString.length; i++) {
            const char = propsString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32bit integer
        }
        return 'web-' + Math.abs(hash).toString(16);
    };

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = loginForm.username.value;
        const password = loginForm.password.value;
        const hwid = getBrowserFingerprint();

        try {
            const response = await fetch('/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password, hwid })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Error en el servidor');
            }

            if (result.role === 'admin' || result.role === 'seller') {
                window.location.href = '/admin/admin.html';
            } else {
                closeLoginModal();
            }

        } catch (err) {
            loginError.textContent = err.message;
            loginError.style.display = 'block';
        }
    });
});
