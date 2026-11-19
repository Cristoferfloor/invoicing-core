import { Inject, Injectable, Logger } from '@nestjs/common';

import { COMPROBANTES_PORT, ComprobantesPort, RIDE_PORT, RidePort } from '../domain/puertos';
import { CONFIGURACION_PROCESO, ConfiguracionProceso } from './procesar-comprobante.service';
import { PasoFallidoError } from '../domain/errores';

// Ultimo paso del ciclo: con el comprobante ya autorizado por el SRI, se pide
// el RIDE. El PDF no se guarda (se arma cuando alguien lo pide); lo que queda
// anotado es que se pudo armar, con que logo y cuanto tardo.
@Injectable()
export class GenerarRideService {
  private readonly logger = new Logger(GenerarRideService.name);

  constructor(
    @Inject(COMPROBANTES_PORT) private readonly comprobantes: ComprobantesPort,
    @Inject(RIDE_PORT) private readonly ride: RidePort,
    @Inject(CONFIGURACION_PROCESO) private readonly config: ConfiguracionProceso,
  ) {}

  async generar(id: string): Promise<'LISTO' | 'CERRADO' | 'REINTENTAR' | 'OMITIDO'> {
    const c = await this.comprobantes.tomarParaRide(id, this.config.bloqueoMs);
    if (!c) return 'OMITIDO';

    try {
      const resultado = await this.ride.generar(c.claveAcceso);
      await this.comprobantes.marcarRideListo(c, resultado);
      this.logger.log(JSON.stringify({
        evento: 'ride_listo', empresaRuc: c.empresaId, numero: c.numero, ...resultado,
      }));
      return 'LISTO';
    } catch (error) {
      if (!(error instanceof PasoFallidoError)) throw error;
      const detalle = { codigo: error.codigo, mensaje: error.message };
      const sinReintentos = c.intentosFallidosRide + 1 >= this.config.maxReintentos;

      if (error.definitivo || sinReintentos) {
        await this.comprobantes.cerrarRide(c, detalle);
        this.logger.error(JSON.stringify({ evento: 'ride_cerrado', numero: c.numero, ...detalle }));
        return 'CERRADO';
      }

      await this.comprobantes.liberarRide(c, detalle);
      this.logger.warn(JSON.stringify({ evento: 'ride_reintentar', numero: c.numero, ...detalle }));
      return 'REINTENTAR';
    }
  }
}
