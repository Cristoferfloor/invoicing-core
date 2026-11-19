export type Ambiente = 1 | 2;

export interface EmpresaConfigurada {
  ruc: string;
  razonSocial: string;
  direccionMatriz: string;
  ambiente: Ambiente;
  obligadoContabilidad: boolean;
  contribuyenteEspecial: string | null;
  version: number;
}

export interface PlantillaConfigurada {
  tipoComprobante: string;
  version: number;
  huella: string;
  contenido: string;
}

// Lo que el Nucleo necesita de un comprobante REGISTRADO (o XML_GENERADO que
// quedo sin firmar) para procesarlo.
export interface ComprobanteRegistrado {
  id: string;
  empresaId: string;
  tipo: string;
  estado: 'REGISTRADO' | 'XML_GENERADO';
  intento: number;
  claveAcceso: string;
  datos: Record<string, unknown>;
  xmlSinFirmar: string | null;
  reintentos: number;
}

// Un comprobante que el SRI ya autorizo y al que le falta el RIDE.
export interface ComprobanteAutorizado {
  id: string;
  empresaId: string;
  numero: string;
  intento: number;
  claveAcceso: string;
  intentosFallidosRide: number;
}
