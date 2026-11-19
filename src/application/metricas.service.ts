import { Inject, Injectable } from '@nestjs/common';

import { COMPROBANTES_PORT, ComprobantesPort } from '../domain/puertos';
import { calcularMetricas } from '../domain/metricas';

@Injectable()
export class MetricasService {
  constructor(@Inject(COMPROBANTES_PORT) private readonly comprobantes: ComprobantesPort) {}

  async empresa(empresaId: string, desde: Date, hasta: Date) {
    const [comprobantes, lotes] = await Promise.all([
      this.comprobantes.paraMetricas(empresaId, desde, hasta),
      this.comprobantes.resumenLotes(empresaId, desde, hasta),
    ]);
    return { empresaId, desde, hasta, ...calcularMetricas(comprobantes), lotesPorEstado: lotes };
  }
}
