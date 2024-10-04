document.addEventListener('DOMContentLoaded', function () {
    let products = []; // Lista de productos cargados desde el CSV
    let scannedUnits = {}; // Unidades escaneadas por cada producto
    let globalUnitsScanned = 0; // Contador global de unidades escaneadas
    let totalUnits = 0; // Cantidad total de unidades esperadas
    let html5QrCode; // Objeto para manejar el escáner
    let audioContext; // Contexto de audio para generar tonos
    let scanLock = false; // Variable para bloquear el escaneo temporalmente

    // Inicializar contexto de audio para generar tonos
    function initializeAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // Generar un tono con Web Audio API
    function playTone(frequency, duration, type = 'sine', volume = 1.5) {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
        gainNode.gain.value = volume;
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start();
        setTimeout(() => {
            oscillator.stop();
        }, duration);
    }

    // Habilitar contexto de audio al hacer clic en el primer evento (para dispositivos móviles)
    document.body.addEventListener('click', initializeAudioContext, { once: true });

    // Cargar archivo CSV y extraer productos
    document.getElementById('load-csv').addEventListener('click', () => {
        const fileInput = document.getElementById('csvFileInput');
        const file = fileInput.files[0];

        if (file) {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: function (results) {
                    products = results.data.map(item => ({
                        codigo_barra: item['codigo_barra'].trim(),
                        cantidad: parseInt(item['cantidad'].trim()),
                        ciudad: item['ciudad'].trim(),
                        codigos_validos: [
                            item['codigo_barra'].trim(),
                            ...item['codigos_adicionales'] ? item['codigos_adicionales'].split(',').map(code => code.trim()) : []
                        ].filter(code => code.length > 0), // Agregar los códigos adicionales si existen
                        scannedSubcodes: [], // Almacenar los subcódigos escaneados para cada producto
                        noSufijoCount: 0 // Contador de escaneos sin sufijos
                    }));

                    scannedUnits = {};
                    globalUnitsScanned = 0;
                    totalUnits = products.reduce((acc, product) => acc + product.cantidad, 0);
                    products.forEach(product => {
                        scannedUnits[product.codigo_barra] = 0;
                    });

                    updateScannedList();
                    updateGlobalCounter();

                    // Deshabilitar el botón de carga del CSV y cambiar su estilo
                    document.getElementById('load-csv').disabled = true;
                    document.getElementById('load-csv').style.backgroundColor = '#cccccc';
                    document.getElementById('load-csv').style.cursor = 'not-allowed';
                },
                error: function (error) {
                    alert("Error al leer el archivo CSV: " + error.message);
                }
            });
        } else {
            alert("Por favor, selecciona un archivo CSV.");
        }
    });

    // Mostrar la cámara y el cuadro de enfoque dinámico
    document.getElementById('btn-abrir-camara').addEventListener('click', function () {
        initializeAudioContext();
        const scannerContainer = document.getElementById('scanner-container');
        const mainContent = document.getElementById('main-content');

        scannerContainer.style.display = 'block';
        mainContent.style.display = 'none';

        try {
            // Inicializar el objeto Html5Qrcode
            html5QrCode = new Html5Qrcode("scanner-video");

            const config = {
                fps: 10, // Reducir el FPS para minimizar repeticiones
                qrbox: { width: 250, height: 250 },
                disableFlip: true
            };

            html5QrCode.start(
                { facingMode: "environment" },
                config,
                (decodedText) => {
                    if (!scanLock) {
                        handleBarcodeScan(decodedText);
                        scanLock = true;
                        setTimeout(() => { scanLock = false; }, 3000);
                    }
                },
                (errorMessage) => console.log(`Error de escaneo: ${errorMessage}`)
            ).then(() => {
                console.log("Cámara iniciada correctamente.");
            }).catch((err) => {
                console.error("Error al iniciar la cámara:", err);
                alert("Error al iniciar la cámara. Asegúrate de permitir el acceso.");
            });
        } catch (e) {
            console.error("Error al crear Html5Qrcode:", e);
        }
    });

    // Detener la cámara y ocultar el cuadro de enfoque dinámico
    document.getElementById('close-scanner').addEventListener('click', function () {
        const scannerContainer = document.getElementById('scanner-container');
        const mainContent = document.getElementById('main-content');

        if (html5QrCode) {
            html5QrCode.stop().then(() => {
                scannerContainer.style.display = 'none';
                mainContent.style.display = 'block';
            }).catch(err => console.error("Error al detener la cámara:", err));
        }
    });

    // Manejar la tecla "Enter" en el campo de entrada de código de barras
    document.getElementById('barcodeInput').addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Evitar el comportamiento por defecto
            const barcodeValue = document.getElementById('barcodeInput').value.trim();
            handleBarcodeScan(barcodeValue);
        }
    });

    // Mostrar modal para finalizar la descarga
    document.getElementById('finalizar-descarga').addEventListener('click', () => {
        const modal = document.getElementById('modal');
        modal.style.display = 'flex';
        document.getElementById('fecha').value = new Date().toLocaleDateString();
    });

    // Cerrar el modal de información de la descarga
    document.getElementById('cerrar-modal').addEventListener('click', () => {
        document.getElementById('modal').style.display = 'none';
    });

    // Generar reporte en Excel con sufijos escaneados y faltantes solo si faltan
    document.getElementById('generar-reporte').addEventListener('click', () => {
        const placa = document.getElementById('placa').value;
        const remitente = document.getElementById('remitente').value;
        const fecha = document.getElementById('fecha').value;

        if (!placa || !remitente) {
            alert("Por favor, completa todos los campos.");
            return;
        }

        const reportData = [
            ['Placa de Vehículo', placa],
            ['Remitente', remitente],
            ['Fecha de Descargue', fecha],
            [],
            ['Código de Barra', 'Unidades Escaneadas (Escaneadas/Total)', 'Ciudad', 'Sufijos Escaneados', 'Sufijos Faltantes']
        ];

        products.forEach(product => {
            const unidadesEscaneadas = scannedUnits[product.codigo_barra] || 0;
            const sufijosFaltantes = getMissingSubcodes(product);

            reportData.push([
                product.codigo_barra,
                `${unidadesEscaneadas} / ${product.cantidad}`, // Mostrar el formato "X / Y"
                product.ciudad,
                product.scannedSubcodes.length > 0 ? product.scannedSubcodes.join(', ') : 'Ninguno',
                sufijosFaltantes.length > 0 ? sufijosFaltantes.join(', ') : '' // Mostrar solo si faltan
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(reportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Reporte Descargue');
        XLSX.writeFile(wb, `reporte_descargue_${new Date().toISOString().slice(0, 10)}.xlsx`);

        alert('Reporte generado correctamente.');
        document.getElementById('modal').style.display = 'none';
    });

    // Obtener subcódigos faltantes para un producto dado
    function getMissingSubcodes(product) {
        if (scannedUnits[product.codigo_barra] === product.cantidad) {
            return []; // Si el número de unidades escaneadas coincide con la cantidad total, no hay faltantes
        }
        const expectedSubcodes = Array.from({ length: product.cantidad }, (_, i) => (i + 1).toString());
        return expectedSubcodes.filter(subCode => !product.scannedSubcodes.includes(subCode));
    }

    // Función para manejar el escaneo de códigos
    function handleBarcodeScan(scannedCode) {
        const parts = scannedCode.split('-');
        const sanitizedCode = parts[0].trim(); // Parte principal del código
        const subCode = parts[1] || ''; // Obtener el subcódigo si existe

        const product = products.find(p => p.codigos_validos.includes(sanitizedCode));

        if (product) {
            const currentScanned = scannedUnits[product.codigo_barra] || 0;
            if (currentScanned >= product.cantidad) {
                alert(`El producto ${sanitizedCode} ya ha alcanzado la cantidad total (${product.cantidad}) de unidades escaneadas.`);
                playTone(220, 500, 'square');
                clearBarcodeInput();
                return;
            }

            // Validación con subcódigos
            if (subCode === '' || product.cantidad === 1) {
                if (product.noSufijoCount < product.cantidad) {
                    product.noSufijoCount += 1;
                    scannedUnits[product.codigo_barra] += 1;
                    globalUnitsScanned += 1;
                    playTone(440, 200, 'sine'); // Tono de éxito
                } else {
                    alert(`El código ${sanitizedCode} ya ha sido escaneado todas las veces requeridas (${product.cantidad}).`);
                    playTone(220, 500, 'square');
                }
            } else {
                if (!product.scannedSubcodes.includes(subCode)) {
                    product.scannedSubcodes.push(subCode);
                    scannedUnits[product.codigo_barra] += 1;
                    globalUnitsScanned += 1;
                    playTone(440, 200, 'sine');
                } else {
                    alert(`El subcódigo -${subCode} de ${sanitizedCode} ya ha sido escaneado.`);
                    playTone(220, 500, 'square');
                }
            }
            updateScannedList(product.codigo_barra);
            updateGlobalCounter();
        } else {
            playTone(220, 500, 'square');
            alert("El código escaneado no coincide con ningún producto.");
        }
        clearBarcodeInput();
    }

    // Mostrar resultado temporalmente (verde para éxito, rojo para error)
    function showTemporaryResult(isSuccess) {
        const scanResultContainer = document.getElementById('scan-result');
        const resultIcon = document.getElementById('result-icon');

        if (isSuccess) {
            resultIcon.innerHTML = '&#10004;'; // Checkmark (✓)
            scanResultContainer.style.backgroundColor = 'rgba(0, 255, 0, 0.8)'; // Fondo verde
        } else {
            resultIcon.innerHTML = '&#10006;'; // Crossmark (✖)
            scanResultContainer.style.backgroundColor = 'rgba(255, 0, 0, 0.8)'; // Fondo rojo
        }

        // Mostrar el resultado temporalmente
        scanResultContainer.classList.add('show-result');
        setTimeout(() => {
            scanResultContainer.classList.remove('show-result');
        }, 2000); // Mostrar durante 3 segundos
    }

    // Funciones de visualización de lista y progreso
    function updateScannedList(scannedCode = '') {
        const scannedList = document.getElementById('scanned-list');
        scannedList.innerHTML = '';

        const sortedProducts = products.slice().sort((a, b) => {
            if (a.codigo_barra === scannedCode) return -1;
            if (b.codigo_barra === scannedCode) return 1;
            return 0;
        });

        sortedProducts.forEach(product => {
            const totalScanned = scannedUnits[product.codigo_barra] || 0;
            const progressWidth = (totalScanned / product.cantidad) * 100;
            let statusClass = '';

            if (totalScanned === product.cantidad) {
                statusClass = 'status-complete';
            } else if (totalScanned > 0) {
                statusClass = 'status-warning';
            } else {
                statusClass = 'status-incomplete';
            }

            const additionalCodes = product.codigos_validos.join(', ');

            const li = document.createElement('li');
            li.className = statusClass;
            li.innerHTML = `
                
                <span><strong>Códigos Adicionales:</strong> ${additionalCodes}</span><br>                
                <span class="city"><strong>Ciudad:</strong> ${product.ciudad}</span>
                <div class="progress-bar">
                    <div class="progress-bar-inner" style="width: ${progressWidth}%"></div>
                </div>
                <span class="progress-text">${totalScanned} de ${product.cantidad} unidades escaneadas</span>
            `;
            scannedList.appendChild(li);
        });
    }

    // Actualizar el contador global
    function updateGlobalCounter() {
        const globalCounter = document.getElementById('global-counter');
        globalCounter.innerText = `Unidades descargadas: ${globalUnitsScanned} de ${totalUnits}`;
    }

    // Limpiar el campo de código de barras
    function clearBarcodeInput() {
        document.getElementById('barcodeInput').value = '';
    }

});