import { ComprobanteAutorizado, ComprobanteRegistrado, EmpresaConfigurada, PlantillaConfigurada } from './modelo';
import { ComprobanteParaMetricas } from './metricas';

export const CONFIGURACION_PORT = Symbol('CONFIGURACION_PORT');
export const GENERADOR_PORT = Symbol('GENERADOR_PORT');
export const FIRMADOR_PORT = Symbol('FIRMADOR_PORT');
export const RIDE_PORT = Symbol('RIDE_PORT');
export const COMPROBANTES_PORT = Symbol('COMPROBANTES_PORT');

// Todos lanzan PasoFallidoError.
export interface ConfiguracionPort {
  empresa(ruc: string): Promise<EmpresaConfigurada>;
  plantilla(ruc: string, tipo: string): Promise<PlantillaConfigurada>;
}

export interface GeneradorPort {
  generar(solicitud: {
    documentoId: string;
    tipoComprobante: string;
    plantilla: string;
    empresa: Record<string, unknown>;
    comprobante: Record<string, unknown>;
  }): Promise<{ xml: string; huella: string }>;
}

export interface FirmadorPort {
  firmar(documentoId: string, xml: string, certificadoRef: string): Promise<{ xmlFirmado: string; huella: string; firmadoEn: string }>;
}

// El PDF no se guarda: se arma cuando alguien lo pide. Aqui solo se comprueba
// que se puede armar y con que logo salio.
export interface RidePort {
  generar(claveAcceso: string): Promise<{ bytes: number; logoVersion: number | null; duracionMs: number }>;
}

export interface ComprobantesPort {
  registradosPendientes(limite: number): Promise<string[]>;
  // Toma el comprobante para procesarlo; null si otro ya lo tomo o ya no esta REGISTRADO.
  tomar(id: string, duracionBloqueoMs: number): Promise<ComprobanteRegistrado | null>;
  marcarXmlGenerado(c: ComprobanteRegistrado, r: { xml: string; huella: string; duracionMs: number; plantilla: { version: number; huella: string } }): Promise<boolean>;
  marcarFirmado(c: ComprobanteRegistrado, r: { xmlFirmado: string; huella: string; firmadoEn: string; duracionMs: number }): Promise<boolean>;
  marcarError(c: ComprobanteRegistrado, estadoEsperado: string, error: { paso: string; codigo: string; mensaje: string }): Promise<void>;
  // Error pasajero: libera el comprobante para reintentarlo mas tarde.
  liberar(c: ComprobanteRegistrado, error: { paso: string; codigo: string; mensaje: string }): Promise<void>;
  // Avisa cada comprobante REGISTRADO nuevo en cuanto se inserta.
  escucharNuevos(alRegistrar: (id: string) => void): Promise<() => Promise<void>>;

  // Ultimo paso: el RIDE de los que el SRI ya autorizo.
  autorizadosSinRide(limite: number, maxReintentos: number): Promise<string[]>;
  tomarParaRide(id: string, duracionBloqueoMs: number): Promise<ComprobanteAutorizado | null>;
  marcarRideListo(c: ComprobanteAutorizado, r: { bytes: number; logoVersion: number | null; duracionMs: number }): Promise<void>;
  // Ya no se vuelve a intentar: el motivo queda guardado.
  cerrarRide(c: ComprobanteAutorizado, error: { codigo: string; mensaje: string }): Promise<void>;
  liberarRide(c: ComprobanteAutorizado, error: { codigo: string; mensaje: string }): Promise<void>;
  paraMetricas(empresaId: string, desde: Date, hasta: Date): Promise<ComprobanteParaMetricas[]>;
  resumenLotes(empresaId: string, desde: Date, hasta: Date): Promise<Record<string, number>>;
}
