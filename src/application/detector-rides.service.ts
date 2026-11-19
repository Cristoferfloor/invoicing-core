import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { COMPROBANTES_PORT, ComprobantesPort } from '../domain/puertos';
import { CONFIGURACION_PROCESO, ConfiguracionProceso } from './procesar-comprobante.service';
import { GenerarRideService } from './generar-ride.service';

export const CONFIGURACION_DETECTOR_RIDES = Symbol('CONFIGURACION_DETECTOR_RIDES');

export interface ConfiguracionDetectorRides {
  concurrencia: number;
  barridoMs: number;
  porBarrido: number;
}

// Busca cada pocos segundos los comprobantes autorizados a los que les falta
// el RIDE. No usa change stream porque quien los pasa a AUTORIZADO es el
// Cliente SRI, y este barrido corto alcanza de sobra.
@Injectable()
export class DetectorRidesService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DetectorRidesService.name);
  private temporizador?: NodeJS.Timeout;
  private barriendo = false;
  private ultimosListos = 0;

  constructor(
    @Inject(COMPROBANTES_PORT) private readonly comprobantes: ComprobantesPort,
    private readonly generador: GenerarRideService,
    @Inject(CONFIGURACION_DETECTOR_RIDES) private readonly config: ConfiguracionDetectorRides,
    @Inject(CONFIGURACION_PROCESO) private readonly proceso: ConfiguracionProceso,
  ) {}

  onApplicationBootstrap(): void {
    this.temporizador = setInterval(() => void this.barrer(), this.config.barridoMs);
    this.logger.log(JSON.stringify({ evento: 'detector_rides_iniciado', cada: `${this.config.barridoMs} ms` }));
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  estado() {
    return { ultimosListos: this.ultimosListos, concurrencia: this.config.concurrencia };
  }

  private async barrer(): Promise<void> {
    if (this.barriendo) return;
    this.barriendo = true;
    try {
      const pendientes = await this.comprobantes.autorizadosSinRide(this.config.porBarrido, this.proceso.maxReintentos);
      if (pendientes.length === 0) return;

      const resultados = await this.enTandas(pendientes);
      this.ultimosListos = resultados.filter((r) => r === 'LISTO').length;
      this.logger.log(JSON.stringify({ evento: 'barrido_rides', pendientes: pendientes.length, listos: this.ultimosListos }));
    } catch (error) {
      this.logger.error(JSON.stringify({ evento: 'barrido_rides_fallido', error: (error as Error).message }));
    } finally {
      this.barriendo = false;
    }
  }

  // De a varios a la vez, sin pasarse de la concurrencia configurada.
  private async enTandas(ids: string[]): Promise<string[]> {
    const resultados: string[] = [];
    for (let i = 0; i < ids.length; i += this.config.concurrencia) {
      const tanda = ids.slice(i, i + this.config.concurrencia);
      const hechos = await Promise.all(
        tanda.map((id) =>
          this.generador.generar(id).catch((error: Error) => {
            this.logger.error(JSON.stringify({ evento: 'ride_fallido', id, error: error.message }));
            return 'ERROR';
          }),
        ),
      );
      resultados.push(...hechos);
    }
    return resultados;
  }
}
