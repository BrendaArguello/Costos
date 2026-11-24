// =========================================================================
// MOTOR DE VALUACIÓN DE INVENTARIOS (KARDEX: PEPS, UEPS, PROMEDIO)
// =========================================================================
class InventoryEngine {

    static processMovements(product, rawMovements) {
        let existencias = 0;
        let saldo = 0;
        let capas = []; 

        const renderedRows = [];
        let totalDebe = 0;
        let totalHaber = 0;

        for (const mov of rawMovements) {
            if (mov.tipo === 'ENTRADA') {
                existencias += mov.cantidad;
                const debeRow = Number((mov.cantidad * mov.costoUnitario).toFixed(2));
                saldo += debeRow;
                totalDebe += debeRow;

                capas.push({ cantidad: mov.cantidad, costo: mov.costoUnitario });

                renderedRows.push({
                    isSubRow: false,
                    fecha: mov.fecha,
                    ref: mov.ref,
                    concepto: mov.concepto,
                    entradas: mov.cantidad,
                    salidas: '',
                    existencia: existencias,
                    costoUnitario: mov.costoUnitario.toFixed(2),
                    debe: debeRow.toFixed(2),
                    haber: '',
                    saldo: saldo.toFixed(2)
                });

            } else if (mov.tipo === 'SALIDA') {
                if (mov.cantidad > existencias) {
                    if (typeof showToast === 'function') {
                        showToast(`Stock insuficiente para ${product.name} (${existencias} ${product.unit} disponibles).`, 'error');
                    }
                    continue;
                }

                if (product.metodo === 'PROMEDIO') {
                    const costoPromedio = Number((saldo / existencias).toFixed(2));
                    existencias -= mov.cantidad;
                    const haberRow = Number((mov.cantidad * costoPromedio).toFixed(2));
                    saldo = Number((saldo - haberRow).toFixed(2));
                    totalHaber += haberRow;

                    renderedRows.push({
                        isSubRow: false,
                        fecha: mov.fecha,
                        ref: mov.ref,
                        concepto: mov.concepto,
                        entradas: '',
                        salidas: mov.cantidad,
                        existencia: existencias,
                        costoUnitario: costoPromedio.toFixed(2),
                        debe: '',
                        haber: haberRow.toFixed(2),
                        saldo: saldo.toFixed(2)
                    });

                } else if (product.metodo === 'PEPS' || product.metodo === 'UEPS') {
                    let cantidadPendiente = mov.cantidad;
                    let esPrimerRenglon = true;

                    while (cantidadPendiente > 0 && capas.length > 0) {
                        const index = product.metodo === 'PEPS' ? 0 : capas.length - 1;
                        const capaActual = capas[index];

                        const unidadesAgotadas = Math.min(capaActual.cantidad, cantidadPendiente);
                        
                        capaActual.cantidad -= unidadesAgotadas;
                        cantidadPendiente -= unidadesAgotadas;
                        existencias -= unidadesAgotadas;

                        const haberSub = Number((unidadesAgotadas * capaActual.costo).toFixed(2));
                        saldo = Number((saldo - haberSub).toFixed(2));
                        totalHaber += haberSub;

                        renderedRows.push({
                            isSubRow: !esPrimerRenglon,
                            fecha: esPrimerRenglon ? mov.fecha : '',
                            ref: esPrimerRenglon ? mov.ref : '',
                            concepto: esPrimerRenglon ? mov.concepto : `(Restante a Lote $${capaActual.costo.toFixed(2)})`,
                            entradas: '',
                            salidas: unidadesAgotadas,
                            existencia: existencias,
                            costoUnitario: capaActual.costo.toFixed(2),
                            debe: '',
                            haber: haberSub.toFixed(2),
                            saldo: saldo.toFixed(2)
                        });

                        esPrimerRenglon = false;

                        if (capaActual.cantidad === 0) {
                            capas.splice(index, 1);
                        }
                    }
                }
            }

            saldo = Number(saldo.toFixed(2));
        }

        return { rows: renderedRows, totalDebe, totalHaber, saldoFinal: saldo };
    }
}

