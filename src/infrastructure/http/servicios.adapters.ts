import { ConfiguracionPort, FirmadorPort, GeneradorPort, RidePort } from '../../domain/puertos';
import { EmpresaConfigurada, PlantillaConfigurada } from '../../domain/modelo';
import { PasoFallidoError } from '../../domain/errores';

type Paso = PasoFallidoError['paso'];

// Una respuesta con {estado: "RECHAZADO"} es un rechazo del servicio
// (definitivo). Sin respuesta, o un 502/503, es un problema pasajero.
async function llamar<T>(paso: Paso, url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new PasoFallidoError(paso, 'SERVICIO_NO_DISPONIBLE', `${new URL(url).host}: ${(error as Error).message}`, false);
  }
  const cuerpo = (await respuesta.json().catch(() => null)) as Record<string, any> | null;
  if (respuesta.ok) return cuerpo as T;

  if (cuerpo?.estado === 'RECHAZADO') {
    throw new PasoFallidoError(paso, String(cuerpo.error), String(cuerpo.mensaje), true);
  }
  const definitivo = respuesta.status >= 400 && respuesta.status < 500;
  const mensaje = Array.isArray(cuerpo?.message) ? cuerpo!.message.join('; ') : String(cuerpo?.message ?? `HTTP ${respuesta.status}`);
  throw new PasoFallidoError(paso, `HTTP_${respuesta.status}`, mensaje, definitivo);
}

export class HttpConfiguracionAdapter implements ConfiguracionPort {
  private readonly cache = new Map<string, { valor: unknown; hasta: number }>();

  constructor(private readonly baseUrl: string, private readonly token: string, private readonly cacheMs: number) {}

  empresa(ruc: string): Promise<EmpresaConfigurada> {
    return this.conCache(`empresa:${ruc}`, () => this.pedir(`/v1/empresas/${ruc}`));
  }

  plantilla(ruc: string, tipo: string): Promise<PlantillaConfigurada> {
    return this.conCache(`plantilla:${ruc}:${tipo}`, () => this.pedir(`/v1/empresas/${ruc}/plantillas/${tipo}`));
  }

  private pedir<T>(ruta: string): Promise<T> {
    return llamar<T>('CONFIGURACION', `${this.baseUrl}${ruta}`, { headers: { 'X-Token-Admin': this.token } }, 15000);
  }

  private async conCache<T>(llave: string, obtener: () => Promise<T>): Promise<T> {
    const guardado = this.cache.get(llave);
    if (guardado && guardado.hasta > Date.now()) return guardado.valor as T;
    const valor = await obtener();
    this.cache.set(llave, { valor, hasta: Date.now() + this.cacheMs });
    return valor;
  }
}

export class HttpGeneradorAdapter implements GeneradorPort {
  constructor(private readonly baseUrl: string) {}

  async generar(s: { documentoId: string; tipoComprobante: string; plantilla: string; empresa: Record<string, unknown>; comprobante: Record<string, unknown> }) {
    const r = await llamar<{ xmlBase64: string; huella: string }>('XML', `${this.baseUrl}/v1/xml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...s, modo: 'compatible' }),
    }, 30000);
    return { xml: Buffer.from(r.xmlBase64, 'base64').toString('utf8'), huella: r.huella };
  }
}

// El RIDE responde con el PDF, no con JSON: se pide para comprobar que se
// puede armar, y se guarda su tamano y el logo con que salio.
export class HttpRideAdapter implements RidePort {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async generar(claveAcceso: string) {
    const inicio = Date.now();
    const url = `${this.baseUrl}/v1/rides/${claveAcceso}`;

    let respuesta: Response;
    try {
      respuesta = await fetch(url, { headers: { 'X-Token-Admin': this.token }, signal: AbortSignal.timeout(30000) });
    } catch (error) {
      throw new PasoFallidoError('RIDE', 'SERVICIO_NO_DISPONIBLE', `${new URL(url).host}: ${(error as Error).message}`, false);
    }

    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json().catch(() => null)) as Record<string, any> | null;
      // 409: el comprobante todavia no esta autorizado. Se reintenta.
      const definitivo = respuesta.status >= 400 && respuesta.status < 500 && respuesta.status !== 409;
      throw new PasoFallidoError(
        'RIDE',
        String(cuerpo?.error ?? `HTTP_${respuesta.status}`),
        String(cuerpo?.mensaje ?? cuerpo?.message ?? `HTTP ${respuesta.status}`),
        definitivo,
      );
    }

    const pdf = await respuesta.arrayBuffer();
    const logoVersion = Number(respuesta.headers.get('x-ride-logo-version'));
    return {
      bytes: pdf.byteLength,
      logoVersion: Number.isFinite(logoVersion) && logoVersion > 0 ? logoVersion : null,
      duracionMs: Date.now() - inicio,
    };
  }
}

export class HttpFirmadorAdapter implements FirmadorPort {
  constructor(private readonly baseUrl: string) {}

  async firmar(documentoId: string, xml: string, certificadoRef: string) {
    const r = await llamar<{ xmlFirmadoBase64: string; huella: string; firmadoEn: string }>('FIRMA', `${this.baseUrl}/v1/firmas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentoId, xmlBase64: Buffer.from(xml, 'utf8').toString('base64'), certificadoRef }),
    }, 30000);
    return { xmlFirmado: Buffer.from(r.xmlFirmadoBase64, 'base64').toString('utf8'), huella: r.huella, firmadoEn: r.firmadoEn };
  }
}
