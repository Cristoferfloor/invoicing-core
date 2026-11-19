# invoicing-core

Orquesta el flujo: detecta los comprobantes en estado REGISTRADO, pide el XML, lo manda a firmar, lo entrega al SRI y mide los tiempos de cada etapa.

Parte de la facturación electrónica V2 para el SRI de Ecuador. NestJS + TypeScript.

## Puerto

`3006` — `GET /salud` devuelve el estado del servicio.

## Arranque

```bash
cp .env.example .env    # completar los valores
npm ci
npm run build
npm run start:prod
```

Antes hay que levantar la red y las bases de
[invoicing-infrastructure](https://github.com/Cristoferfloor/invoicing-infrastructure).