// =========================================================================
// PLANTILLA INICIAL DE 12 MESES PARA BD HISTÓRICA DE LA FÁBRICA EN FIREBASE
// (Refleja estacionalidad real de una planta óptica mexicana)
// =========================================================================
const OPTICAL_HISTORICAL_TEMPLATE = [
    { mes: 'ENERO',      orden: 1,  trimestre: 'Q1', anio: 2026, gif: 84200.00,  mo: 159301.93, admon: 41200.00, venta: 14800.00, distrib: 39500.00 },
    { mes: 'FEBRERO',    orden: 2,  trimestre: 'Q1', anio: 2026, gif: 85900.00,  mo: 159301.93, admon: 41500.00, venta: 15400.00, distrib: 40800.00 },
    { mes: 'MARZO',      orden: 3,  trimestre: 'Q1', anio: 2026, gif: 88400.00,  mo: 159301.93, admon: 42100.00, venta: 16900.00, distrib: 42100.00 },
    { mes: 'ABRIL',      orden: 4,  trimestre: 'Q2', anio: 2026, gif: 91800.00,  mo: 159301.93, admon: 42800.00, venta: 18900.00, distrib: 44300.00 },
    { mes: 'MAYO',       orden: 5,  trimestre: 'Q2', anio: 2026, gif: 95400.00,  mo: 159301.93, admon: 43400.00, venta: 21200.00, distrib: 46100.00 },
    { mes: 'JUNIO',      orden: 6,  trimestre: 'Q2', anio: 2026, gif: 93600.00,  mo: 159301.93, admon: 43100.00, venta: 19800.00, distrib: 45200.00 },
    { mes: 'JULIO',      orden: 7,  trimestre: 'Q3', anio: 2026, gif: 104500.00, mo: 164800.00, admon: 45200.00, venta: 25400.00, distrib: 51200.00 },
    { mes: 'AGOSTO',     orden: 8,  trimestre: 'Q3', anio: 2026, gif: 111200.00, mo: 168500.00, admon: 46800.00, venta: 28900.00, distrib: 54600.00 },
    { mes: 'SEPTIEMBRE', orden: 9,  trimestre: 'Q3', anio: 2026, gif: 102800.00, mo: 162400.00, admon: 44900.00, venta: 24100.00, distrib: 49800.00 },
    { mes: 'OCTUBRE',    orden: 10, trimestre: 'Q4', anio: 2026, gif: 96800.00,  mo: 159301.93, admon: 43800.00, venta: 21500.00, distrib: 47900.00 },
    { mes: 'NOVIEMBRE',  orden: 11, trimestre: 'Q4', anio: 2026, gif: 98449.00,  mo: 159301.93, admon: 44041.93, venta: 22480.00, distrib: 49255.25 },
    { mes: 'DICIEMBRE',  orden: 12, trimestre: 'Q4', anio: 2026, gif: 101900.00, mo: 163200.00, admon: 45600.00, venta: 24800.00, distrib: 51400.00 }
];

