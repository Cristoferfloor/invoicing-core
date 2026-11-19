import { GenerarRideService } from '../src/application/generar-ride.service';
import { PasoFallidoError } from '../src/domain/errores';
import { ComprobanteAutorizado } from '../src/domain/modelo';
import { calcularMetricas } from '../src/domain/metricas';

const COMPROBANTE: ComprobanteAutorizado = {
  id: 'abc',
  empresaId: '2390625475001',
  numero: '004-001-000080023',
  intento: 1,
  claveAcceso: '1709202601239062547500110040010000800230008002314',
  intentosFallidosRide: 0,
};

function armar(
  ride: { generar: jest.Mock },
  comprobante: ComprobanteAutorizado = COMPROBANTE,
  maxReintentos = 3,
) {
  const comprobantes = {
    tomarParaRide: jest.fn().mockResolvedValue(comprobante),
    marcarRideListo: jest.fn().mockResolvedValue(undefined),
    cerrarRide: jest.fn().mockResolvedValue(undefined),
    liberarRide: jest.fn().mockResolvedValue(undefined),
  };
  const servicio = new GenerarRideService(
    comprobantes as never,
    ride as never,
    { bloqueoMs: 1000, maxReintentos },
  );
  return { servicio, comprobantes };
}

describe('ultimo paso: el RIDE', () => {
  it('lo pide y deja anotado con que logo salio', async () => {
    const resultado = { bytes: 70476, logoVersion: 2, duracionMs: 140 };
    const { servicio, comprobantes } = armar({ generar: jest.fn().mockResolvedValue(resultado) });

    expect(await servicio.generar('abc')).toBe('LISTO');
    expect(comprobantes.marcarRideListo).toHaveBeenCalledWith(COMPROBANTE, resultado);
  });

  it('no hace nada si otro ya lo tomo o ya tiene RIDE', async () => {
    const { servicio, comprobantes } = armar({ generar: jest.fn() });
    comprobantes.tomarParaRide.mockResolvedValue(null);

    expect(await servicio.generar('abc')).toBe('OMITIDO');
    expect(comprobantes.marcarRideListo).not.toHaveBeenCalled();
  });

  // Un XML que no se puede leer no se arregla reintentando.
  it('cierra el intento cuando el error es definitivo', async () => {
    const error = new PasoFallidoError('RIDE', 'COMPROBANTE_ILEGIBLE', 'El XML no es una factura.', true);
    const { servicio, comprobantes } = armar({ generar: jest.fn().mockRejectedValue(error) });

    expect(await servicio.generar('abc')).toBe('CERRADO');
    expect(comprobantes.cerrarRide).toHaveBeenCalledWith(COMPROBANTE, {
      codigo: 'COMPROBANTE_ILEGIBLE',
      mensaje: 'El XML no es una factura.',
    });
    expect(comprobantes.liberarRide).not.toHaveBeenCalled();
  });

  it('reintenta si el servicio no respondio, y se rinde al llegar al tope', async () => {
    const error = new PasoFallidoError('RIDE', 'SERVICIO_NO_DISPONIBLE', 'sin respuesta', false);

    const primero = armar({ generar: jest.fn().mockRejectedValue(error) });
    expect(await primero.servicio.generar('abc')).toBe('REINTENTAR');
    expect(primero.comprobantes.liberarRide).toHaveBeenCalled();

    const ultimo = armar({ generar: jest.fn().mockRejectedValue(error) }, { ...COMPROBANTE, intentosFallidosRide: 2 }, 3);
    expect(await ultimo.servicio.generar('abc')).toBe('CERRADO');
  });
});

describe('metricas con el RIDE', () => {
  it('mide lo que tarda el RIDE y el ciclo completo', () => {
    const t = (iso: string) => new Date(iso);
    const m = calcularMetricas([
      {
        estado: 'AUTORIZADO', fechaEmision: '2026-09-17 14:47:30', modoEnvio: 'INDIVIDUAL', lotesNoReconocidos: 0,
        historial: [
          { estado: 'REGISTRADO', fecha: t('2026-09-17T19:47:32Z') },
          { estado: 'XML_GENERADO', fecha: t('2026-09-17T19:47:32.2Z'), duracionMs: 200 },
          { estado: 'FIRMADO', fecha: t('2026-09-17T19:47:32.5Z'), duracionMs: 300 },
          { estado: 'ENVIADO', fecha: t('2026-09-17T19:47:34Z') },
          { estado: 'AUTORIZADO', fecha: t('2026-09-17T19:47:36Z') },
          { estado: 'RIDE_GENERADO', fecha: t('2026-09-17T19:47:40Z'), duracionMs: 140 },
        ],
      },
    ]);

    expect(m.tiempos.generacionRide.promedioMs).toBe(140);
    expect(m.tiempos.autorizadoARide.promedioMs).toBe(4000);
    expect(m.tiempos.registradoARide.promedioMs).toBe(8000);
  });
});
