import { Logger } from '@nestjs/common';
import { ChangeStream, Db } from 'mongodb';

import { ComprobantesPort } from '../../domain/puertos';
import { ComprobanteAutorizado, ComprobanteRegistrado } from '../../domain/modelo';
import { ComprobanteParaMetricas } from '../../domain/metricas';

type Doc = Record<string, any>;
type DocComprobante = { _id: string } & Doc;

const PENDIENTES = ['REGISTRADO', 'XML_GENERADO'];

export class MongoComprobantesRepository implements ComprobantesPort {
  private readonly logger = new Logger(MongoComprobantesRepository.name);

  constructor(private readonly db: Db) {}

  private get col() {
    return this.db.collection<DocComprobante>('comprobantes');
  }

  private libre(ahora: Date): Doc {
    return { $or: [{ 'nucleo.bloqueadoHasta': { $exists: false } }, { 'nucleo.bloqueadoHasta': { $lt: ahora } }] };
  }

  async registradosPendientes(limite: number): Promise<string[]> {
    const docs = await this.col
      .find({ estado: { $in: PENDIENTES }, ...this.libre(new Date()) }, { projection: { _id: 1 } })
      .sort({ creadoEn: 1 })
      .limit(limite)
      .toArray();
    return docs.map((d) => d._id);
  }

  async tomar(id: string, duracionBloqueoMs: number): Promise<ComprobanteRegistrado | null> {
    const ahora = new Date();
    const d = await this.col.findOneAndUpdate(
      { _id: id, estado: { $in: PENDIENTES }, ...this.libre(ahora) },
      { $set: { 'nucleo.bloqueadoHasta': new Date(ahora.getTime() + duracionBloqueoMs) } },
      { returnDocument: 'after' },
    );
    if (!d) return null;
    const intento = (d.intentos as Doc[]).find((i) => i.numero === d.intentoActual);
    if (!intento) return null;
    return {
      id: d._id,
      empresaId: d.empresaId,
      tipo: d.tipo,
      estado: d.estado,
      intento: intento.numero,
      claveAcceso: intento.claveAcceso,
      datos: intento.datos,
      xmlSinFirmar: intento.archivos?.xmlSinFirmar ?? null,
      reintentos: d.nucleo?.reintentos ?? 0,
    };
  }

  async marcarXmlGenerado(
    c: ComprobanteRegistrado,
    r: { xml: string; huella: string; duracionMs: number; plantilla: { version: number; huella: string } },
  ): Promise<boolean> {
    return this.cambiar(c, 'REGISTRADO', 'XML_GENERADO', 'generador-xml', r.duracionMs, {
      'intentos.$[i].archivos.xmlSinFirmar': r.xml,
      'intentos.$[i].archivos.huellaSinFirmar': r.huella,
      'intentos.$[i].configuracion.plantilla': { tipoComprobante: c.tipo, ...r.plantilla },
    });
  }

  async marcarFirmado(
    c: ComprobanteRegistrado,
    r: { xmlFirmado: string; huella: string; firmadoEn: string; duracionMs: number },
  ): Promise<boolean> {
    return this.cambiar(c, 'XML_GENERADO', 'FIRMADO', 'firmador', r.duracionMs, {
      'intentos.$[i].archivos.xmlFirmado': r.xmlFirmado,
      'intentos.$[i].archivos.huellaFirmado': r.huella,
      'intentos.$[i].firma': { firmadoEn: r.firmadoEn },
    }, true);
  }

  async marcarError(c: ComprobanteRegistrado, estadoEsperado: string, error: { paso: string; codigo: string; mensaje: string }): Promise<void> {
    await this.cambiar(c, estadoEsperado, 'ERROR', 'nucleo', null, {
      'intentos.$[i].error': { ...error, fecha: new Date() },
    }, true);
    await this.col.updateOne({ _id: c.id }, { $inc: { 'nucleo.reintentos': 1 } });
  }

  async liberar(c: ComprobanteRegistrado, error: { paso: string; codigo: string; mensaje: string }): Promise<void> {
    await this.col.updateOne(
      { _id: c.id },
      { $unset: { 'nucleo.bloqueadoHasta': '' }, $inc: { 'nucleo.reintentos': 1 }, $set: { 'nucleo.ultimoError': { ...error, fecha: new Date() } } },
    );
  }

  async escucharNuevos(alRegistrar: (id: string) => void): Promise<() => Promise<void>> {
    let flujo: ChangeStream | undefined;
    let cerrado = false;

    const abrir = () => {
      flujo = this.col.watch([{ $match: { operationType: 'insert', 'fullDocument.estado': 'REGISTRADO' } }]);
      flujo.on('change', (cambio: Doc) => alRegistrar(cambio.documentKey._id));
      flujo.on('error', (error: Error) => {
        this.logger.warn(JSON.stringify({ evento: 'change_stream_error', error: error.message }));
        void flujo?.close().catch(() => undefined);
        if (!cerrado) setTimeout(abrir, 5000);
      });
    };
    abrir();

    return async () => {
      cerrado = true;
      await flujo?.close().catch(() => undefined);
    };
  }

  // --------------------------------------------------------------- RIDE
  // Ultimo paso del ciclo: autorizado por el SRI y con su RIDE listo.

  private get faltaRide(): Doc {
    return { estado: 'AUTORIZADO', 'ride.generadoEn': { $exists: false }, 'ride.cerrado': { $ne: true } };
  }