// =========================================================================
// CICLOS MACROECONÓMICOS Y ESTACIONALES DEL SECTOR ÓPTICO MEXICANO (2026)
// =========================================================================
const OPTICAL_MARKET_CYCLES = {
    Q1: {
        nombre: 'Q1 (Ene–Mar) • Cuesta de Enero y Renovación Médica',
        meses: ['ENERO', 'FEBRERO', 'MARZO'],
        numMeses: 3,
        cicloCorto: 'Demanda Moderada (-1.5%)',
        descripcion: 'Q1 (Ene–Mar): Tras gastos decembrinos, la compra se concentra en reposición urgente de micas CR-39 graduadas. Inflación de insumos 4.4%, impacto USD/MXN +1.6%, PIB sector salud +2.5%.',
        REALISTA:    { fAjuste: -18000, fCambio: 12000, fCrec: 15000,  eInf: 4.4, eDolar: 1.6, ePib: 2.5, dAdmin: -1.5, invFinal: 90 },
        OPTIMISTA:   { fAjuste: -10000, fCambio: 22000, fCrec: 32000,  eInf: 3.9, eDolar: 0.8, ePib: 3.1, dAdmin: 2.0,  invFinal: 110 },
        CONSERVADOR: { fAjuste: -28000, fCambio: 5000,  fCrec: 6000,   eInf: 5.1, eDolar: 2.8, ePib: 1.9, dAdmin: -3.5, invFinal: 70 }
    },
    Q2: {
        nombre: 'Q2 (Abr–Jun) • Primavera, Día de Madres y Padre',
        meses: ['ABRIL', 'MAYO', 'JUNIO'],
        numMeses: 3,
        cicloCorto: 'Repunte Estacional (+4.5%)',
        descripcion: 'Q2 (Abr–Jun): Incrementa la radiación UV y campañas de regalo; sube la demanda de armazones de acetato y filtros antirreflejantes. Inflación 4.5%, USD/MXN +1.7%, PIB óptico +2.7%.',
        REALISTA:    { fAjuste: -12000, fCambio: 28000, fCrec: 38000,  eInf: 4.5, eDolar: 1.7, ePib: 2.7, dAdmin: 4.5,  invFinal: 120 },
        OPTIMISTA:   { fAjuste: -5000,  fCambio: 42000, fCrec: 55000,  eInf: 4.0, eDolar: 0.9, ePib: 3.2, dAdmin: 7.5,  invFinal: 140 },
        CONSERVADOR: { fAjuste: -20000, fCambio: 15000, fCrec: 18000,  eInf: 5.2, eDolar: 2.9, ePib: 2.0, dAdmin: 1.5,  invFinal: 95 }
    },
    Q3: {
        nombre: 'Q3 (Jul–Sep) • Regreso a Clases (Temporada Alta)',
        meses: ['JULIO', 'AGOSTO', 'SEPTIEMBRE'],
        numMeses: 3,
        cicloCorto: 'Pico Máximo Escolar (+9.5%)',
        descripcion: 'Q3 (Jul–Sep): Temporada más fuerte del año por exámenes visuales escolares y universitarios; máxima rotación de lentes graduados CR-39 y kits de limpieza. Inflación 4.5%, USD/MXN +1.8%, PIB +2.8%.',
        REALISTA:    { fAjuste: -15000, fCambio: 45000, fCrec: 68000,  eInf: 4.5, eDolar: 1.8, ePib: 2.8, dAdmin: 9.5,  invFinal: 160 },
        OPTIMISTA:   { fAjuste: -8000,  fCambio: 62000, fCrec: 92000,  eInf: 4.0, eDolar: 1.0, ePib: 3.4, dAdmin: 13.0, invFinal: 190 },
        CONSERVADOR: { fAjuste: -24000, fCambio: 25000, fCrec: 38000,  eInf: 5.3, eDolar: 3.0, ePib: 2.1, dAdmin: 5.0,  invFinal: 130 }
    },
    Q4: {
        nombre: 'Q4 (Oct–Dic) • Buen Fin y Cierre Decembrino',
        meses: ['OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'],
        numMeses: 3,
        cicloCorto: 'Alta Comercial Buen Fin (+7.5%)',
        descripcion: 'Q4 (Oct–Dic): Impulsado por Buen Fin, aguinaldos y prestaciones de fin de año en armazones de diseño y segundo par oftálmico. Inflación 4.6%, USD/MXN +2.0%, PIB +2.8%.',
        REALISTA:    { fAjuste: -14000, fCambio: 38000, fCrec: 56000,  eInf: 4.6, eDolar: 2.0, ePib: 2.8, dAdmin: 7.5,  invFinal: 140 },
        OPTIMISTA:   { fAjuste: -6000,  fCambio: 54000, fCrec: 78000,  eInf: 4.1, eDolar: 1.1, ePib: 3.3, dAdmin: 11.0, invFinal: 170 },
        CONSERVADOR: { fAjuste: -22000, fCambio: 20000, fCrec: 30000,  eInf: 5.4, eDolar: 3.2, ePib: 2.1, dAdmin: 3.5,  invFinal: 110 }
    },
    ANUAL: {
        nombre: 'ANUAL (12 Meses) • Consolidado Ejercicio 2026',
        meses: ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'],
        numMeses: 12,
        cicloCorto: 'Ciclo Completo Anual (+5.2%)',
        descripcion: 'Consolidado Anual 2026: Integra los 4 ciclos estacionales de la industria óptica mexicana con inflación promedio de insumos del 4.5%, ajuste cambiario USD/MXN +1.8% y crecimiento sectorial PIB +2.7%.',
        REALISTA:    { fAjuste: -59000, fCambio: 123000, fCrec: 177000, eInf: 4.5, eDolar: 1.8, ePib: 2.7, dAdmin: 5.2, invFinal: 220 },
        OPTIMISTA:   { fAjuste: -29000, fCambio: 180000, fCrec: 257000, eInf: 4.0, eDolar: 1.0, ePib: 3.3, dAdmin: 8.5, invFinal: 260 },
        CONSERVADOR: { fAjuste: -94000, fCambio: 65000,  fCrec: 92000,  eInf: 5.3, eDolar: 3.0, ePib: 2.0, dAdmin: 1.8, invFinal: 175 }
    }
};

// =========================================================================
// MOTOR DE PRESUPUESTO MAESTRO (VENTAS PV + CÉDULA DERIVADA + TRIMESTRES)
// =========================================================================
class BudgetEngine {

