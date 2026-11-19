// Un paso (configuracion, XML, firma o RIDE) no se pudo completar.
//   definitivo = true:  reintentar igual no lo arregla (plantilla rota,
//                       certificado vencido): el comprobante pasa a ERROR.
//   definitivo = false: el servicio no respondio: se reintenta mas tarde.
export class PasoFallidoError extends Error {
  constructor(
    readonly paso: 'CONFIGURACION' | 'XML' | 'FIRMA' | 'RIDE',
    readonly codigo: string,
    mensaje: string,
    readonly definitivo: boolean,
  ) {
    super(mensaje);
    this.name = 'PasoFallidoError';
  }
}
