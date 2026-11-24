// =========================================================================
// ESTADO GLOBAL DE LA APLICACIÓN (OPTICOST ERP)
// =========================================================================
const state = {
    user: null,
    products: [],
    customProducts: [], // Productos terminados adicionales registrados en Firebase
    workers: [],
    processes: [],
    movements: {},
    historicalMonthly: [], // Base de datos histórica propia en Firebase (historico_mensual)
    savedBudgets: [],
    globalMethod: 'PEPS',
    isProcesosLocked: true,
    isHistoricoLocked: true,
    ultimoCosteoUnitario: {
        lente: { mp: 0, mo: 0, gif: 0, total: 0, nombre: 'Lente Terminado Graduado (CR-39)' },
        armazon: { mp: 0, mo: 0, gif: 0, total: 0, nombre: 'Armazón de Acetato Inyectado' },
        kit: { mp: 0, mo: 0, gif: 0, total: 0, nombre: 'Kit de Limpieza y Mantenimiento' }
    },
    prorrateoResultados: {
        gifTotalProduccion: 0,
        cuotaPorUnidad: 0,
        cuotaPorHora: 0,
        gastosAdminTotal: 0,
        gastosVentaTotal: 0,
        gastosDistrTotal: 0
    },
    sessionId: `Sesión del ${new Date().toLocaleDateString('es-MX')} - ${new Date().toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit'})}`
};