    static calculate(params) {
        const gif = Number(params.gif) || 0;
        const mo = Number(params.mo) || 0;
        const admon = Number(params.admon) || 0;
        const venta = Number(params.venta) || 0;
        const distrib = Number(params.distrib) || 0;
        const multiplicadorVentas = Number(params.multiplicadorVentas) || 3;
        const tasaISR = Number(params.tasaISR) || 30;
        const incluirPTU = Boolean(params.incluirPTU);
        const tasaPTU = incluirPTU ? 10 : 0;

        // 1. Reclasificación Contable y Estado de Resultados Histórico
        const totalCostos = gif + mo;
        const ventasHistoricas = totalCostos * multiplicadorVentas; // V
        const utilidadBruta = ventasHistoricas - totalCostos;
        const totalGastosOp = admon + venta + distrib;
        const uai = utilidadBruta - totalGastosOp;
        const isr = uai > 0 ? uai * (tasaISR / 100) : 0;
        const ptu = uai > 0 ? uai * (tasaPTU / 100) : 0;
        const utilidadNeta = uai - isr - ptu;

        // 2. Fórmula de Presupuesto de Ventas: PV = [(V ± F) × E] × D
        const fAjuste = Number(params.fAjuste) || 0;
        const fCambio = Number(params.fCambio) || 0;
        const fCrecimiento = Number(params.fCrecimiento) || 0;
        const fNeto = fAjuste + fCambio + fCrecimiento;
        const baseVF = ventasHistoricas + fNeto;

        const eInflacion = Number(params.eInflacion) || 0;
        const eDolar = Number(params.eDolar) || 0;
        const ePib = Number(params.ePib) || 0;
        const ePctTotal = eInflacion + eDolar + ePib;
        const factorE = 1 + (ePctTotal / 100);
        const baseVFE = baseVF * factorE;

        const dAdminPct = Number(params.dAdminPct) || 0;
        const factorD = 1 + (dAdminPct / 100);
        const pv = baseVFE * factorD;

        // 3. Cédula Derivada del Presupuesto Maestro
        const unitMP = Number(params.unitMP) || 0;
        const unitMO = Number(params.unitMO) || 0;
        const unitGIF = Number(params.unitGIF) || 0;
        const costoUnitarioTotal = unitMP + unitMO + unitGIF;

        const precioVentaUnitario = costoUnitarioTotal > 0 ? costoUnitarioTotal * multiplicadorVentas : 0;
        const inventarioFinalDeseado = Math.max(0, Number(params.inventarioFinalDeseado) || 0);

        const unidadesVender = precioVentaUnitario > 0 ? Math.ceil(pv / precioVentaUnitario) : 0;
        const unidadesProducir = unidadesVender + inventarioFinalDeseado;

        const presupuestoMP = unidadesProducir * unitMP;
        const presupuestoMO = unidadesProducir * unitMO;
        const presupuestoGIF = unidadesProducir * unitGIF;
        const presupuestoCostoProduccion = presupuestoMP + presupuestoMO + presupuestoGIF;

        const costoVentasProyectado = unidadesVender * costoUnitarioTotal;
        const costoProyFinal = costoVentasProyectado > 0 ? costoVentasProyectado : (totalCostos * factorE * factorD);
        const utilidadBrutaProy = pv - costoProyFinal;
        const gastosOpProy = totalGastosOp * (1 + (eInflacion / 100));
        const uaiProy = utilidadBrutaProy - gastosOpProy;
        const isrProy = uaiProy > 0 ? uaiProy * (tasaISR / 100) : 0;
        const ptuProy = uaiProy > 0 ? uaiProy * (tasaPTU / 100) : 0;
        const utilidadNetaProy = uaiProy - isrProy - ptuProy;

        return {
            historia: {
                gif, mo, totalCostos, ventasHistoricas, utilidadBruta,
                admon, venta, distrib, totalGastosOp, uai, isr, ptu,
                tasaISR, tasaPTU, utilidadNeta
            },
            formula: {
                V: ventasHistoricas,
                fAjuste, fCambio, fCrecimiento, fNeto, baseVF,
                eInflacion, eDolar, ePib, ePctTotal, factorE, baseVFE,
                dAdminPct, factorD, pv
            },
            derivada: {
                unitMP, unitMO, unitGIF, costoUnitarioTotal, precioVentaUnitario,
                unidadesVender, inventarioFinalDeseado, unidadesProducir,
                presupuestoMP, presupuestoMO, presupuestoGIF, presupuestoCostoProduccion,
                costoVentasProyectado: costoProyFinal,
                utilidadBrutaProy, gastosOpProy, uaiProy, isrProy, ptuProy, utilidadNetaProy
            }
        };
    }
}