import { calcularMetricas, estadistica, fechaEcuador } from '../src/domain/metricas';
import { comprobanteCompatible, empresaCompatible } from '../src/domain/compatible';

describe('metricas del proceso', () => {
  const t = (iso: string) => new Date(iso);

  it('calcula los tramos desde el historial y la fecha de emision del ERP', () => {
    const m = calcularMetricas([
      {
        estado: 'AUTORIZADO', fechaEmision: '2026-09-16 15:30:05', modoEnvio: 'INDIVIDUAL', lotesNoReconocidos: 1,
        historial: [
          { estado: 'REGISTRADO', fecha: t('2026-09-16T20:30:13Z') },
          { estado: 'XML_GENERADO', fecha: t('2026-09-16T20:30:13.200Z'), duracionMs: 200 },
          { estado: 'FIRMADO', fecha: t('2026-09-16T20:30:13.500Z'), duracionMs: 300 },
          { estado: 'ENVIADO', fecha: t('2026-09-16T20:30:30Z') },
          { estado: 'AUTORIZADO', fecha: t('2026-09-16T20:30:35Z') },
        ],
      },
    ]);
    expect(m.tiempos.emitidoARegistrado.promedioMs).toBe(8000);
    expect(m.tiempos.registradoAFirmado.promedioMs).toBe(500);
    expect(m.tiempos.generacionXml.promedioMs).toBe(200);
    expect(m.tiempos.firma.promedioMs).toBe(300);
    expect(m.tiempos.enviadoAAutorizado.promedioMs).toBe(5000);
    expect(m.tiempos.emitidoAAutorizado.promedioMs).toBe(30000);
    expect(m.porModoDeEnvio).toEqual({ INDIVIDUAL: 1 });
    expect(m.conLoteNoReconocido).toBe(1);
  });

  it('estadistica con mediana', () => {
    expect(estadistica([30, 10, 20])).toMatchObject({ cantidad: 3, promedioMs: 20, minimoMs: 10, medianaMs: 20, maximoMs: 30 });
    expect(estadistica([]).promedioMs).toBeNull();
  });

  it('la fecha del ERP es hora de Ecuador', () => {
    expect(fechaEcuador('2026-09-16 15:30:05')?.toISOString()).toBe('2026-09-16T20:30:05.000Z');
  });
});

describe('modo compatible', () => {
  it('traduce empresa y comprobante como el sistema actual', () => {
    expect(empresaCompatible({ ruc: '2390625475001', razonSocial: 'ROOTS', direccionMatriz: 'Av', ambiente: 1, obligadoContabilidad: true, contribuyenteEspecial: null, version: 1 }))
      .toEqual({ ruc: '2390625475001', name: 'ROOTS', address: 'Av', environment: '1', accounting: 'SI', code_contributor: '' });
    expect(comprobanteCompatible({ email: 'a@x.com|b@x.com' }, 'CLAVE')).toMatchObject({ email: 'a@x.com;b@x.com', agente: '1', clave_acceso: 'CLAVE' });
  });
});