  async autorizadosSinRide(limite: number, maxReintentos: number): Promise<string[]> {
    const docs = await this.col
      .find(
        { ...this.faltaRide, 'ride.intentosFallidos': { $not: { $gte: maxReintentos } }, ...this.libre(new Date()) },
        { projection: { _id: 1 } },
      )
      .sort({ actualizadoEn: 1 })
      .limit(limite)
      .toArray();
    return docs.map((d) => d._id);
  }

  async tomarParaRide(id: string, duracionBloqueoMs: number): Promise<ComprobanteAutorizado | null> {
    const ahora = new Date();
    const d = await this.col.findOneAndUpdate(
      { _id: id, ...this.faltaRide, ...this.libre(ahora) },
      { $set: { 'nucleo.bloqueadoHasta': new Date(ahora.getTime() + duracionBloqueoMs) } },
      { returnDocument: 'after' },
    );
    if (!d) return null;
    const intento = (d.intentos as Doc[]).find((i) => i.numero === d.intentoActual);
    if (!intento?.claveAcceso) return null;
    return {
      id: d._id,
      empresaId: d.empresaId,
      numero: `${d.estab}-${d.ptoEmi}-${d.secuencial}`,
      intento: intento.numero,
      claveAcceso: intento.claveAcceso,
      intentosFallidosRide: d.ride?.intentosFallidos ?? 0,
    };
  }

  async marcarRideListo(
    c: ComprobanteAutorizado,
    r: { bytes: number; logoVersion: number | null; duracionMs: number },
  ): Promise<void> {
    const ahora = new Date();
    // El estado sigue siendo AUTORIZADO, que es lo que dice el SRI; el RIDE
    // queda anotado aparte y en el historial.
    await this.col.updateOne(
      { _id: c.id, estado: 'AUTORIZADO' },
      {
        $set: { actualizadoEn: ahora, ride: { generadoEn: ahora, ...r } },
        $push: {
          'intentos.$[i].historial': { estado: 'RIDE_GENERADO', fecha: ahora, servicio: 'generador-ride', duracionMs: r.duracionMs },
        } as Doc,
        $unset: { 'nucleo.bloqueadoHasta': '' },
      },
      { arrayFilters: [{ 'i.numero': c.intento }] },
    );
  }

  async cerrarRide(c: ComprobanteAutorizado, error: { codigo: string; mensaje: string }): Promise<void> {
    await this.col.updateOne(
      { _id: c.id },
      {
        $set: { 'ride.cerrado': true, 'ride.ultimoError': { ...error, fecha: new Date() } },
        $unset: { 'nucleo.bloqueadoHasta': '' },
      },
    );
  }

  async liberarRide(c: ComprobanteAutorizado, error: { codigo: string; mensaje: string }): Promise<void> {
    await this.col.updateOne(
      { _id: c.id },
      {
        $inc: { 'ride.intentosFallidos': 1 },
        $set: { 'ride.ultimoError': { ...error, fecha: new Date() } },
        $unset: { 'nucleo.bloqueadoHasta': '' },
      },
    );
  }

  async paraMetricas(empresaId: string, desde: Date, hasta: Date): Promise<ComprobanteParaMetricas[]> {
    const docs = await this.col
      .find(
        { empresaId, creadoEn: { $gte: desde, $lt: hasta } },
        { projection: { estado: 1, intentoActual: 1, 'intentos.numero': 1, 'intentos.historial': 1, 'intentos.datos.fecha': 1, 'intentos.envio.modo': 1, 'intentos.lotesNoReconocidos': 1 } },
      )
      .toArray();
    return docs.flatMap((d) => {
      const intento = (d.intentos as Doc[] | undefined)?.find((i) => i.numero === d.intentoActual);
      if (!intento) return [];
      return [{
        estado: d.estado,
        fechaEmision: typeof intento.datos?.fecha === 'string' ? intento.datos.fecha : null,
        historial: intento.historial ?? [],
        modoEnvio: intento.envio?.modo ?? null,
        lotesNoReconocidos: intento.lotesNoReconocidos?.length ?? 0,
      }];
    });
  }

  async resumenLotes(empresaId: string, desde: Date, hasta: Date): Promise<Record<string, number>> {
    const grupos = await this.db
      .collection('lotes')
      .aggregate<{ _id: string; total: number }>([
        { $match: { empresaId, creadoEn: { $gte: desde, $lt: hasta } } },
        { $group: { _id: '$estado', total: { $sum: 1 } } },
      ])
      .toArray();
    return Object.fromEntries(grupos.map((g) => [g._id, g.total]));
  }

  // Cambia el estado solo si sigue en el esperado, y deja el paso en el
  // historial con su duracion.
  private async cambiar(
    c: ComprobanteRegistrado, desde: string, hacia: string, servicio: string,
    duracionMs: number | null, set: Doc, liberar = false,
  ): Promise<boolean> {
    const ahora = new Date();
    const resultado = await this.col.updateOne(
      { _id: c.id, estado: desde },
      {
        $set: { estado: hacia, actualizadoEn: ahora, 'intentos.$[i].estado': hacia, ...set },
        $push: { 'intentos.$[i].historial': { estado: hacia, fecha: ahora, servicio, ...(duracionMs !== null ? { duracionMs } : {}) } } as Doc,
        ...(liberar ? { $unset: { 'nucleo.bloqueadoHasta': '' } } : {}),
      },
      { arrayFilters: [{ 'i.numero': c.intento }] },
    );
    return resultado.modifiedCount === 1;
  }
}