// =========================================================================
// UTILIDADES DE INTERFAZ (NOTIFICACIONES TOAST Y FORMATO MONEDA)
// =========================================================================
window.showToast = function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const colors = {
        success: 'bg-emerald-900 border-emerald-500 text-white',
        error: 'bg-red-900 border-red-500 text-white',
        info: 'bg-blue-950 border-blue-400 text-white'
    };

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto px-4 py-3 rounded-xl border-l-4 shadow-xl text-xs font-bold flex items-center gap-2 transition-all duration-300 ${colors[type] || colors.info}`;
    toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️'}</span><span>${message}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-x-4');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
};

function formatMXN(valor) {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(valor || 0);
}

// =========================================================================
// INICIALIZACIÓN Y EVENTOS PRINCIPALES
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. LOGIN
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const user = document.getElementById('username').value;
            const pass = document.getElementById('password').value;

            if (user === 'admin' && pass === '1234') {
                state.user = user;
                document.getElementById('login-screen').classList.add('hidden');
                document.getElementById('app-screen').classList.remove('hidden');

                showToast('Cargando datos de planta desde Firebase...', 'info');
                await loadConfigFromFirebase();
                await loadProrrateoFromFirebase();
                await loadCustomProductsFromFirebase();
                await loadProductsFromFirebase();
                await loadWorkersFromFirebase();
                await loadProcessesFromFirebase();
                await loadHistoricalMonthlyFromFirebase();
                await loadBudgetsFromFirebase();

                calcularYRenderizarProrrateos();
                actualizarCedulaProducto();
                aplicarCicloOpticoSeleccionado(true);
            } else {
                document.getElementById('login-error').classList.remove('hidden');
            }
        });
    }

    document.getElementById('logout-btn')?.addEventListener('click', () => location.reload());

    // 2. GUARDAR CONFIGURACIÓN GLOBAL EN FIREBASE
    document.getElementById('config-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        state.globalMethod = document.getElementById('cfg-metodo-global').value;
        const badge = document.getElementById('active-method-badge');
        if (badge) badge.innerText = `Método: ${state.globalMethod}`;

        try {
            await window.fs.setDoc(window.fs.doc(window.db, "configuracion", "global"), {
                globalMethod: state.globalMethod,
                updatedAt: new Date()
            });
            renderAllCards();
            actualizarCedulaProducto();
            recalcularPresupuestoUI();
            showToast(`Método ${state.globalMethod} guardado en Firebase.`);
        } catch (error) {
            console.error("Error al guardar configuración:", error);
            showToast("Error al guardar configuración en Firebase.", "error");
        }
    });

    // 3. OCULTAR COSTO EN SALIDAS DE ALMACÉN
    const movTypeSelect = document.getElementById('mov-type');
    const costContainer = document.getElementById('cost-container');
    movTypeSelect?.addEventListener('change', (e) => {
        if (e.target.value === 'SALIDA') {
            costContainer?.classList.add('opacity-40', 'pointer-events-none');
            document.getElementById('mov-cost')?.removeAttribute('required');
        } else {
            costContainer?.classList.remove('opacity-40', 'pointer-events-none');
            document.getElementById('mov-cost')?.setAttribute('required', 'true');
        }
    });

    // 4. REGISTRO DE INSUMOS DE ALMACÉN
    document.getElementById('product-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newProduct = {
            name: document.getElementById('prod-name').value.trim(),
            unit: document.getElementById('prod-unit').value.trim(),
            createdAt: new Date()
        };

        try {
            const docRef = await window.fs.addDoc(window.fs.collection(window.db, "productos"), newProduct);
            state.products.push({ id: docRef.id, ...newProduct });
            state.movements[docRef.id] = [];

            document.getElementById('product-form').reset();
            updateProductDropdowns();
            renderAllCards();
            actualizarCedulaProducto();
            showToast(`Insumo "${newProduct.name}" registrado.`);
        } catch (error) {
            console.error("Error al guardar producto:", error);
            showToast("No se pudo registrar el insumo.", "error");
        }
    });

    // 5. REGISTRO DE MOVIMIENTOS KARDEX
    document.getElementById('movement-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const prodId = document.getElementById('mov-product').value;
        if (!prodId) return showToast("Selecciona un insumo primero.", "error");

        const movement = {
            productId: prodId,
            fecha: document.getElementById('mov-date').value,
            ref: document.getElementById('mov-ref').value,
            concepto: document.getElementById('mov-concept').value,
            tipo: document.getElementById('mov-type').value,
            cantidad: parseFloat(document.getElementById('mov-qty').value),
            costoUnitario: parseFloat(document.getElementById('mov-cost').value || 0),
            createdAt: new Date()
        };

        try {
            await window.fs.addDoc(window.fs.collection(window.db, "movimientos"), movement);
            document.getElementById('movement-form').reset();
            await loadMovementsFromFirebase(prodId);
            renderAllCards();
            actualizarCedulaProducto();
            recalcularPresupuestoUI();
            showToast(`Movimiento de ${movement.tipo} aplicado al Kardex.`);
        } catch (error) {
            console.error("Error al guardar movimiento:", error);
            showToast("Error al guardar movimiento.", "error");
        }
    });

    // 6. REGISTRO DE PROCESOS EN RUTA
    document.getElementById('process-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (state.isProcesosLocked) {
            return showToast("Desbloquea la configuración de procesos para agregar estaciones.", "info");
        }

        const productKey = document.getElementById('proc-product-key').value;
        const name = document.getElementById('proc-name').value.trim();
        const machine = document.getElementById('proc-machine').value.trim();
        const machineCost = parseFloat(document.getElementById('proc-machine-cost').value) || 0;
        const time = parseFloat(document.getElementById('proc-time').value);

        const newProc = { productKey, name, machine, machineCost, time, assignedWorkerId: null, createdAt: new Date() };

        try {
            const docRef = await window.fs.addDoc(window.fs.collection(window.db, "procesos"), newProc);
            state.processes.push({ id: docRef.id, ...newProc });
            document.getElementById('process-form').reset();
            renderProcesosModule();
            actualizarCedulaProducto();
            recalcularPresupuestoUI();
            showToast(`Estación "${name}" agregada a la ruta.`);
        } catch (error) {
            console.error("Error al guardar proceso:", error);
            showToast("Error al guardar estación.", "error");
        }
    });

    // 7. REGISTRO DINÁMICO DE NUEVOS PRODUCTOS TERMINADOS
    document.getElementById('custom-product-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('cprod-name').value.trim();
        const mp1 = document.getElementById('cprod-mp1').value.trim();
        const mp1Cost = parseFloat(document.getElementById('cprod-mp1-cost').value) || 0;
        const mp2 = document.getElementById('cprod-mp2').value.trim();
        const mp2Cost = parseFloat(document.getElementById('cprod-mp2-cost').value) || 0;

        const key = 'prod_' + Date.now();
        const newCustomProd = {
            key,
            name,
            receta: [
                { nombre: mp1, tipo: "MPD", cantidadTexto: "1 Unidad", factor: 1.0, defaultVal: mp1Cost },
                { nombre: mp2, tipo: "MPI", cantidadTexto: "1 Juego", factor: 1.0, defaultVal: mp2Cost }
            ],
            createdAt: new Date()
        };

        try {
            const docRef = await window.fs.addDoc(window.fs.collection(window.db, "productos_terminados"), newCustomProd);
            state.customProducts.push({ id: docRef.id, ...newCustomProd });
            syncCustomProductsDropdowns();
            document.getElementById('custom-product-form').reset();
            document.getElementById('form-nuevo-producto-panel').classList.add('hidden');
            showToast(`Producto "${name}" agregado al catálogo.`);
        } catch (error) {
            console.error("Error al guardar producto terminado:", error);
            showToast("Error al guardar el nuevo producto.", "error");
        }
    });

    // 8. REGISTRO / ACTUALIZACIÓN DE MES EN BASE HISTÓRICA PROPIA (FIREBASE)
    document.getElementById('historico-mensual-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (state.isHistoricoLocked) {
            return showToast("La Base Histórica está bloqueada (Período Cerrado). Desbloquéala para modificar.", "info");
        }
        const mes = document.getElementById('hist-mes').value;
        const anio = parseInt(document.getElementById('hist-anio').value) || 2025;
        const gif = parseFloat(document.getElementById('hist-gif').value) || 0;
        const mo = parseFloat(document.getElementById('hist-mo').value) || 0;
        const admon = parseFloat(document.getElementById('hist-admon').value) || 0;
        const venta = parseFloat(document.getElementById('hist-venta').value) || 0;
        const distrib = parseFloat(document.getElementById('hist-distrib').value) || 0;

        const metaMeses = {
            ENERO: { orden: 1, trimestre: 'Q1' }, FEBRERO: { orden: 2, trimestre: 'Q1' }, MARZO: { orden: 3, trimestre: 'Q1' },
            ABRIL: { orden: 4, trimestre: 'Q2' }, MAYO: { orden: 5, trimestre: 'Q2' }, JUNIO: { orden: 6, trimestre: 'Q2' },
            JULIO: { orden: 7, trimestre: 'Q3' }, AGOSTO: { orden: 8, trimestre: 'Q3' }, SEPTIEMBRE: { orden: 9, trimestre: 'Q3' },
            OCTUBRE: { orden: 10, trimestre: 'Q4' }, NOVIEMBRE: { orden: 11, trimestre: 'Q4' }, DICIEMBRE: { orden: 12, trimestre: 'Q4' }
        };

        const info = metaMeses[mes] || { orden: 1, trimestre: 'Q1' };
        const docId = `${anio}_${mes}`;
        const payload = {
            mes,
            anio,
            orden: info.orden,
            trimestre: info.trimestre,
            gif,
            mo,
            admon,
            venta,
            distrib,
            updatedAt: new Date()
        };

        try {
            await window.fs.setDoc(window.fs.doc(window.db, "historico_mensual", docId), payload);
            await loadHistoricalMonthlyFromFirebase();
            aplicarCicloOpticoSeleccionado(true);
            showToast(`Mes ${mes} ${anio} guardado en tu Base Histórica.`);
        } catch (error) {
            console.error("Error al guardar histórico mensual:", error);
            showToast("Error al guardar registro histórico en Firebase.", "error");
        }
    });
});

// =========================================================================
// NAVEGACIÓN SECUENCIAL ENTRE MÓDULOS
// =========================================================================
window.switchModule = function(moduleName) {
    ['config', 'mp', 'mo', 'procesos', 'prorrateo', 'reportes', 'presupuesto'].forEach(m => {
        const mod = document.getElementById(`module-${m}`);
        if (mod) mod.classList.add('hidden');

        const btn = document.getElementById(`nav-${m}`);
        if (btn && m !== 'config') {
            btn.className = "px-2.5 py-1.5 text-xs font-bold rounded-lg transition text-blue-200 hover:text-white";
        }
    });

    const activeMod = document.getElementById(`module-${moduleName}`);
    if (activeMod) activeMod.classList.remove('hidden');

    const activeBtn = document.getElementById(`nav-${moduleName}`);
    if (activeBtn && moduleName !== 'config') {
        activeBtn.className = "px-2.5 py-1.5 text-xs font-bold rounded-lg transition bg-blue-700 text-white shadow-sm";
    }

    if (moduleName === 'procesos') renderProcesosModule();
    if (moduleName === 'prorrateo') calcularYRenderizarProrrateos();
    if (moduleName === 'reportes') actualizarCedulaProducto();
    if (moduleName === 'presupuesto') {
        actualizarCedulaProducto();
        aplicarCicloOpticoSeleccionado(true);
    }
};

// =========================================================================
// MÓDULO 3: RUTAS DE PRODUCCIÓN Y OPERADORES
// =========================================================================
window.toggleLockProcesos = function() {
    state.isProcesosLocked = !state.isProcesosLocked;
    renderProcesosModule();
};

function renderProcesosModule() {
    const container = document.getElementById('procesos-list-container');
    const btnLock = document.getElementById('btn-toggle-lock-procesos');
    const procFormInputs = document.querySelectorAll('#process-form input, #process-form select, #process-form button');
    const filterKey = document.getElementById('filter-ruta-product')?.value || 'lente';

    if (btnLock) {
        btnLock.innerText = state.isProcesosLocked ? "🔓 Desbloquear Configuración" : "🔒 Guardar y Bloquear";
        btnLock.className = state.isProcesosLocked ? 
            "px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg transition" : 
            "px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-lg transition";
    }

    procFormInputs.forEach(el => {
        if (state.isProcesosLocked) el.setAttribute('disabled', 'true');
        else el.removeAttribute('disabled');
    });

    if (!container) return;

    const filteredProcs = state.processes.filter(p => (p.productKey || 'lente') === filterKey);

    if (filteredProcs.length === 0) {
        container.innerHTML = `<p class="col-span-2 text-center text-slate-400 p-4 border border-dashed rounded-lg">No hay estaciones registradas para este producto. Desbloquea la configuración para agregar procesos.</p>`;
        return;
    }

    let htmlOperadoresOpts = '<option value="">-- Sin Operador Asignado --</option>';
    state.workers.forEach(w => {
        const chhProtegido = w.chh || 0;
        htmlOperadoresOpts += `<option value="${w.id}">${w.name} (CHH: $${chhProtegido.toFixed(2)})</option>`;
    });

    let htmlCards = '';
    filteredProcs.forEach((proc, index) => {
        let opts = htmlOperadoresOpts;
        if (proc.assignedWorkerId) {
            opts = opts.replace(`value="${proc.assignedWorkerId}"`, `value="${proc.assignedWorkerId}" selected`);
        }

        const disabledAttr = state.isProcesosLocked ? 'disabled' : '';

        htmlCards += `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 shadow-sm">
                <div class="flex justify-between items-center border-b pb-2">
                    <div>
                        <span class="font-extrabold text-blue-950 text-sm">${index + 1}. ${proc.name}</span>
                        <p class="text-[10px] text-slate-500 font-semibold">Máquina: ${proc.machine} | Valor: $${(proc.machineCost || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</p>
                    </div>
                    <span class="px-2 py-0.5 bg-blue-100 text-blue-900 rounded-md font-extrabold text-xs">${proc.time} hrs</span>
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-600 mb-1">Operador Asignado:</label>
                    <select ${disabledAttr} onchange="asignarTrabajadorProceso('${proc.id}', this.value)" class="w-full p-2 border rounded-lg text-xs bg-white text-slate-900 font-bold disabled:bg-slate-100 disabled:text-slate-500">
                        ${opts}
                    </select>
                </div>
            </div>`;
    });

    container.innerHTML = htmlCards;
}

window.asignarTrabajadorProceso = async function(processId, workerId) {
    const proc = state.processes.find(p => p.id === processId);
    if (proc) {
        proc.assignedWorkerId = workerId || null;
        try {
            await window.fs.updateDoc(window.fs.doc(window.db, "procesos", processId), { assignedWorkerId: proc.assignedWorkerId });
            actualizarCedulaProducto();
            recalcularPresupuestoUI();
            showToast("Operador asignado a la estación.");
        } catch (e) {
            console.error("Error al actualizar proceso:", e);
        }
    }
};

// =========================================================================
// MÓDULO 4: PRORRATEOS DINÁMICOS (PRIMARIO, SECUNDARIO Y FINAL)
// =========================================================================
window.calcularYRenderizarProrrateos = function() {
    const m2 = {
        Produc: parseFloat(document.getElementById('prorr-m2-prod')?.value) || 110,
        Admon:  parseFloat(document.getElementById('prorr-m2-admon')?.value) || 40,
        Ventas: parseFloat(document.getElementById('prorr-m2-ventas')?.value) || 15,
        RH:     parseFloat(document.getElementById('prorr-m2-rh')?.value) || 10,
        Distr:  parseFloat(document.getElementById('prorr-m2-distr')?.value) || 40
    };
    const totalM2 = m2.Produc + m2.Admon + m2.Ventas + m2.RH + m2.Distr || 1;

    const rentaTotal     = parseFloat(document.getElementById('prorr-renta')?.value) || 0;
    const eeTotal        = parseFloat(document.getElementById('prorr-luz')?.value) || 0;
    const aguaTotal      = parseFloat(document.getElementById('prorr-agua')?.value) || 0;
    const gasolinaTotal  = parseFloat(document.getElementById('prorr-gasolina')?.value) || 0;
    const licenciasTotal = parseFloat(document.getElementById('prorr-licencias')?.value) || 0;
    const loteEstandar   = parseFloat(document.getElementById('prorr-lote')?.value) || 1000;

    // 1. Prorrateo Primario
    const factorRenta = rentaTotal / totalM2;
    const renta = {}; Object.keys(m2).forEach(k => renta[k] = m2[k] * factorRenta);

    const eeFM = eeTotal * 0.72; 
    const eeIlum = eeTotal * 0.28; 
    const factorIlum = eeIlum / totalM2;
    const ee = {}; Object.keys(m2).forEach(k => ee[k] = (m2[k] * factorIlum) + (k === 'Produc' ? eeFM : 0));

    const factorAgua = aguaTotal / totalM2;
    const agua = {}; Object.keys(m2).forEach(k => agua[k] = m2[k] * factorAgua);

    const gasolina = { Produc: 0, Admon: 0, Ventas: 0, RH: 0, Distr: gasolinaTotal };
    const licencias = { Produc: licenciasTotal, Admon: 0, Ventas: 0, RH: 0, Distr: 0 };

    const primarioTotales = {};
    Object.keys(m2).forEach(k => {
        primarioTotales[k] = renta[k] + ee[k] + agua[k] + gasolina[k] + licencias[k];
    });

    const totalGeneralPrimario = rentaTotal + eeTotal + aguaTotal + gasolinaTotal + licenciasTotal;

    const tbodyPrimario = document.getElementById('tb-prorrateo-primario');
    if (tbodyPrimario) {
        tbodyPrimario.innerHTML = `
            <tr><td class="p-2 border text-left">Renta de Nave</td><td class="p-2 border">Superficie (${totalM2} m²)</td><td class="p-2 border bg-blue-50 font-bold">${formatMXN(renta.Produc)}</td><td class="p-2 border">${formatMXN(renta.Admon)}</td><td class="p-2 border">${formatMXN(renta.Ventas)}</td><td class="p-2 border">${formatMXN(renta.RH)}</td><td class="p-2 border">${formatMXN(renta.Distr)}</td><td class="p-2 border font-bold">${formatMXN(rentaTotal)}</td></tr>
            <tr><td class="p-2 border text-left">Energía Eléctrica (72% FM / 28% Ilum)</td><td class="p-2 border">Fuerza Motriz / m²</td><td class="p-2 border bg-blue-50 font-bold">${formatMXN(ee.Produc)}</td><td class="p-2 border">${formatMXN(ee.Admon)}</td><td class="p-2 border">${formatMXN(ee.Ventas)}</td><td class="p-2 border">${formatMXN(ee.RH)}</td><td class="p-2 border">${formatMXN(ee.Distr)}</td><td class="p-2 border font-bold">${formatMXN(eeTotal)}</td></tr>
            <tr><td class="p-2 border text-left">Agua Potable</td><td class="p-2 border">Superficie (${totalM2} m²)</td><td class="p-2 border bg-blue-50 font-bold">${formatMXN(agua.Produc)}</td><td class="p-2 border">${formatMXN(agua.Admon)}</td><td class="p-2 border">${formatMXN(agua.Ventas)}</td><td class="p-2 border">${formatMXN(agua.RH)}</td><td class="p-2 border">${formatMXN(agua.Distr)}</td><td class="p-2 border font-bold">${formatMXN(aguaTotal)}</td></tr>
            <tr><td class="p-2 border text-left">Gasolina Flotilla Reparto</td><td class="p-2 border">Directo a Distribución</td><td class="p-2 border bg-blue-50 font-bold">$0.00</td><td class="p-2 border">$0.00</td><td class="p-2 border">$0.00</td><td class="p-2 border">$0.00</td><td class="p-2 border">${formatMXN(gasolina.Distr)}</td><td class="p-2 border font-bold">${formatMXN(gasolinaTotal)}</td></tr>
            <tr><td class="p-2 border text-left">Licencias Software Sanitario</td><td class="p-2 border">Directo a Producción</td><td class="p-2 border bg-blue-50 font-bold">${formatMXN(licencias.Produc)}</td><td class="p-2 border">$0.00</td><td class="p-2 border">$0.00</td><td class="p-2 border">$0.00</td><td class="p-2 border">$0.00</td><td class="p-2 border font-bold">${formatMXN(licenciasTotal)}</td></tr>
        `;

        document.getElementById('tr-totales-primario').innerHTML = `
            <td colspan="2" class="p-2 border text-right">TOTAL PRORRATEO PRIMARIO:</td>
            <td class="p-2 border text-blue-950 font-extrabold">${formatMXN(primarioTotales.Produc)}</td>
            <td class="p-2 border">${formatMXN(primarioTotales.Admon)}</td>
            <td class="p-2 border">${formatMXN(primarioTotales.Ventas)}</td>
            <td class="p-2 border">${formatMXN(primarioTotales.RH)}</td>
            <td class="p-2 border">${formatMXN(primarioTotales.Distr)}</td>
            <td class="p-2 border text-blue-950 font-black">${formatMXN(totalGeneralPrimario)}</td>
        `;
    }

    // 2. Prorrateo Secundario
    const rhMonto = primarioTotales.RH;
    const emp = { Produc: 12, Ventas: 3, Distr: 3, Admon: 2 };
    const factorRH = rhMonto / 18;
    const rhDist = { Produc: emp.Produc * factorRH, Ventas: emp.Ventas * factorRH, Distr: emp.Distr * factorRH, Admon: emp.Admon * factorRH };

    const admonMontoAcum = primarioTotales.Admon + rhDist.Admon;
    const admonDist = { Produc: admonMontoAcum * 0.70, Ventas: admonMontoAcum * 0.15, Distr: admonMontoAcum * 0.15 };

    const tbodySecundario = document.getElementById('tb-prorrateo-secundario');
    if (tbodySecundario) {
        tbodySecundario.innerHTML = `
            <tr><td class="p-2 border text-left">Recosteo Recursos Humanos (RH)</td><td class="p-2 border">${formatMXN(rhMonto)}</td><td class="p-2 border">Trabajadores (18 op.)</td><td class="p-2 border bg-blue-50 font-bold">${formatMXN(rhDist.Produc)}</td><td class="p-2 border">${formatMXN(rhDist.Ventas)}</td><td class="p-2 border">${formatMXN(rhDist.Distr)}</td></tr>
            <tr><td class="p-2 border text-left">Recosteo Administración General</td><td class="p-2 border">${formatMXN(admonMontoAcum)}</td><td class="p-2 border">Asignación Operativa (70% Fab)</td><td class="p-2 border bg-blue-50 font-bold">${formatMXN(admonDist.Produc)}</td><td class="p-2 border">${formatMXN(admonDist.Ventas)}</td><td class="p-2 border">${formatMXN(admonDist.Distr)}</td></tr>
        `;

        const totalSecProduc = rhDist.Produc + admonDist.Produc;
        document.getElementById('tr-totales-secundario').innerHTML = `
            <td colspan="3" class="p-2 border text-right">TOTAL SECUNDARIO ASIGNADO A PRODUCCIÓN:</td>
            <td class="p-2 border text-blue-950 font-extrabold">${formatMXN(totalSecProduc)}</td>
            <td class="p-2 border">${formatMXN(rhDist.Ventas + admonDist.Ventas)}</td>
            <td class="p-2 border">${formatMXN(rhDist.Distr + admonDist.Distr)}</td>
        `;
    }

    // 3. Prorrateo Final
    const gifTotalProduccion = primarioTotales.Produc + rhDist.Produc + admonDist.Produc;
    const cuotaPorUnidad = loteEstandar > 0 ? (gifTotalProduccion / loteEstandar) : 0;
    const cuotaPorHora = gifTotalProduccion / 1450;

    state.prorrateoResultados = {
        gifTotalProduccion,
        cuotaPorUnidad,
        cuotaPorHora,
        gastosAdminTotal: admonDist.Ventas + admonDist.Distr,
        gastosVentaTotal: primarioTotales.Ventas + rhDist.Ventas + admonDist.Ventas,
        gastosDistrTotal: primarioTotales.Distr + rhDist.Distr + admonDist.Distr
    };

    const lblGifA = document.getElementById('lbl-gif-total-a');
    if (lblGifA) lblGifA.innerText = formatMXN(gifTotalProduccion);

    const lblTasaA = document.getElementById('lbl-tasa-gif-unidad');
    if (lblTasaA) lblTasaA.innerText = `${formatMXN(cuotaPorUnidad)} / pza`;

    return state.prorrateoResultados;
};

window.guardarConfigProrrateoFirebase = async function() {
    const payload = {
        m2Prod: parseFloat(document.getElementById('prorr-m2-prod').value) || 110,
        m2Admon: parseFloat(document.getElementById('prorr-m2-admon').value) || 40,
        m2Ventas: parseFloat(document.getElementById('prorr-m2-ventas').value) || 15,
        m2Rh: parseFloat(document.getElementById('prorr-m2-rh').value) || 10,
        m2Distr: parseFloat(document.getElementById('prorr-m2-distr').value) || 40,
        renta: parseFloat(document.getElementById('prorr-renta').value) || 50000,
        luz: parseFloat(document.getElementById('prorr-luz').value) || 22000,
        agua: parseFloat(document.getElementById('prorr-agua').value) || 2300,
        gasolina: parseFloat(document.getElementById('prorr-gasolina').value) || 2200,
        licencias: parseFloat(document.getElementById('prorr-licencias').value) || 5000,
        lote: parseFloat(document.getElementById('prorr-lote').value) || 1000,
        updatedAt: new Date()
    };

    try {
        await window.fs.setDoc(window.fs.doc(window.db, "configuracion", "prorrateo"), payload);
        calcularYRenderizarProrrateos();
        actualizarCedulaProducto();
        recalcularPresupuestoUI();
        showToast("Bases y montos de Prorrateo guardados en Firebase.");
    } catch (error) {
        console.error("Error al guardar prorrateo:", error);
        showToast("Error al guardar prorrateo en Firebase.", "error");
    }
};

// =========================================================================
// MÓDULO 5: CÉDULA DE INTEGRACIÓN DE COSTOS (MP + MO + GIF)
// =========================================================================
window.actualizarCedulaProducto = function() {
    const selectElem = document.getElementById('select-producto-costeo');
    if (!selectElem) return;

    const key = selectElem.value;
    const { cuotaPorUnidad } = state.prorrateoResultados.cuotaPorUnidad > 0 
        ? state.prorrateoResultados 
        : calcularYRenderizarProrrateos();

    function getCostoMP(keywords, defaultVal) {
        const prod = state.products.find(p => keywords.some(k => p.name.toLowerCase().includes(k.toLowerCase())));
        if (!prod) return defaultVal;

        const movs = state.movements[prod.id] || [];
        const entradas = movs.filter(m => m.tipo === 'ENTRADA' && m.costoUnitario > 0);
        return entradas.length > 0 ? entradas[entradas.length - 1].costoUnitario : defaultVal;
    }

    const recetasBase = {
        lente: {
            nombre: "👓 Lente Terminado Graduado (CR-39)",
            items: [
                { nombre: "Micas Orgánicas CR-39", tipo: "MPD", cantidadTexto: "1 Par", factor: 1.0, ctoUnit: getCostoMP(["Mica", "CR-39"], 120.00) },
                { nombre: "Armazón de Acetato Inyectado", tipo: "MPD", cantidadTexto: "1 Pza", factor: 1.0, ctoUnit: getCostoMP(["Armazón", "Acetato"], 85.00) },
                { nombre: "Estuche y Microfibra", tipo: "MPI", cantidadTexto: "1 Juego", factor: 1.0, ctoUnit: getCostoMP(["Estuche"], 15.00) }
            ]
        },
        armazon: {
            nombre: "🕶️ Armazón de Acetato Inyectado",
            items: [
                { nombre: "Pellets de Acetato de Celulosa", tipo: "MPD", cantidadTexto: "0.25 Kg", factor: 0.25, ctoUnit: getCostoMP(["Acetato"], 112.00) },
                { nombre: "Alma Metálica y Bisagras", tipo: "MPD", cantidadTexto: "1 Juego", factor: 1.0, ctoUnit: getCostoMP(["Bisagras"], 15.00) },
                { nombre: "Empaque Individual Bolsa", tipo: "MPI", cantidadTexto: "1 Pza", factor: 1.0, ctoUnit: getCostoMP(["Bolsa"], 2.00) }
            ]
        },
        kit: {
            nombre: "🧼 Kit de Limpieza y Mantenimiento",
            items: [
                { nombre: "Solución Limpiadora 60ml", tipo: "MPD", cantidadTexto: "1 Frasco", factor: 1.0, ctoUnit: getCostoMP(["Solución"], 12.00) },
                { nombre: "Paño Microfibra", tipo: "MPD", cantidadTexto: "1 Pza", factor: 1.0, ctoUnit: getCostoMP(["Paño"], 6.00) },
                { nombre: "Estuche Rígido con Cierre", tipo: "MPD", cantidadTexto: "1 Pza", factor: 1.0, ctoUnit: getCostoMP(["Estuche"], 15.00) }
            ]
        }
    };

    state.customProducts.forEach(cp => {
        recetasBase[cp.key] = {
            nombre: `✨ ${cp.name}`,
            items: (cp.receta || []).map(r => ({
                nombre: r.nombre,
                tipo: r.tipo || "MPD",
                cantidadTexto: r.cantidadTexto || "1 Unidad",
                factor: r.factor || 1.0,
                ctoUnit: getCostoMP([r.nombre], r.defaultVal || 0)
            }))
        };
    });

    const productoActual = recetasBase[key] || recetasBase.lente;

    // 1. Renderizar Tabla Materia Prima
    const tbodyMP = document.getElementById('tb-cedula-mp');
    let totalMP = 0;
    if (tbodyMP) {
        tbodyMP.innerHTML = '';
        productoActual.items.forEach(item => {
            const subtotal = item.ctoUnit * item.factor;
            totalMP += subtotal;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="border border-slate-300 p-2 text-left font-medium">${item.nombre}</td>
                <td class="border border-slate-300 p-2 font-bold ${item.tipo === 'MPD' ? 'text-blue-900' : 'text-amber-700'}">${item.tipo}</td>
                <td class="border border-slate-300 p-2">${item.cantidadTexto}</td>
                <td class="border border-slate-300 p-2">${formatMXN(item.ctoUnit)}</td>
                <td class="border border-slate-300 p-2 font-bold">${formatMXN(subtotal)}</td>`;
            tbodyMP.appendChild(tr);
        });

        document.getElementById('lbl-cedula-total-mp').innerText = formatMXN(totalMP);
    }

    // 2. Renderizar Tabla Mano de Obra Directa
    const tbodyMO = document.getElementById('tb-cedula-mo');
    let totalMO = 0;
    const rutaProcesos = state.processes.filter(p => (p.productKey || 'lente') === key);

    if (tbodyMO) {
        tbodyMO.innerHTML = '';
        if (rutaProcesos.length === 0) {
            tbodyMO.innerHTML = `<tr><td colspan="5" class="p-3 text-slate-400">No hay estaciones configuradas en Módulo 3 para este producto (MOD = $0.00).</td></tr>`;
        } else {
            rutaProcesos.forEach(proc => {
                const worker = state.workers.find(w => w.id === proc.assignedWorkerId);
                const workerName = worker ? worker.name : 'Sin Asignar (CHH Base)';
                const chhVal = worker ? worker.chh : 35.82;
                const subtotal = proc.time * chhVal;

                totalMO += subtotal;

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="border border-slate-300 p-2 text-left font-bold text-blue-950">${proc.name} (${proc.machine})</td>
                    <td class="border border-slate-300 p-2 text-left">${workerName}</td>
                    <td class="border border-slate-300 p-2">${proc.time} hrs</td>
                    <td class="border border-slate-300 p-2">${formatMXN(chhVal)}</td>
                    <td class="border border-slate-300 p-2 font-bold">${formatMXN(subtotal)}</td>`;
                tbodyMO.appendChild(tr);
            });
        }

        document.getElementById('lbl-cedula-total-mo').innerText = formatMXN(totalMO);
    }

    // 3. Gastos Indirectos de Fabricación (GIF)
    const totalGIF = cuotaPorUnidad * 1;

    const lblGifTasa = document.getElementById('lbl-cedula-gif-tasa');
    if (lblGifTasa) lblGifTasa.innerText = `${formatMXN(cuotaPorUnidad)} / pza`;

    const lblGifTiempo = document.getElementById('lbl-cedula-gif-tiempo');
    if (lblGifTiempo) lblGifTiempo.innerText = `1 Unidad (Lote Estándar)`;

    const lblTotalGif = document.getElementById('lbl-cedula-total-gif');
    if (lblTotalGif) lblTotalGif.innerText = formatMXN(totalGIF);

    const costoPrimo = totalMP + totalMO;
    const costoTransformacion = totalMO + totalGIF;
    const costoFinal = totalMP + totalMO + totalGIF;

    state.ultimoCosteoUnitario[key] = {
        mp: totalMP,
        mo: totalMO,
        gif: totalGIF,
        total: costoFinal,
        nombre: productoActual.nombre
    };

    document.getElementById('lbl-costo-primo').innerText = `${formatMXN(costoPrimo)} MXN`;
    document.getElementById('lbl-costo-transformacion').innerText = `${formatMXN(costoTransformacion)} MXN`;
    document.getElementById('lbl-cedula-costo-final').innerText = `${formatMXN(costoFinal)} MXN`;

    const tituloProd = document.getElementById('lbl-cedula-titulo-prod');
    if (tituloProd) tituloProd.innerText = `COSTO UNITARIO TOTAL — ${productoActual.nombre.toUpperCase()}`;

    const qrContainer = document.getElementById('qrcode-container');
    if (qrContainer && window.QRCode) {
        qrContainer.innerHTML = '';
        const qrData = `OptiCost | ${key.toUpperCase()} | Cto: ${formatMXN(costoFinal)} | ${new Date().toLocaleDateString('es-MX')}`;
        try {
            new QRCode(qrContainer, {
                text: qrData,
                width: 88,
                height: 88,
                colorDark: "#0f172a",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.L
            });
        } catch (e) {
            console.warn("No se pudo generar el QR", e);
        }
    }
};

// =========================================================================
// MÓDULO 1: TARJETAS DE ALMACÉN (KARDEX)
// =========================================================================
async function renderAllCards() {
    const container = document.getElementById('cards-container');
    if (!container) return;

    if (state.products.length === 0) {
        container.innerHTML = `<div class="p-6 text-center border border-dashed border-slate-300 rounded-lg bg-slate-50"><p class="text-sm text-slate-500">No hay insumos registrados en almacén.</p></div>`;
        return;
    }

    container.innerHTML = '';

    for (const product of state.products) {
        if (!state.movements[product.id]) {
            await loadMovementsFromFirebase(product.id);
        }

        const productWithGlobalMethod = { ...product, metodo: state.globalMethod };
        const rawMovements = state.movements[product.id] || [];
        const { rows, totalDebe, totalHaber, saldoFinal } = InventoryEngine.processMovements(productWithGlobalMethod, rawMovements);

        const cardWrapper = document.createElement('div');
        cardWrapper.className = "border border-slate-300 rounded-xl overflow-hidden shadow-sm bg-white mb-6 report-card";

        let rowsHTML = '';
        rows.forEach(r => {
            rowsHTML += `
                <tr class="${r.isSubRow ? 'bg-slate-50/70 text-slate-600 border-b border-slate-200' : 'border-b border-slate-300'}">
                    <td class="border border-slate-300 p-2">${r.fecha}</td>
                    <td class="border border-slate-300 p-2">${r.ref}</td>
                    <td class="border border-slate-300 p-2 text-left">${r.concepto}</td>
                    <td class="border border-slate-300 p-2 font-semibold">${r.entradas}</td>
                    <td class="border border-slate-300 p-2 text-red-700 font-semibold">${r.salidas}</td>
                    <td class="border border-slate-300 p-2 font-bold">${r.existencia} ${product.unit}</td>
                    <td class="border border-slate-300 p-2">${r.costoUnitario ? '$' + r.costoUnitario : ''}</td>
                    <td class="border border-slate-300 p-2">${r.debe ? '$' + r.debe : ''}</td>
                    <td class="border border-slate-300 p-2">${r.haber ? '$' + r.haber : ''}</td>
                    <td class="border border-slate-300 p-2 font-bold text-blue-950">$${r.saldo}</td>
                </tr>`;
        });

        cardWrapper.innerHTML = `
            <div class="bg-slate-100 px-4 py-3 border-b border-slate-300 flex justify-between items-center">
                <div>
                    <h3 class="font-bold text-base text-blue-950">${product.name}</h3>
                    <p class="text-xs text-slate-500">Unidad: <span class="font-semibold text-slate-700">${product.unit}</span></p>
                </div>
                <div class="flex items-center gap-2">
                    <span class="px-2.5 py-1 bg-blue-950 text-white font-bold text-xs rounded-lg">${state.globalMethod}</span>
                    <button onclick="printSpecificReport(this, 'Tarjeta de Almacén - ${product.name}')" class="no-print text-xs bg-white border border-slate-300 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-lg transition font-bold">🖨️ Imprimir</button>
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full border-collapse border border-slate-300 text-xs text-center">
                    <thead class="bg-blue-950 text-white font-bold">
                        <tr>
                            <th class="border border-slate-300 p-2">Fecha</th>
                            <th class="border border-slate-300 p-2">Ref</th>
                            <th class="border border-slate-300 p-2">Concepto</th>
                            <th class="border border-slate-300 p-2">Entradas</th>
                            <th class="border border-slate-300 p-2">Salidas</th>
                            <th class="border border-slate-300 p-2">Existencia</th>
                            <th class="border border-slate-300 p-2">Cto Ut</th>
                            <th class="border border-slate-300 p-2">Debe</th>
                            <th class="border border-slate-300 p-2">Haber</th>
                            <th class="border border-slate-300 p-2">Saldo</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200">${rowsHTML || '<tr><td colspan="10" class="p-3 text-slate-400">Sin movimientos registrados</td></tr>'}</tbody>
                    <tfoot class="bg-slate-100 font-bold border-t-2 border-slate-400">
                        <tr>
                            <td colspan="7" class="border border-slate-300 p-2 text-right">TOTALES / SALDO FINAL:</td>
                            <td class="border border-slate-300 p-2 text-blue-950">${formatMXN(totalDebe)}</td>
                            <td class="border border-slate-300 p-2 text-blue-950">${formatMXN(totalHaber)}</td>
                            <td class="border border-slate-300 p-2 text-blue-950 font-black">${formatMXN(saldoFinal)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>`;

        container.appendChild(cardWrapper);
    }
}

// =========================================================================
// CARGA DE COLECCIONES DESDE FIREBASE FIRESTORE
// =========================================================================
async function loadConfigFromFirebase() {
    try {
        const snap = await window.fs.getDoc(window.fs.doc(window.db, "configuracion", "global"));
        if (snap.exists()) {
            state.globalMethod = snap.data().globalMethod || 'PEPS';
            const sel = document.getElementById('cfg-metodo-global');
            if (sel) sel.value = state.globalMethod;
            const badge = document.getElementById('active-method-badge');
            if (badge) badge.innerText = `Método: ${state.globalMethod}`;
        }
    } catch (e) {
        console.warn("Usando configuración global por defecto:", e);
    }
}

async function loadProrrateoFromFirebase() {
    try {
        const snap = await window.fs.getDoc(window.fs.doc(window.db, "configuracion", "prorrateo"));
        if (snap.exists()) {
            const d = snap.data();
            if (d.m2Prod !== undefined) document.getElementById('prorr-m2-prod').value = d.m2Prod;
            if (d.m2Admon !== undefined) document.getElementById('prorr-m2-admon').value = d.m2Admon;
            if (d.m2Ventas !== undefined) document.getElementById('prorr-m2-ventas').value = d.m2Ventas;
            if (d.m2Rh !== undefined) document.getElementById('prorr-m2-rh').value = d.m2Rh;
            if (d.m2Distr !== undefined) document.getElementById('prorr-m2-distr').value = d.m2Distr;
            if (d.renta !== undefined) document.getElementById('prorr-renta').value = d.renta;
            if (d.luz !== undefined) document.getElementById('prorr-luz').value = d.luz;
            if (d.agua !== undefined) document.getElementById('prorr-agua').value = d.agua;
            if (d.gasolina !== undefined) document.getElementById('prorr-gasolina').value = d.gasolina;
            if (d.licencias !== undefined) document.getElementById('prorr-licencias').value = d.licencias;
            if (d.lote !== undefined) document.getElementById('prorr-lote').value = d.lote;
        }
    } catch (e) {
        console.warn("Usando valores base de prorrateo:", e);
    }
}

async function loadCustomProductsFromFirebase() {
    try {
        const snap = await window.fs.getDocs(window.fs.collection(window.db, "productos_terminados"));
        state.customProducts = [];
        snap.forEach(doc => state.customProducts.push({ id: doc.id, ...doc.data() }));
        syncCustomProductsDropdowns();
    } catch (e) {
        console.warn("Sin productos terminados personalizados:", e);
    }
}

function syncCustomProductsDropdowns() {
    const selects = [
        document.getElementById('proc-product-key'),
        document.getElementById('filter-ruta-product'),
        document.getElementById('select-producto-costeo'),
        document.getElementById('pres-producto-derivado')
    ];

    selects.forEach(sel => {
        if (!sel) return;
        state.customProducts.forEach(cp => {
            if (!Array.from(sel.options).some(opt => opt.value === cp.key)) {
                sel.add(new Option(`✨ ${cp.name}`, cp.key));
            }
        });
    });
}

async function loadProductsFromFirebase() {
    try {
        const querySnapshot = await window.fs.getDocs(window.fs.collection(window.db, "productos"));
        state.products = [];
        querySnapshot.forEach((doc) => {
            state.products.push({ id: doc.id, ...doc.data() });
        });

        updateProductDropdowns();
        for (const p of state.products) {
            await loadMovementsFromFirebase(p.id);
        }
        renderAllCards();
    } catch (error) {
        console.error("Error al cargar productos:", error);
    }
}

async function loadWorkersFromFirebase() {
    try {
        const querySnapshot = await window.fs.getDocs(window.fs.collection(window.db, "trabajadores"));
        state.workers = [];
        querySnapshot.forEach((doc) => {
            state.workers.push({ id: doc.id, ...doc.data() });
        });

        state.workers.sort((a, b) => {
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
            return dateA - dateB;
        });

        const container = document.getElementById('workers-reports-container');
        if (container) {
            container.innerHTML = '';
            const groups = {};
            state.workers.forEach(w => {
                const key = w.session || "Reporte Histórico Anterior";
                if (!groups[key]) groups[key] = [];
                groups[key].push(w);
            });

            Object.keys(groups).forEach((sessionKey) => {
                const workersInGroup = groups[sessionKey];
                let tbodyHTML = '';
                workersInGroup.forEach(w => {
                    const pBase = w.percepcionBase || w.dailyWage || 0;
                    const dWage = w.dailyWage || 0;
                    tbodyHTML += `
                        <tr class="border-b border-slate-300 whitespace-nowrap">
                            <td class="p-2 border font-bold text-left">${w.name || 'Sin nombre'}</td>
                            <td class="p-2 border text-slate-600">${w.startDate || 'N/A'}</td>
                            <td class="p-2 border bg-blue-50 font-bold">${w.tipoContrato || 'Diario'}</td>
                            <td class="p-2 border bg-slate-50 font-semibold">${formatMXN(pBase)}</td>
                            <td class="p-2 border bg-slate-50">${w.tipoJornada || 'Diurna'} (${w.jornada || 8}h)</td>
                            <td class="p-2 border bg-slate-50 font-semibold">${w.diasVacaciones !== undefined ? w.diasVacaciones : 12}</td>
                            <td class="p-2 border bg-slate-50 text-red-600 font-semibold">${w.faltas || 0}</td>
                            <td class="p-2 border bg-slate-50 text-slate-500">${w.diasLibresLey || 59}</td>
                            <td class="p-2 border bg-blue-50 font-black text-blue-900">${w.diasLab !== undefined ? w.diasLab : 302}</td>
                            <td class="p-2 border font-bold text-indigo-900">${formatMXN(dWage)}</td>
                            <td class="p-2 border">${formatMXN(w.sueldoAnual || 0)}</td>
                            <td class="p-2 border">${formatMXN(w.subtotalLey || 0)}</td>
                            <td class="p-2 border">${formatMXN(w.cargasPatronales || 0)}</td>
                            <td class="p-2 border text-slate-500 font-semibold">${formatMXN(w.salarioIntegradoAnual || 0)}</td>
                            <td class="p-2 border bg-slate-100 font-bold">${formatMXN(w.salarioIntegradoDiario || 0)}</td>
                            <td class="p-2 border bg-emerald-100 text-emerald-900 font-extrabold">${formatMXN(w.chh || 0)}</td>
                        </tr>`;
                });

                const isCurrentSession = (sessionKey === state.sessionId);
                const headerClass = isCurrentSession ? 'bg-blue-950' : 'bg-slate-700';
                const titleBadge = isCurrentSession 
                    ? '<span class="ml-3 px-2 py-0.5 bg-emerald-500 text-white text-[10px] rounded uppercase font-bold">Sesión Actual</span>' 
                    : '';

                container.innerHTML += `
                    <div class="border border-slate-300 rounded-xl overflow-hidden shadow-sm mb-6 report-card">
                        <div class="bg-slate-100 px-4 py-3 border-b border-slate-300 flex justify-between items-center">
                            <h3 class="font-bold text-slate-800 text-sm">📋 Grupo de Alta: <span class="font-medium text-slate-600">${sessionKey}</span> ${titleBadge}</h3>
                            <button onclick="printSpecificReport(this, 'Reporte de Nómina LFT')" class="no-print text-xs bg-white border border-slate-300 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition font-bold shadow-sm">
                                🖨️ Imprimir Reporte
                            </button>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full border-collapse border border-slate-300 text-xs text-center">
                                <thead class="${headerClass} text-white font-bold">
                                    <tr>
                                        <th class="border border-slate-300 p-2 text-left">Puesto / Trabajador</th>
                                        <th class="border border-slate-300 p-2">Ingreso</th>
                                        <th class="border border-slate-300 p-2">Contrato</th>
                                        <th class="border border-slate-300 p-2">Percepción</th>
                                        <th class="border border-slate-300 p-2">Jornada</th>
                                        <th class="border border-slate-300 p-2">Vac.</th>
                                        <th class="border border-slate-300 p-2">Faltas</th>
                                        <th class="border border-slate-300 p-2">Libres (Ley)</th>
                                        <th class="border border-slate-300 p-2 bg-blue-800/50">Días Lab.</th>
                                        <th class="border border-slate-300 p-2">SD Real</th>
                                        <th class="border border-slate-300 p-2">Sueldo Anual</th>
                                        <th class="border border-slate-300 p-2">Sub. Ley</th>
                                        <th class="border border-slate-300 p-2">Cargas Pat.</th>
                                        <th class="border border-slate-300 p-2">Sal. Int. Anual</th>
                                        <th class="border border-slate-300 p-2 bg-slate-900/20">Sal. Int. Diario</th>
                                        <th class="border border-slate-300 p-2 bg-emerald-700 text-white">CHH ($)</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-200">${tbodyHTML}</tbody>
                            </table>
                        </div>
                    </div>`;
            });
        }

        renderProcesosModule();
    } catch (error) {
        console.error("Error al cargar trabajadores:", error);
    }
}

async function loadProcessesFromFirebase() {
    try {
        const querySnapshot = await window.fs.getDocs(window.fs.collection(window.db, "procesos"));
        state.processes = [];
        querySnapshot.forEach((doc) => {
            state.processes.push({ id: doc.id, ...doc.data() });
        });
        renderProcesosModule();
    } catch (error) {
        console.error("Error al cargar procesos:", error);
    }
}

async function loadMovementsFromFirebase(productId) {
    try {
        const q = window.fs.query(
            window.fs.collection(window.db, "movimientos"), 
            window.fs.where("productId", "==", productId)
        );
        const querySnapshot = await window.fs.getDocs(q);
        state.movements[productId] = [];
        querySnapshot.forEach((doc) => {
            state.movements[productId].push(doc.data());
        });
        state.movements[productId].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    } catch (error) {
        console.error("Error al cargar movimientos:", error);
    }
}

function updateProductDropdowns() {
    const movProductSelect = document.getElementById('mov-product');
    if (!movProductSelect) return;
    movProductSelect.innerHTML = '';
    state.products.forEach(p => {
        movProductSelect.add(new Option(`${p.name}`, p.id));
    });
}

// =========================================================================
// MÓDULO 2: CÁLCULO DE NÓMINA Y CHH (LFT)
// =========================================================================
function calcularDiasVacaciones(fechaIngreso) {
    const hoy = new Date();
    const ingreso = new Date(fechaIngreso);
    let antiguedad = hoy.getFullYear() - ingreso.getFullYear();
    const mes = hoy.getMonth() - ingreso.getMonth();
    if (mes < 0 || (mes === 0 && hoy.getDate() < ingreso.getDate())) {
        antiguedad--;
    }

    if (antiguedad < 1) return 0;
    if (antiguedad === 1) return 12;
    if (antiguedad === 2) return 14;
    if (antiguedad === 3) return 16;
    if (antiguedad === 4) return 18;
    if (antiguedad === 5) return 20;
    return 22 + Math.floor((antiguedad - 6) / 5) * 2;
}

function calculateWorkerCHH(dailyWage, fechaIngreso, tipoJornada, faltas) {
    let jornada = 8;
    if (tipoJornada === 'Nocturna') jornada = 7;
    if (tipoJornada === 'Mixta') jornada = 7.5;

    const diasVacaciones = calcularDiasVacaciones(fechaIngreso);
    const diasAnuales = 365;
    const domingos = 52;
    const diasFestivos = 7;
    const diasLibresLey = domingos + diasFestivos;
    const diasLab = diasAnuales - diasLibresLey - diasVacaciones - faltas;

    const sueldoAnual = dailyWage * 365;
    const aguinaldo = dailyWage * 15;
    const primaVacacional = (dailyWage * diasVacaciones) * 0.25;
    const subtotalLey = sueldoAnual + aguinaldo + primaVacacional;

    const comedorAnual = 48 * 19.83 * 12;
    const valesAnual = 1200 * 12;
    const eqSeguridad = 1720;

    const cargasPatronales = subtotalLey * 0.14;
    const salarioIntegradoAnual = subtotalLey + comedorAnual + valesAnual + cargasPatronales + eqSeguridad;
    const salarioIntegradoDiario = salarioIntegradoAnual / diasLab;
    const chh = salarioIntegradoDiario / jornada;

    return {
        sueldoAnual, subtotalLey, cargasPatronales, salarioIntegradoAnual,
        salarioIntegradoDiario, chh, diasLab, diasVacaciones, tipoJornada, faltas, jornada, diasLibresLey
    };
}

document.getElementById('worker-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('wrk-name').value;
    const startDate = document.getElementById('wrk-date').value;
    const tipoContrato = document.getElementById('wrk-contrato').value;
    const percepcionBase = parseFloat(document.getElementById('wrk-wage').value);
    const tipoJornada = document.getElementById('wrk-jornada').value;
    const faltas = parseInt(document.getElementById('wrk-faltas').value) || 0;

    let dailyWage = percepcionBase;
    if (tipoContrato === 'Semanal') dailyWage = percepcionBase / 7;
    if (tipoContrato === 'Mensual') dailyWage = percepcionBase / 30;

    const calc = calculateWorkerCHH(dailyWage, startDate, tipoJornada, faltas);
    const newWorker = {
        name, startDate, tipoContrato, percepcionBase, dailyWage,
        ...calc, createdAt: new Date(), session: state.sessionId
    };

    try {
        await window.fs.addDoc(window.fs.collection(window.db, "trabajadores"), newWorker);
        document.getElementById('worker-form').reset();
        await loadWorkersFromFirebase();
        actualizarCedulaProducto();
        recalcularPresupuestoUI();
        showToast(`Trabajador "${name}" registrado (CHH: ${formatMXN(calc.chh)}).`);
    } catch (error) {
        console.error("Error al guardar trabajador:", error);
        showToast("Error al registrar trabajador.", "error");
    }
});

// =========================================================================
// MÓDULO 6: BASE HISTÓRICA PROPIA (FIREBASE) + CICLOS ÓPTICOS + PRESUPUESTO
// =========================================================================
async function loadHistoricalMonthlyFromFirebase() {
    try {
        const snap = await window.fs.getDocs(window.fs.collection(window.db, "historico_mensual"));
        state.historicalMonthly = [];
        snap.forEach(doc => state.historicalMonthly.push({ id: doc.id, ...doc.data() }));
        state.historicalMonthly.sort((a, b) => (a.anio - b.anio) || (a.orden - b.orden));
        renderHistoricalMonthlyTable();
    } catch (e) {
        console.error("Error al cargar histórico mensual:", e);
    }
}


window.toggleLockHistorico = function() {
    state.isHistoricoLocked = !state.isHistoricoLocked;

    const btnLock = document.getElementById('btn-toggle-lock-historico');
    const btnInit = document.getElementById('btn-init-historico');
    const formInputs = document.querySelectorAll('#historico-mensual-form input, #historico-mensual-form select, #historico-mensual-form button');

    if (btnLock) {
        btnLock.innerText = state.isHistoricoLocked ? "🔓 Desbloquear Histórico" : "🔒 Cerrar y Bloquear Histórico";
        btnLock.className = state.isHistoricoLocked
            ? "px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg transition shadow-sm"
            : "px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg transition shadow-sm";
    }

    if (btnInit) {
        if (state.isHistoricoLocked) btnInit.setAttribute('disabled', 'true');
        else btnInit.removeAttribute('disabled');
    }

    formInputs.forEach(el => {
        if (state.isHistoricoLocked) el.setAttribute('disabled', 'true');
        else el.removeAttribute('disabled');
    });

    renderHistoricalMonthlyTable();
    showToast(
        state.isHistoricoLocked
            ? "Histórico contable bloqueado (Modo solo lectura)."
            : "Modo auditoría activo: ya puedes registrar o editar meses históricos.",
        "info"
    );
};

window.inicializarHistoricoPlantaFirebase = async function() {
    if (state.isHistoricoLocked) {
        return showToast("Desbloquea el Histórico Contable antes de cargar datos.", "info");
    }
    if (typeof OPTICAL_HISTORICAL_TEMPLATE === 'undefined') return;
    showToast("Guardando los 12 meses históricos de la fábrica óptica en Firebase...", "info");

    try {
        for (const item of OPTICAL_HISTORICAL_TEMPLATE) {
            const docId = `${item.anio}_${item.mes}`;
            await window.fs.setDoc(window.fs.doc(window.db, "historico_mensual", docId), {
                ...item,
                updatedAt: new Date()
            });
        }
        await loadHistoricalMonthlyFromFirebase();
        aplicarCicloOpticoSeleccionado(true);
        showToast("¡Base de Datos Histórica (12 meses) creada en Firebase!");
    } catch (e) {
        console.error("Error al inicializar histórico:", e);
        showToast("No se pudo inicializar el histórico en Firebase.", "error");
    }
};

function renderHistoricalMonthlyTable() {
    const tbody = document.getElementById('tb-historico-mensual');
    const badge = document.getElementById('badge-conteo-historico');
    if (badge) badge.innerText = `${state.historicalMonthly.length} meses en BD`;
    if (!tbody) return;

    if (state.historicalMonthly.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-slate-500">Tu colección <strong>historico_mensual</strong> está vacía. Haz clic en <strong>"Desbloquear Histórico"</strong> y luego en <strong>"Cargar 12 Meses Base de Fábrica Óptica en Firebase"</strong>.</td></tr>`;
        return;
    }

    const mult = parseFloat(document.getElementById('pres-mult')?.value) || 3;
    tbody.innerHTML = state.historicalMonthly.map((m, idx) => {
        const ventasBase = ((Number(m.gif) || 0) + (Number(m.mo) || 0)) * mult;
        const accionHTML = state.isHistoricoLocked
            ? `<span class="px-2 py-1 bg-slate-100 text-slate-500 font-bold text-[11px] rounded inline-block">🔒 Cerrado</span>`
            : `<button type="button" onclick="cargarMesEnFormularioHistorico(${idx})" class="px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-[11px] rounded">Editar</button>`;

        return `
            <tr class="hover:bg-slate-50">
                <td class="p-2 border font-bold text-blue-950">${m.mes} ${m.anio}</td>
                <td class="p-2 border font-bold text-indigo-800">${m.trimestre}</td>
                <td class="p-2 border font-mono">${formatMXN(m.gif)}</td>
                <td class="p-2 border font-mono">${formatMXN(m.mo)}</td>
                <td class="p-2 border font-mono">${formatMXN(m.admon)}</td>
                <td class="p-2 border font-mono">${formatMXN(m.venta)}</td>
                <td class="p-2 border font-mono">${formatMXN(m.distrib)}</td>
                <td class="p-2 border font-mono font-extrabold text-emerald-700">${formatMXN(ventasBase)}</td>
                <td class="p-2 border">${accionHTML}</td>
            </tr>
        `;
    }).join('');
}

window.cargarMesEnFormularioHistorico = function(idx) {
    if (state.isHistoricoLocked) {
        return showToast("Desbloquea el Histórico Contable para editar un registro.", "info");
    }
    const m = state.historicalMonthly[idx];
    if (!m) return;
    document.getElementById('hist-mes').value = m.mes;
    document.getElementById('hist-anio').value = m.anio;
    document.getElementById('hist-gif').value = m.gif;
    document.getElementById('hist-mo').value = m.mo;
    document.getElementById('hist-admon').value = m.admon;
    document.getElementById('hist-venta').value = m.venta;
    document.getElementById('hist-distrib').value = m.distrib;
    showToast(`Mes ${m.mes} cargado arriba para edición.`, "info");
};


function obtenerSumaBasePorHorizonte(horizonte, fuente) {
    const ciclo = OPTICAL_MARKET_CYCLES[horizonte] || OPTICAL_MARKET_CYCLES.Q3;
    const numMeses = ciclo.numMeses;

    if (fuente === 'HISTORICO_BD' && state.historicalMonthly.length > 0) {
        const filtrados = state.historicalMonthly.filter(m => ciclo.meses.includes(m.mes));
        if (filtrados.length > 0) {
            const suma = filtrados.reduce((acc, m) => ({
                gif: acc.gif + (Number(m.gif) || 0),
                mo: acc.mo + (Number(m.mo) || 0),
                admon: acc.admon + (Number(m.admon) || 0),
                venta: acc.venta + (Number(m.venta) || 0),
                distrib: acc.distrib + (Number(m.distrib) || 0)
            }), { gif: 0, mo: 0, admon: 0, venta: 0, distrib: 0 });

            // Escalar proporcionalmente si aún no están cargados todos los meses del trimestre/año
            const factorEscala = numMeses / filtrados.length;
            return {
                gif: suma.gif * factorEscala,
                mo: suma.mo * factorEscala,
                admon: suma.admon * factorEscala,
                venta: suma.venta * factorEscala,
                distrib: suma.distrib * factorEscala
            };
        }
    }

    // Respaldo con datos vivos de Planta (Módulos 2 y 4) multiplicados por meses del horizonte
    const prorr = calcularYRenderizarProrrateos();
    let moMensual = 0;
    state.workers.forEach(w => {
        moMensual += ((Number(w.salarioIntegradoAnual) || 0) / 12);
    });
    if (moMensual === 0) moMensual = 159301.93;

    const gifMensual = prorr.gifTotalProduccion || 98449.00;
    const admonMensual = prorr.gastosAdminTotal || 44041.93;
    const ventaMensual = prorr.gastosVentaTotal || 11804.00;
    const distribMensual = prorr.gastosDistrTotal || 49255.25;

    return {
        gif: gifMensual * numMeses,
        mo: moMensual * numMeses,
        admon: admonMensual * numMeses,
        venta: ventaMensual * numMeses,
        distrib: distribMensual * numMeses
    };
}

window.aplicarCicloOpticoSeleccionado = function(silencioso = false) {
    if (typeof OPTICAL_MARKET_CYCLES === 'undefined') return;

    const horizonte = document.getElementById('pres-horizonte')?.value || 'Q3';
    const fuente = document.getElementById('pres-fuente-base')?.value || 'HISTORICO_BD';
    const escenario = document.getElementById('pres-escenario-macro')?.value || 'REALISTA';

    const ciclo = OPTICAL_MARKET_CYCLES[horizonte] || OPTICAL_MARKET_CYCLES.Q3;
    const paramsCiclo = ciclo[escenario] || ciclo.REALISTA;
    const baseMontos = obtenerSumaBasePorHorizonte(horizonte, fuente);

    document.getElementById('pres-gif').value = baseMontos.gif.toFixed(2);
    document.getElementById('pres-mo').value = baseMontos.mo.toFixed(2);
    document.getElementById('pres-admon').value = baseMontos.admon.toFixed(2);
    document.getElementById('pres-venta').value = baseMontos.venta.toFixed(2);
    document.getElementById('pres-distrib').value = baseMontos.distrib.toFixed(2);

    document.getElementById('pres-f-ajuste').value = paramsCiclo.fAjuste;
    document.getElementById('pres-f-cambio').value = paramsCiclo.fCambio;
    document.getElementById('pres-f-crec').value = paramsCiclo.fCrec;
    document.getElementById('pres-e-inf').value = paramsCiclo.eInf;
    document.getElementById('pres-e-dolar').value = paramsCiclo.eDolar;
    document.getElementById('pres-e-pib').value = paramsCiclo.ePib;
    document.getElementById('pres-d-admin').value = paramsCiclo.dAdmin;
    document.getElementById('pres-inv-final').value = paramsCiclo.invFinal;

    const txtDesc = document.getElementById('txt-descripcion-ciclo');
    if (txtDesc) txtDesc.innerText = ciclo.descripcion;

    const badgeEst = document.getElementById('badge-estacionalidad');
    if (badgeEst) badgeEst.innerText = `${ciclo.cicloCorto} • Escenario ${escenario}`;

    const badgeOrigen = document.getElementById('pres-badge-origen');
    if (badgeOrigen) badgeOrigen.innerText = `Periodo: ${horizonte} (${ciclo.numMeses} Meses)`;

    recalcularPresupuestoUI();
    if (!silencioso) {
        showToast(`Ciclo ${ciclo.nombre} aplicado al presupuesto.`, "info");
    }
};

window.sincronizarDatosFirebasePresupuesto = function(silencioso = false) {
    document.getElementById('pres-fuente-base').value = 'PLANTA_VIVO';
    aplicarCicloOpticoSeleccionado(true);
    if (!silencioso) {
        showToast("Costos actuales de Planta (Mód. 2 y 4) importados al periodo seleccionado.");
    }
};

window.resetFactoresPresupuesto = function() {
    document.getElementById('pres-f-ajuste').value = 0;
    document.getElementById('pres-f-cambio').value = 0;
    document.getElementById('pres-f-crec').value = 0;
    document.getElementById('pres-e-inf').value = 0;
    document.getElementById('pres-e-dolar').value = 0;
    document.getElementById('pres-e-pib').value = 0;
    document.getElementById('pres-d-admin').value = 0;
    recalcularPresupuestoUI();
    showToast("Factores F, E y D restablecidos a 0.", "info");
};

function renderPanoramaTrimestral(prodKey, escenario, fuente, mult, tasaISR, incluirPTU) {
    const tbody = document.getElementById('tb-pres-trimestres');
    if (!tbody || typeof BudgetEngine === 'undefined') return;

    const costeoProd = state.ultimoCosteoUnitario[prodKey] || { mp: 0, mo: 0, gif: 0 };
    const trimestres = ['Q1', 'Q2', 'Q3', 'Q4'];

    let sumV = 0, sumPV = 0, sumCosto = 0, sumUNeta = 0, sumUnid = 0;
    let html = '';

    trimestres.forEach(q => {
        const ciclo = OPTICAL_MARKET_CYCLES[q];
        const pCiclo = ciclo[escenario] || ciclo.REALISTA;
        const base = obtenerSumaBasePorHorizonte(q, fuente);

        const r = BudgetEngine.calculate({
            gif: base.gif, mo: base.mo, admon: base.admon, venta: base.venta, distrib: base.distrib,
            multiplicadorVentas: mult, tasaISR, incluirPTU,
            inventarioFinalDeseado: pCiclo.invFinal,
            fAjuste: pCiclo.fAjuste, fCambio: pCiclo.fCambio, fCrecimiento: pCiclo.fCrec,
            eInflacion: pCiclo.eInf, eDolar: pCiclo.eDolar, ePib: pCiclo.ePib,
            dAdminPct: pCiclo.dAdmin,
            unitMP: costeoProd.mp, unitMO: costeoProd.mo, unitGIF: costeoProd.gif
        });

        sumV += r.historia.ventasHistoricas;
        sumPV += r.formula.pv;
        sumCosto += r.derivada.presupuestoCostoProduccion;
        sumUNeta += r.derivada.utilidadNetaProy;
        sumUnid += r.derivada.unidadesProducir;

        const isSelected = document.getElementById('pres-horizonte')?.value === q;
        html += `
            <tr class="${isSelected ? 'bg-blue-50 font-bold' : 'hover:bg-slate-50'}">
                <td class="p-2 border text-left font-bold text-blue-950">${ciclo.nombre}</td>
                <td class="p-2 border text-indigo-900 font-semibold">${ciclo.cicloCorto}</td>
                <td class="p-2 border text-right font-mono">${formatMXN(r.historia.ventasHistoricas)}</td>
                <td class="p-2 border text-right font-mono font-extrabold text-emerald-700">${formatMXN(r.formula.pv)}</td>
                <td class="p-2 border text-right font-mono">${formatMXN(r.derivada.presupuestoCostoProduccion)}</td>
                <td class="p-2 border text-right font-mono font-bold">${formatMXN(r.derivada.utilidadNetaProy)}</td>
                <td class="p-2 border font-extrabold">${r.derivada.unidadesProducir.toLocaleString('es-MX')} pzas</td>
            </tr>
        `;
    });

    html += `
        <tr class="bg-blue-950 text-white font-black">
            <td colspan="2" class="p-2.5 border text-right uppercase">CONSOLIDADO ANUAL 2026 (SUMA Q1 – Q4):</td>
            <td class="p-2.5 border text-right font-mono">${formatMXN(sumV)}</td>
            <td class="p-2.5 border text-right font-mono text-emerald-400">${formatMXN(sumPV)}</td>
            <td class="p-2.5 border text-right font-mono">${formatMXN(sumCosto)}</td>
            <td class="p-2.5 border text-right font-mono text-emerald-300">${formatMXN(sumUNeta)}</td>
            <td class="p-2.5 border">${sumUnid.toLocaleString('es-MX')} pzas</td>
        </tr>
    `;

    tbody.innerHTML = html;
}

window.recalcularPresupuestoUI = function() {
    if (typeof BudgetEngine === 'undefined') return;

    const horizonte = document.getElementById('pres-horizonte')?.value || 'Q3';
    const fuente = document.getElementById('pres-fuente-base')?.value || 'HISTORICO_BD';
    const escenario = document.getElementById('pres-escenario-macro')?.value || 'REALISTA';
    const prodKey = document.getElementById('pres-producto-derivado')?.value || 'lente';

    const selectCosteo = document.getElementById('select-producto-costeo');
    if (selectCosteo && selectCosteo.value !== prodKey) {
        selectCosteo.value = prodKey;
    }
    actualizarCedulaProducto();
    const costeoProd = state.ultimoCosteoUnitario[prodKey] || { mp: 0, mo: 0, gif: 0, total: 0, nombre: 'Producto' };

    const mult = document.getElementById('pres-mult')?.value || 3;
    const tasaISR = document.getElementById('pres-isr')?.value || 30;
    const incluirPTU = document.getElementById('pres-ptu')?.checked;

    const res = BudgetEngine.calculate({
        gif: document.getElementById('pres-gif')?.value,
        mo: document.getElementById('pres-mo')?.value,
        admon: document.getElementById('pres-admon')?.value,
        venta: document.getElementById('pres-venta')?.value,
        distrib: document.getElementById('pres-distrib')?.value,
        multiplicadorVentas: mult,
        tasaISR,
        incluirPTU,
        inventarioFinalDeseado: document.getElementById('pres-inv-final')?.value,
        fAjuste: document.getElementById('pres-f-ajuste')?.value,
        fCambio: document.getElementById('pres-f-cambio')?.value,
        fCrecimiento: document.getElementById('pres-f-crec')?.value,
        eInflacion: document.getElementById('pres-e-inf')?.value,
        eDolar: document.getElementById('pres-e-dolar')?.value,
        ePib: document.getElementById('pres-e-pib')?.value,
        dAdminPct: document.getElementById('pres-d-admin')?.value,
        unitMP: costeoProd.mp,
        unitMO: costeoProd.mo,
        unitGIF: costeoProd.gif
    });

    const h = res.historia;
    const f = res.formula;
    const d = res.derivada;

    const cicloObj = OPTICAL_MARKET_CYCLES[horizonte] || OPTICAL_MARKET_CYCLES.Q3;
    const tituloMes = document.getElementById('pres-titulo-mes');
    if (tituloMes) tituloMes.innerText = cicloObj.nombre.toUpperCase();

    // Actualizar KPIs
    document.getElementById('pres-kpi-v').innerText = `${formatMXN(h.ventasHistoricas)}`;
    document.getElementById('pres-kpi-pv').innerText = `${formatMXN(f.pv)}`;
    document.getElementById('pres-kpi-unidades').innerText = `${d.unidadesProducir.toLocaleString('es-MX')} Pzas`;
    document.getElementById('pres-kpi-uneta').innerText = `${formatMXN(d.utilidadNetaProy)}`;

    // Renderizar Tabla Panorámica Trimestral (Q1 - Q4 + Anual)
    renderPanoramaTrimestral(prodKey, escenario, fuente, mult, tasaISR, incluirPTU);

    // 1. Tabla Estado de Resultados Comparativo
    const tbodyEdo = document.getElementById('tb-pres-edo');
    if (tbodyEdo) {
        const labelImp = h.tasaPTU > 0 ? `ISR (${h.tasaISR}%) + PTU (${h.tasaPTU}%)` : `ISR (${h.tasaISR}%)`;
        tbodyEdo.innerHTML = `
            <tr class="bg-blue-50/70 font-extrabold text-blue-950">
                <td class="border border-slate-300 p-2 text-left">Ventas (V / PV)</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(h.ventasHistoricas)}</td>
                <td class="border border-slate-300 p-2 text-right font-mono bg-blue-100/70">${formatMXN(f.pv)}</td>
            </tr>
            <tr>
                <td class="border border-slate-300 p-2 text-left pl-4 text-slate-600">• GIF / Costos Producción</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-600">${formatMXN(h.gif)}</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-600">${formatMXN(d.presupuestoGIF)}</td>
            </tr>
            <tr>
                <td class="border border-slate-300 p-2 text-left pl-4 text-slate-600">• Mano de Obra Directa</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-600">${formatMXN(h.mo)}</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-600">${formatMXN(d.presupuestoMO)}</td>
            </tr>
            <tr class="font-bold text-slate-800 bg-slate-50">
                <td class="border border-slate-300 p-2 text-left">(-) Costo de Ventas / Producción</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(h.totalCostos)}</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(d.costoVentasProyectado)}</td>
            </tr>
            <tr class="font-extrabold text-blue-950 bg-slate-100">
                <td class="border border-slate-300 p-2 text-left">(=) Utilidad Bruta</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(h.utilidadBruta)}</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(d.utilidadBrutaProy)}</td>
            </tr>
            <tr>
                <td class="border border-slate-300 p-2 text-left pl-4 text-slate-600">• Gastos de Administración</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-600">${formatMXN(h.admon)}</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-500">—</td>
            </tr>
            <tr>
                <td class="border border-slate-300 p-2 text-left pl-4 text-slate-600">• Gastos de Venta</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-600">${formatMXN(h.venta)}</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-500">—</td>
            </tr>
            <tr>
                <td class="border border-slate-300 p-2 text-left pl-4 text-slate-600">• Gastos de Distribución</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-600">${formatMXN(h.distrib)}</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-500">—</td>
            </tr>
            <tr class="font-bold text-slate-800 bg-slate-50">
                <td class="border border-slate-300 p-2 text-left">(-) Total Gastos de Operación</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(h.totalGastosOp)}</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(d.gastosOpProy)}</td>
            </tr>
            <tr class="font-extrabold text-indigo-950 bg-slate-100">
                <td class="border border-slate-300 p-2 text-left">(=) Utilidad Antes de Impuestos</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(h.uai)}</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(d.uaiProy)}</td>
            </tr>
            <tr>
                <td class="border border-slate-300 p-2 text-left text-slate-600">(-) ${labelImp}</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-red-700">${formatMXN(h.isr + h.ptu)}</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-red-700">${formatMXN(d.isrProy + d.ptuProy)}</td>
            </tr>
            <tr class="font-black text-emerald-900 bg-emerald-100">
                <td class="border border-slate-300 p-2 text-left">(=) UTILIDAD NETA</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(h.utilidadNeta)}</td>
                <td class="border border-slate-300 p-2 text-right font-mono bg-emerald-200/80">${formatMXN(d.utilidadNetaProy)}</td>
            </tr>
        `;
    }

    // 2. Desarrollo Paso a Paso de la Fórmula
    const pasosContainer = document.getElementById('pres-pasos-formula');
    if (pasosContainer) {
        const signoF = f.fNeto >= 0 ? '+' : '-';
        const signoE = f.ePctTotal >= 0 ? '+' : '';
        const signoD = f.dAdminPct >= 0 ? '+' : '';

        pasosContainer.innerHTML = `
            <div class="p-2.5 rounded-lg bg-slate-50 border border-slate-300">
                <div class="flex justify-between items-center mb-1">
                    <span class="font-extrabold text-blue-950 text-xs">Paso 1: Ajuste por Mercado y Línea (V ± F)</span>
                    <span class="px-2 py-0.5 rounded bg-blue-100 text-blue-900 text-[10px] font-bold">F neto: ${formatMXN(f.fNeto)}</span>
                </div>
                <p class="font-mono text-xs text-slate-800">${formatMXN(f.V)} ${signoF} ${formatMXN(Math.abs(f.fNeto))} = <strong class="text-blue-950">${formatMXN(f.baseVF)}</strong></p>
            </div>

            <div class="p-2.5 rounded-lg bg-amber-50 border border-amber-300">
                <div class="flex justify-between items-center mb-1">
                    <span class="font-extrabold text-amber-950 text-xs">Paso 2: Ciclos Económicos Ópticos (× E)</span>
                    <span class="px-2 py-0.5 rounded bg-amber-200 text-amber-950 text-[10px] font-bold">E = ${f.factorE.toFixed(4)} (${signoE}${f.ePctTotal.toFixed(2)}%)</span>
                </div>
                <p class="font-mono text-xs text-slate-800">${formatMXN(f.baseVF)} × ${f.factorE.toFixed(4)} = <strong class="text-amber-950">${formatMXN(f.baseVFE)}</strong></p>
            </div>

            <div class="p-2.5 rounded-lg bg-emerald-50 border border-emerald-300">
                <div class="flex justify-between items-center mb-1">
                    <span class="font-extrabold text-emerald-950 text-xs">Paso 3: Estacionalidad y Campañas (× D)</span>
                    <span class="px-2 py-0.5 rounded bg-emerald-200 text-emerald-950 text-[10px] font-bold">D = ${f.factorD.toFixed(4)} (${signoD}${f.dAdminPct.toFixed(2)}%)</span>
                </div>
                <p class="font-mono text-xs text-slate-800">${formatMXN(f.baseVFE)} × ${f.factorD.toFixed(4)} = <strong class="text-emerald-900 text-sm">${formatMXN(f.pv)}</strong></p>
            </div>

            <div class="p-3.5 rounded-xl bg-blue-950 text-white flex justify-between items-center shadow">
                <div>
                    <span class="text-[10px] uppercase tracking-wider text-blue-300 font-bold block">Ventas Presupuestadas (${horizonte})</span>
                    <span class="text-xs font-mono text-blue-200">PV = [(V ± F) × E] × D</span>
                </div>
                <span class="text-lg font-black text-emerald-400 font-mono">${formatMXN(f.pv)}</span>
            </div>
        `;
    }

    // 3. Cédula Derivada del Presupuesto Maestro
    const subDerivada = document.getElementById('pres-derivada-subtitulo');
    if (subDerivada) {
        subDerivada.innerText = `${costeoProd.nombre} • Costo Unitario: ${formatMXN(d.costoUnitarioTotal)} | Precio Venta Unit.: ${formatMXN(d.precioVentaUnitario)}`;
    }

    const tbodyDerivada = document.getElementById('tb-pres-derivada');
    if (tbodyDerivada) {
        tbodyDerivada.innerHTML = `
            <tr>
                <td class="p-2 border text-left font-bold text-blue-950">1. Presupuesto de Volumen de Ventas</td>
                <td class="p-2 border">PV ÷ Precio Venta Unitario</td>
                <td class="p-2 border font-mono">${formatMXN(f.pv)} ÷ ${formatMXN(d.precioVentaUnitario)}</td>
                <td class="p-2 border text-right font-extrabold">${d.unidadesVender.toLocaleString('es-MX')} Unidades</td>
            </tr>
            <tr class="bg-blue-50/60">
                <td class="p-2 border text-left font-bold text-blue-950">2. Presupuesto de Producción Requerida</td>
                <td class="p-2 border">Unid. Vender + Inv. Final Deseado</td>
                <td class="p-2 border font-mono">${d.unidadesVender} + ${d.inventarioFinalDeseado} pzas</td>
                <td class="p-2 border text-right font-black text-blue-950">${d.unidadesProducir.toLocaleString('es-MX')} Unidades</td>
            </tr>
            <tr>
                <td class="p-2 border text-left">3. Presupuesto de Requerimiento de Materia Prima (MP)</td>
                <td class="p-2 border">Unid. Producir × Costo Unit. MP</td>
                <td class="p-2 border font-mono">${d.unidadesProducir} × ${formatMXN(d.unitMP)}</td>
                <td class="p-2 border text-right font-bold">${formatMXN(d.presupuestoMP)}</td>
            </tr>
            <tr>
                <td class="p-2 border text-left">4. Presupuesto de Mano de Obra Directa (MOD)</td>
                <td class="p-2 border">Unid. Producir × Costo Unit. MO</td>
                <td class="p-2 border font-mono">${d.unidadesProducir} × ${formatMXN(d.unitMO)}</td>
                <td class="p-2 border text-right font-bold">${formatMXN(d.presupuestoMO)}</td>
            </tr>
            <tr>
                <td class="p-2 border text-left">5. Presupuesto de Gastos Indirectos (GIF)</td>
                <td class="p-2 border">Unid. Producir × Cuota GIF Unit.</td>
                <td class="p-2 border font-mono">${d.unidadesProducir} × ${formatMXN(d.unitGIF)}</td>
                <td class="p-2 border text-right font-bold">${formatMXN(d.presupuestoGIF)}</td>
            </tr>
            <tr class="bg-slate-100 font-extrabold text-blue-950">
                <td colspan="3" class="p-2 border text-right">COSTO TOTAL DE PRODUCCIÓN PRESUPUESTADO (MP + MO + GIF):</td>
                <td class="p-2 border text-right font-mono text-sm">${formatMXN(d.presupuestoCostoProduccion)}</td>
            </tr>
        `;
    }

    state.ultimoPresupuestoCalculado = {
        horizonte,
        fuente,
        escenario,
        etiquetaPeriodo: `${horizonte} (${escenario})`,
        prodKey,
        productoNombre: costeoProd.nombre,
        inputs: {
            gif: document.getElementById('pres-gif')?.value,
            mo: document.getElementById('pres-mo')?.value,
            admon: document.getElementById('pres-admon')?.value,
            venta: document.getElementById('pres-venta')?.value,
            distrib: document.getElementById('pres-distrib')?.value,
            mult: document.getElementById('pres-mult')?.value,
            isr: document.getElementById('pres-isr')?.value,
            ptu: document.getElementById('pres-ptu')?.checked,
            invFinal: document.getElementById('pres-inv-final')?.value,
            fAjuste: document.getElementById('pres-f-ajuste')?.value,
            fCambio: document.getElementById('pres-f-cambio')?.value,
            fCrec: document.getElementById('pres-f-crec')?.value,
            eInf: document.getElementById('pres-e-inf')?.value,
            eDolar: document.getElementById('pres-e-dolar')?.value,
            ePib: document.getElementById('pres-e-pib')?.value,
            dAdmin: document.getElementById('pres-d-admin')?.value
        },
        resumen: {
            V: h.ventasHistoricas,
            fNeto: f.fNeto,
            factorE: f.factorE,
            factorD: f.factorD,
            pv: f.pv,
            unidadesProducir: d.unidadesProducir,
            utilidadNetaProy: d.utilidadNetaProy
        }
    };
};

// =========================================================================
// PERSISTENCIA DE ESCENARIOS PRESUPUESTALES EN FIREBASE
// =========================================================================
window.guardarPresupuestoFirebase = async function() {
    if (!state.ultimoPresupuestoCalculado) return;

    const payload = {
        ...state.ultimoPresupuestoCalculado,
        fechaTexto: `${new Date().toLocaleDateString('es-MX')} ${new Date().toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit'})}`,
        createdAt: new Date()
    };

    try {
        await window.fs.addDoc(window.fs.collection(window.db, "presupuestos_guardados"), payload);
        await loadBudgetsFromFirebase();
        showToast("Escenario presupuestal guardado en Firebase.");
    } catch (error) {
        console.error("Error al guardar presupuesto:", error);
        showToast("No se pudo guardar el presupuesto en Firebase.", "error");
    }
};

async function loadBudgetsFromFirebase() {
    const tbody = document.getElementById('tb-presupuestos-guardados');
    try {
        const snap = await window.fs.getDocs(window.fs.collection(window.db, "presupuestos_guardados"));
        state.savedBudgets = [];
        snap.forEach(doc => state.savedBudgets.push({ id: doc.id, ...doc.data() }));

        state.savedBudgets.sort((a, b) => {
            const dA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
            const dB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
            return dB - dA;
        });

        if (!tbody) return;
        if (state.savedBudgets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-3 text-slate-400">Aún no hay escenarios guardados en Firebase.</td></tr>`;
            return;
        }

        tbody.innerHTML = state.savedBudgets.map((b, idx) => `
            <tr class="hover:bg-slate-50">
                <td class="p-2 border text-slate-600">${b.fechaTexto || 'N/A'}</td>
                <td class="p-2 border font-bold text-blue-950">${b.etiquetaPeriodo || b.horizonte}</td>
                <td class="p-2 border font-mono">${formatMXN(b.resumen?.V || 0)}</td>
                <td class="p-2 border text-[11px] font-mono">F: ${formatMXN(b.resumen?.fNeto || 0)} | E: ${(b.resumen?.factorE || 1).toFixed(3)} | D: ${(b.resumen?.factorD || 1).toFixed(3)}</td>
                <td class="p-2 border font-mono font-extrabold text-emerald-700">${formatMXN(b.resumen?.pv || 0)}</td>
                <td class="p-2 border font-bold">${(b.resumen?.unidadesProducir || 0).toLocaleString('es-MX')} pzas</td>
                <td class="p-2 border">
                    <button onclick="cargarEscenarioGuardado(${idx})" class="px-2.5 py-1 bg-blue-950 hover:bg-blue-800 text-white font-bold text-[11px] rounded transition">Cargar</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error("Error al cargar presupuestos guardados:", e);
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="p-3 text-red-500">Error al leer historial de presupuestos.</td></tr>`;
    }
}

window.cargarEscenarioGuardado = function(index) {
    const b = state.savedBudgets[index];
    if (!b || !b.inputs) return;

    const inp = b.inputs;
    if (b.horizonte) document.getElementById('pres-horizonte').value = b.horizonte;
    if (b.fuente) document.getElementById('pres-fuente-base').value = b.fuente;
    if (b.escenario) document.getElementById('pres-escenario-macro').value = b.escenario;
    if (b.prodKey) document.getElementById('pres-producto-derivado').value = b.prodKey;

    document.getElementById('pres-gif').value = inp.gif;
    document.getElementById('pres-mo').value = inp.mo;
    document.getElementById('pres-admon').value = inp.admon;
    document.getElementById('pres-venta').value = inp.venta;
    document.getElementById('pres-distrib').value = inp.distrib;
    document.getElementById('pres-mult').value = inp.mult;
    document.getElementById('pres-isr').value = inp.isr;
    document.getElementById('pres-ptu').checked = Boolean(inp.ptu);
    document.getElementById('pres-inv-final').value = inp.invFinal || 150;
    document.getElementById('pres-f-ajuste').value = inp.fAjuste;
    document.getElementById('pres-f-cambio').value = inp.fCambio;
    document.getElementById('pres-f-crec').value = inp.fCrec;
    document.getElementById('pres-e-inf').value = inp.eInf;
    document.getElementById('pres-e-dolar').value = inp.eDolar;
    document.getElementById('pres-e-pib').value = inp.ePib || 2.7;
    document.getElementById('pres-d-admin').value = inp.dAdmin;

    recalcularPresupuestoUI();
    showToast(`Escenario "${b.etiquetaPeriodo}" cargado en pantalla.`);
};

// =========================================================================
// IMPRESIÓN INDIVIDUAL AJUSTADA (MODO HORIZONTAL Y CELDAS ADAPTABLES)
// =========================================================================
window.printSpecificReport = function(btn, tituloReporte = "Documento") {
    const reportCard = btn.closest('.report-card');
    if (!reportCard) return;

    const clone = reportCard.cloneNode(true);
    clone.querySelectorAll('button, .no-print').forEach(b => b.remove());

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showToast("Permite las ventanas emergentes (pop-ups) en tu navegador para imprimir.", "error");
        return;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <title>${tituloReporte}</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                @page { size: landscape; margin: 12mm; }
                body { padding: 15px; font-family: sans-serif; }
                * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                .overflow-x-auto { overflow: visible !important; width: 100% !important; }
                table { width: 100% !important; table-layout: auto !important; }
                th, td {
                    font-size: 8.5px !important;
                    padding: 4px !important;
                    white-space: normal !important;
                    word-wrap: break-word !important;
                }
                .whitespace-nowrap { white-space: normal !important; }
                table { page-break-inside: auto; }
                tr { page-break-inside: avoid; page-break-after: auto; }
            </style>
        </head>
        <body>
            <div class="mb-4 border-b-2 border-slate-300 pb-2 flex justify-between items-end">
                <div>
                    <h2 class="text-xl font-black text-blue-950">OptiCost ERP — Fábrica de Lentes</h2>
                    <p class="text-xs text-slate-600 font-bold">${tituloReporte}</p>
                </div>
                <p class="text-[10px] text-slate-500">Emitido: ${new Date().toLocaleDateString('es-MX')} ${new Date().toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit'})}</p>
            </div>
            ${clone.outerHTML}
            <script>
                setTimeout(() => {
                    window.print();
                    window.close();
                }, 900);
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
};