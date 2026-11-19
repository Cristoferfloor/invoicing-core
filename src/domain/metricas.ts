// Tiempos del proceso a partir del historial de cada comprobante.

export interface PasoHistorial {
  estado: string;
  fecha: Date;
  // Lo que tardo el servicio en ese paso, si se midio.
  duracionMs?: number;
}

// Estos tramos se toman de la duracion medida del paso: la diferencia de
// horas incluye la espera antes de empezar (por ejemplo, si el Nucleo
// estaba apagado).
const DURACION_MEDIDA: Record<string, string> = {
  generacionXml: 'XML_GENERADO',
  firma: 'FIRMADO',
  generacionRide: 'RIDE_GENERADO',
};

export interface ComprobanteParaMetricas {
  estado: string;
  // Fecha de emision tal como la manda el ERP (hora de Ecuador, sin zona).
  fechaEmision: string | null;
  historial: PasoHistorial[];
  modoEnvio: string | null;
  lotesNoReconocidos: number;
}

export interface Estadistica {
  cantidad: number;
  promedioMs: number | null;
  minimoMs: number | null;
  medianaMs: number | null;
  maximoMs: number | null;
}

const TRAMOS = {
  emitidoARegistrado: ['EMITIDO', 'REGISTRADO'],
  registradoAFirmado: ['REGISTRADO', 'FIRMADO'],
  generacionXml: ['REGISTRADO', 'XML_GENERADO'],
  firma: ['XML_GENERADO', 'FIRMADO'],
  firmadoAEnviado: ['FIRMADO', 'ENVIADO'],
  enviadoAAutorizado: ['ENVIADO', 'AUTORIZADO'],
  registradoAAutorizado: ['REGISTRADO', 'AUTORIZADO'],
  emitidoAAutorizado: ['EMITIDO', 'AUTORIZADO'],
  // Ultimo paso: el RIDE.
  generacionRide: ['AUTORIZADO', 'RIDE_GENERADO'],
  autorizadoARide: ['AUTORIZADO', 'RIDE_GENERADO'],
  registradoARide: ['REGISTRADO', 'RIDE_GENERADO'],
} as const;

export function estadistica(valores: number[]): Estadistica {
  if (valores.length === 0) return { cantidad: 0, promedioMs: null, minimoMs: null, medianaMs: null, maximoMs: null };
  const ordenados = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(ordenados.length / 2);
  return {
    cantidad: ordenados.length,
    promedioMs: Math.round(ordenados.reduce((s, v) => s + v, 0) / ordenados.length),
    minimoMs: ordenados[0],
    medianaMs: ordenados.length % 2 ? ordenados[mitad] : Math.round((ordenados[mitad - 1] + ordenados[mitad]) / 2),
    maximoMs: ordenados[ordenados.length - 1],
  };
}

// "2026-09-16 15:30:05" (Ecuador, UTC-5) -> instante.
export function fechaEcuador(texto: string | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(texto ?? '');
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}-05:00`) : null;
}

export function calcularMetricas(comprobantes: ComprobanteParaMetricas[]) {
  const valores: Record<keyof typeof TRAMOS, number[]> = Object.fromEntries(
    Object.keys(TRAMOS).map((k) => [k, []]),
  ) as unknown as Record<keyof typeof TRAMOS, number[]>;

  const porEstado: Record<string, number> = {};
  const porModo: Record<string, number> = {};
  let conLoteNoReconocido = 0;

  for (const c of comprobantes) {
    porEstado[c.estado] = (porEstado[c.estado] ?? 0) + 1;
    if (c.modoEnvio) porModo[c.modoEnvio] = (porModo[c.modoEnvio] ?? 0) + 1;
    if (c.lotesNoReconocidos > 0) conLoteNoReconocido++;

    // Primera vez que el comprobante llego a cada estado.
    const momentos = new Map<string, number>();
    const emitido = fechaEcuador(c.fechaEmision);
    if (emitido) momentos.set('EMITIDO', emitido.getTime());
    for (const paso of c.historial) {
      if (!momentos.has(paso.estado)) momentos.set(paso.estado, new Date(paso.fecha).getTime());
    }

    for (const [tramo, [desde, hasta]] of Object.entries(TRAMOS) as Array<[keyof typeof TRAMOS, readonly [string, string]]>) {
      if (DURACION_MEDIDA[tramo]) {
        const paso = c.historial.find((p) => p.estado === DURACION_MEDIDA[tramo] && typeof p.duracionMs === 'number');
        if (paso) valores[tramo].push(paso.duracionMs!);
        continue;
      }
      const inicio = momentos.get(desde);
      const fin = momentos.get(hasta);
      if (inicio !== undefined && fin !== undefined && fin >= inicio) valores[tramo].push(fin - inicio);
    }
  }

  return {
    comprobantes: comprobantes.length,
    porEstado,
    porModoDeEnvio: porModo,
    conLoteNoReconocido,
    tiempos: Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, estadistica(v)])),
  };
}
