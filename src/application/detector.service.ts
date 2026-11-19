import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { COMPROBANTES_PORT, ComprobantesPort } from '../domain/puertos';
import { ProcesarComprobanteService } from './procesar-comprobante.service';

export const CONFIGURACION_DETECTOR = Symbol('CONFIGURACION_DETECTOR');

export interface ConfiguracionDetector {
  concurrencia: number;
  // Revision de respaldo por si se perdio un aviso (reinicio, corte de red).
  barridoMs: number;
}

// Se entera de cada comprobante REGISTRADO en cuanto entra a Mongo (change
// stream, sin cron) y los procesa de a varios a la vez.
@Injectable()
export class DetectorService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DetectorService.name);
  private readonly cola: string[] = [];
  private readonly enCola = new Set<string>();
  private activos = 0;
  private temporizador?: NodeJS.Timeout;
  private dejarDeEscuchar?: () => Promise<void>;

  constructor(
    @Inject(COMPROBANTES_PORT) private readonly comprobantes: ComprobantesPort,
    private readonly procesador: ProcesarComprobanteService,
    @Inject(CONFIGURACION_DETECTOR) private readonly config: ConfiguracionDetector,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.dejarDeEscuchar = await this.comprobantes.escucharNuevos((id) => this.encolar(id));
    await this.barrer();
    this.temporizador = setInterval(() => void this.barrer(), this.config.barridoMs);
    this.logger.log(JSON.stringify({ evento: 'detector_iniciado', concurrencia: this.config.concurrencia }));
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    await this.dejarDeEscuchar?.();
  }

  estado() {
    return { enCola: this.cola.length, procesando: this.activos, concurrencia: this.config.concurrencia };
  }

  private async barrer(): Promise<void> {
    try {
      const pendientes = await this.comprobantes.registradosPendientes(500);
      pendientes.forEach((id) => this.encolar(id));
      if (pendientes.length > 0) this.logger.log(JSON.stringify({ evento: 'barrido', pendientes: pendientes.length }));
    } catch (error) {
      this.logger.error(JSON.stringify({ evento: 'barrido_fallido', error: (error as Error).message }));
    }
  }

  private encolar(id: string): void {
    if (this.enCola.has(id)) return;
    this.enCola.add(id);
    this.cola.push(id);
    this.siguiente();
  }

  private siguiente(): void {
    while (this.activos < this.config.concurrencia && this.cola.length > 0) {
      const id = this.cola.shift()!;
      this.activos++;
      this.procesador
        .procesar(id)
        .catch((error: Error) => this.logger.error(JSON.stringify({ evento: 'proceso_fallido', id, error: error.message })))
        .finally(() => {
          this.activos--;
          this.enCola.delete(id);
          this.siguiente();
        });
    }
  }
}
