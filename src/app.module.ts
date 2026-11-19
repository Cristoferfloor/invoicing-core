import { DynamicModule, Inject, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { MongoClient } from 'mongodb';

import { CONFIGURACION_PROCESO, ProcesarComprobanteService } from './application/procesar-comprobante.service';
import { CONFIGURACION_DETECTOR, DetectorService } from './application/detector.service';
import { CONFIGURACION_DETECTOR_RIDES, DetectorRidesService } from './application/detector-rides.service';
import { GenerarRideService } from './application/generar-ride.service';
import { MetricasService } from './application/metricas.service';
import { COMPROBANTES_PORT, CONFIGURACION_PORT, FIRMADOR_PORT, GENERADOR_PORT, RIDE_PORT } from './domain/puertos';
import { MongoComprobantesRepository } from './infrastructure/mongo/mongo-comprobantes.repository';
import { HttpConfiguracionAdapter, HttpFirmadorAdapter, HttpGeneradorAdapter, HttpRideAdapter } from './infrastructure/http/servicios.adapters';
import { NucleoController } from './infrastructure/rest/nucleo.controller';
import { SaludController } from './infrastructure/rest/salud.controller';
import { TOKEN_ADMIN, TokenAdminGuard } from './infrastructure/rest/token-admin.guard';

const MONGO = Symbol('MONGO');

@Module({})
export class AppModule implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(MONGO) private readonly mongo: MongoClient) {}

  static registrar(env: NodeJS.ProcessEnv): DynamicModule {
    for (const v of ['CORE_MONGO_URL', 'CORE_ADMIN_TOKEN', 'CONFIG_URL', 'CONFIG_ADMIN_TOKEN', 'XML_GENERATOR_URL', 'SIGNER_URL', 'RIDE_URL', 'RIDE_ADMIN_TOKEN']) {
      if (!env[v]) throw new Error(`Falta ${v}.`);
    }
    const mongo = new MongoClient(env.CORE_MONGO_URL!);

    return {
      module: AppModule,
      controllers: [NucleoController, SaludController],
      providers: [
        ProcesarComprobanteService,
        DetectorService,
        GenerarRideService,
        DetectorRidesService,
        MetricasService,
        TokenAdminGuard,
        { provide: MONGO, useValue: mongo },
        { provide: TOKEN_ADMIN, useValue: env.CORE_ADMIN_TOKEN },
        { provide: COMPROBANTES_PORT, useValue: new MongoComprobantesRepository(mongo.db('invoicing')) },
        { provide: CONFIGURACION_PORT, useValue: new HttpConfiguracionAdapter(env.CONFIG_URL!, env.CONFIG_ADMIN_TOKEN!, Number(env.CONFIG_CACHE_MS ?? 60000)) },
        { provide: GENERADOR_PORT, useValue: new HttpGeneradorAdapter(env.XML_GENERATOR_URL!) },
        { provide: FIRMADOR_PORT, useValue: new HttpFirmadorAdapter(env.SIGNER_URL!) },
        { provide: RIDE_PORT, useValue: new HttpRideAdapter(env.RIDE_URL!, env.RIDE_ADMIN_TOKEN!) },
        { provide: CONFIGURACION_PROCESO, useValue: { bloqueoMs: 120000, maxReintentos: Number(env.MAX_RETRIES ?? 5) } },
        { provide: CONFIGURACION_DETECTOR, useValue: { concurrencia: Number(env.CONCURRENCY ?? 4), barridoMs: Number(env.SWEEP_MS ?? 30000) } },
        {
          provide: CONFIGURACION_DETECTOR_RIDES,
          useValue: {
            concurrencia: Number(env.RIDE_CONCURRENCY ?? 4),
            barridoMs: Number(env.RIDE_SWEEP_MS ?? 5000),
            porBarrido: Number(env.RIDE_PER_SWEEP ?? 100),
          },
        },
      ],
    };
  }

  // Se conecta antes de que el detector empiece a escuchar.
  async onModuleInit(): Promise<void> {
    await this.mongo.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.mongo.close();
  }
}
