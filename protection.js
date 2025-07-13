(function() {
    // Deshabilitar clic derecho
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    });

    // Deshabilitar atajos de teclado comunes para herramientas de desarrollador
    document.addEventListener('keydown', function(e) {
        if (
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
            (e.ctrlKey && e.key === 'U') ||
            e.key === 'F12'
        ) {
            e.preventDefault();
        }
    });

    // Detección de herramientas de desarrollador
    const devtools = {
        open: false,
        orientation: null
    };

    const threshold = 160;

    const emitEvent = (isOpen, orientation) => {
        window.dispatchEvent(new CustomEvent('devtoolschange', {
            detail: {
                isOpen,
                orientation
            }
        }));
    };

    setInterval(() => {
        const widthThreshold = window.outerWidth - window.innerWidth > threshold;
        const heightThreshold = window.outerHeight - window.innerHeight > threshold;
        const orientation = widthThreshold ? 'vertical' : 'horizontal';

        if (
            !(heightThreshold && widthThreshold) &&
            ((window.Firebug && window.Firebug.chrome && window.Firebug.chrome.isInitialized) || widthThreshold || heightThreshold)
        ) {
            if (!devtools.open || devtools.orientation !== orientation) {
                emitEvent(true, orientation);
            }
            devtools.open = true;
            devtools.orientation = orientation;
        } else {
            if (devtools.open) {
                emitEvent(false, null);
            }
            devtools.open = false;
            devtools.orientation = null;
        }
    }, 500);

    window.addEventListener('devtoolschange', event => {
        if (event.detail.isOpen) {
            // Bucle infinito para colgar el depurador
            (function() {
                while (true) {
                    debugger;
                }
            })();
        }
    });
})();
