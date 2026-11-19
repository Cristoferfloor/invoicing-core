import { Controller, Get } from '@nestjs/common';

@Controller('salud')
export class SaludController {
  @Get()
  estado() {
    return { estado: 'ok', servicio: 'core-service', version: '0.1.0' };
  }
}
