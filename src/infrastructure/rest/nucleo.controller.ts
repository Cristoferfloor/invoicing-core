import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { MetricasService } from '../../application/metricas.service';
import { DetectorService } from '../../application/detector.service';
import { DetectorRidesService } from '../../application/detector-rides.service';
import { TokenAdminGuard } from './token-admin.guard';

// Inicio del dia de hoy en Ecuador (UTC-5).
function inicioDeHoyEcuador(): Date {
  const ahora = new Date(Date.now() - 5 * 3600 * 1000);
  return new Date(`${ahora.toISOString().slice(0, 10)}T00:00:00-05:00`);
}

@Controller('v1')
@UseGuards(TokenAdminGuard)
export class NucleoController {
  constructor(
    private readonly metricas: MetricasService,
    private readonly detector: DetectorService,
    private readonly detectorRides: DetectorRidesService,
  ) {}

  // Tiempos del proceso. Por defecto, los comprobantes registrados hoy.
  @Get('metricas/:empresaRuc')
  metricasEmpresa(@Param('empresaRuc') empresaRuc: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    if (!/^\d{10}00[1-9]$/.test(empresaRuc)) throw new BadRequestException('RUC invalido.');
    const inicio = desde ? new Date(desde) : inicioDeHoyEcuador();
    const fin = hasta ? new Date(hasta) : new Date(Date.now() + 60_000);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) throw new BadRequestException('desde/hasta deben ser fechas ISO.');
    return this.metricas.empresa(empresaRuc, inicio, fin);
  }

  @Get('estado')
  estado() {
    return { ...this.detector.estado(), rides: this.detectorRides.estado() };
  }
}
