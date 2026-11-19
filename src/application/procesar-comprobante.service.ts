import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  COMPROBANTES_PORT,
  CONFIGURACION_PORT,
  ComprobantesPort,
  ConfiguracionPort,
  FIRMADOR_PORT,
  FirmadorPort,
  GENERADOR_PORT,
  GeneradorPort,
} from '../domain/puertos';
import { comprobanteCompatible, empresaCompatible } from '../domain/compatible';
import { PasoFallidoError } from '../domain/errores';

export const CONFIGURACION_PROCESO = Symbol('CONFIGURACION_PROCESO');

export interface ConfiguracionProceso {
  bloqueoMs: number;
  maxReintentos: number;
}

// REGISTRADO -> XML_GENERADO -> FIRMADO.
@Injectable()
export class ProcesarComprobanteService {
  private readonly logger = new Logger(ProcesarComprobanteService.name);

  constructor(
    @Inject(COMPROBANTES_PORT) private readonly comprobantes: ComprobantesPort,
    @Inject(CONFIGURACION_PORT) private readonly configuracion: ConfiguracionPort,
    @Inject(GENERADOR_PORT) private readonly generador: GeneradorPort,
    @Inject(FIRMADOR_PORT) private readonly firmador: FirmadorPort,
    @Inject(CONFIGURACION_PROCESO) private readonly config: ConfiguracionProceso,
  ) {}

  async procesar(id: string): Promise<'FIRMADO' | 'ERROR' | 'REINTENTAR' | 'OMITIDO'> {
    const c = await this.comprobantes.tomar(id, this.config.bloqueoMs);
    if (!c) return 'OMITIDO';

    let estadoActual: string = c.estado;
    try {
      const inicioXml = Date.now();
      let xmlSinFirmar = c.xmlSinFirmar;

      // Si ya se genero y lo que fallo fue la firma, no se vuelve a generar.
      if (c.estado === 'REGISTRADO' || !xmlSinFirmar) {
        const empresa = await this.configuracion.empresa(c.empresaId);
        // El digito 24 de la clave es el ambiente con que se registro. Si no
        // coincide con el de la empresa (se cambio de pruebas a produccion en
        // medio), el XML saldria con un ambiente y la clave con otro.
        if (c.claveAcceso[23] !== String(empresa.ambiente)) {
          throw new PasoFallidoError(
            'CONFIGURACION', 'AMBIENTE_NO_COINCIDE',
            `La clave se genero con ambiente ${c.claveAcceso[23]} y la empresa esta en ambiente ${empresa.ambiente}.`, true,
          );
        }
        const plantilla = await this.configuracion.plantilla(c.empresaId, c.tipo);
        const xml = await this.generador.generar({
          documentoId: c.claveAcceso,
          tipoComprobante: c.tipo,
          plantilla: plantilla.contenido,
          empresa: empresaCompatible(empresa),
          comprobante: comprobanteCompatible(c.datos, c.claveAcceso),
        });
        await this.comprobantes.marcarXmlGenerado(c, {
          ...xml, duracionMs: Date.now() - inicioXml, plantilla: { version: plantilla.version, huella: plantilla.huella },
        });
        xmlSinFirmar = xml.xml;
        estadoActual = 'XML_GENERADO';
      }

      const inicioFirma = Date.now();
      const firma = await this.firmador.firmar(c.claveAcceso, xmlSinFirmar, c.empresaId);
      await this.comprobantes.marcarFirmado(c, { ...firma, duracionMs: Date.now() - inicioFirma });

      this.logger.log(JSON.stringify({
        evento: 'comprobante_firmado', empresaId: c.empresaId, claveAcceso: c.claveAcceso,
        xmlMs: inicioFirma - inicioXml, firmaMs: Date.now() - inicioFirma,
      }));
      return 'FIRMADO';
    } catch (error) {
      if (!(error instanceof PasoFallidoError)) throw error;
      const detalle = { paso: error.paso, codigo: error.codigo, mensaje: error.message };

      if (error.definitivo || c.reintentos + 1 >= this.config.maxReintentos) {
        await this.comprobantes.marcarError(c, estadoActual, detalle);
        this.logger.warn(JSON.stringify({ evento: 'comprobante_error', claveAcceso: c.claveAcceso, ...detalle, reintentos: c.reintentos + 1 }));
        return 'ERROR';
      }
      await this.comprobantes.liberar(c, detalle);
      this.logger.warn(JSON.stringify({ evento: 'comprobante_reintentar', claveAcceso: c.claveAcceso, ...detalle, reintentos: c.reintentos + 1 }));
      return 'REINTENTAR';
    }
  }
}
